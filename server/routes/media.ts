import { Hono } from "hono";
import { decodeBase64, sha256HexBytes } from "../lib/crypto";
import { requireAuth } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

/**
 * 草稿阶段的图片：以 base64 走 JSON 提交，存 D1 的 media_blobs，由 Worker 直出。
 * P4 发布时再迁到 git / R2，所以这里刻意只做「能插图」这一件事。
 */
export const media: Hono<AppEnv> = new Hono<AppEnv>();

/** D1 单行上限 1MB，留出 base64 解码与行内其他列的开销 */
const MAX_BYTES = 900_000;

const ALLOWED_MIME = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/avif",
]);

interface MediaRow {
	id: number;
	mime: string;
	bytes: number;
}

media.post("/", requireAuth, requireJsonBody, sameOriginGuard, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);

	const payload = (await c.req.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	const mime =
		typeof payload.mime === "string" ? payload.mime.toLowerCase() : "";
	if (!ALLOWED_MIME.has(mime)) {
		return c.json(
			{
				error: "unsupported_media_type",
				message: "只收 png / jpeg / webp / gif / avif",
			},
			415,
		);
	}

	const raw = typeof payload.data === "string" ? payload.data : "";
	const bytes = decodeBase64(raw);
	if (!bytes) {
		return c.json(
			{ error: "invalid_data", message: "图片数据不是合法 base64" },
			400,
		);
	}
	if (bytes.byteLength === 0) {
		return c.json({ error: "empty_file", message: "文件是空的" }, 400);
	}
	if (bytes.byteLength > MAX_BYTES) {
		return c.json(
			{
				error: "file_too_large",
				message: `单张图片不能超过 ${Math.round(MAX_BYTES / 1000)} KB`,
				bytes: bytes.byteLength,
			},
			413,
		);
	}

	const digest = await sha256HexBytes(bytes);

	// 同一个人重复上传同一张图时直接复用，省一次写
	const existing = await c.env.DB.prepare(
		"SELECT id, mime, bytes FROM media_blobs WHERE uid = ?1 AND sha256 = ?2",
	)
		.bind(user.uid, digest)
		.first<MediaRow>();
	if (existing) {
		return c.json({
			media: { ...existing, url: `/api/media/${existing.id}` },
			reused: true,
		});
	}

	const created = await c.env.DB.prepare(
		`INSERT INTO media_blobs (uid, mime, bytes, sha256, data)
		 VALUES (?1, ?2, ?3, ?4, ?5)
		 RETURNING id, mime, bytes`,
	)
		.bind(user.uid, mime, bytes.byteLength, digest, bytes)
		.first<MediaRow>();

	if (!created) {
		return c.json({ error: "insert_failed", message: "保存失败，请重试" }, 500);
	}

	return c.json(
		{ media: { ...created, url: `/api/media/${created.id}` }, reused: false },
		201,
	);
});

/**
 * D1 的 BLOB 在不同运行时不一定是 ArrayBuffer：
 * 本地 miniflare 会返回数字数组，线上返回 ArrayBuffer。这里统一成字节视图。
 */
function toBytes(value: unknown): Uint8Array | null {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	if (Array.isArray(value)) return Uint8Array.from(value as number[]);
	return null;
}

media.get("/:id", async (c) => {
	const id = Number(c.req.param("id"));
	if (!Number.isInteger(id) || id <= 0) {
		return c.json({ error: "bad_request", message: "id 非法" }, 400);
	}

	const row = await c.env.DB.prepare(
		"SELECT mime, data FROM media_blobs WHERE id = ?1",
	)
		.bind(id)
		.first<{ mime: string; data: unknown }>();

	if (!row) return c.json({ error: "not_found", message: "图片不存在" }, 404);

	const bytes = toBytes(row.data);
	if (!bytes) {
		return c.json({ error: "corrupted", message: "图片数据损坏" }, 500);
	}

	// 拷贝成独立 ArrayBuffer：Response 不收 Uint8Array<ArrayBufferLike>，
	// 而 D1 返回的字节可能挂在别处
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);

	// 内容按 id 固定，可以长期缓存；no-store 是给 /api 其它接口的，这里单独覆盖
	return new Response(buffer, {
		headers: {
			"content-type": row.mime,
			"cache-control": "public, max-age=31536000, immutable",
			"x-content-type-options": "nosniff",
		},
	});
});
