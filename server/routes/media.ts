import { Hono } from "hono";
import { writeAudit } from "../lib/audit";
import { decodeBase64, sha256HexBytes } from "../lib/crypto";
import {
	deleteMedia,
	fetchLiveMedia,
	type IncomingFile,
	MAX_UPLOAD_BYTES,
	MAX_UPLOAD_FILES,
	readMediaIndex,
	resolveGithubToken,
	uploadMedia,
} from "../lib/media-store";
import { requireAuth, requireRole } from "../middleware/auth";
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

/* --------------------- 媒体库：仓库里的静态文件 --------------------- */

/** 一次上传的原始字节上限：客户端会先压到几百 KB，这个数只是兜底 */
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

/** 上游（GitHub / 业务层）给的状态码要收进 Hono 认识的集合，不认识的统一 502 */
const KNOWN_HTTP = [
	400, 401, 403, 404, 409, 412, 413, 415, 422, 429, 500, 502, 503,
] as const;
type KnownHttp = (typeof KNOWN_HTTP)[number];

function asStatus(status: number): KnownHttp {
	return (KNOWN_HTTP as readonly number[]).includes(status)
		? (status as KnownHttp)
		: 502;
}

/**
 * 列表：默认读构建期快照（不带令牌，快）。
 * `?refresh=1` 现拉一次 GitHub 目录树，用来在上传后不重新构建就看到新图；
 * 这条要走令牌，只给管理员。
 */
media.get("/library", requireAuth, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);

	const index = await readMediaIndex(c.env.ASSETS);

	if (c.req.query("refresh") === "1") {
		if (user.role !== "admin") {
			return c.json(
				{ error: "forbidden", message: "只有管理员能刷新索引" },
				403,
			);
		}
		const token = await resolveGithubToken(c.env);
		if (!token) {
			return c.json(
				{ error: "github_token_missing", message: "还没配置 GitHub 令牌" },
				412,
			);
		}
		const live = await fetchLiveMedia(token);
		if (!live.ok) {
			return c.json(
				{ error: "github_failed", message: live.message ?? "读取仓库目录失败" },
				502,
			);
		}
		live.entries.sort((a, b) => b.path.localeCompare(a.path));
		return c.json({
			files: live.entries,
			refs: index.refs,
			generated: Date.now(),
			live: true,
		});
	}

	return c.json({ ...index, live: false });
});

/**
 * 上传：多张图合并成一次提交。
 *
 * 路径固定 `public/assets/uploads/<yyyy>/<mm>/<词干>-<内容摘要8位>.<ext>`，
 * 内容相同就是同一路径，所以重复上传不会让仓库变胖。
 */
media.post(
	"/upload",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const payload = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const list = Array.isArray(payload.files) ? payload.files : [];
		if (list.length === 0) {
			return c.json({ error: "no_files", message: "没有收到文件" }, 400);
		}
		if (list.length > MAX_UPLOAD_FILES) {
			return c.json(
				{
					error: "too_many_files",
					message: `一次最多传 ${MAX_UPLOAD_FILES} 张`,
				},
				413,
			);
		}

		const files: IncomingFile[] = [];
		let total = 0;
		for (const item of list) {
			const record = (item ?? {}) as Record<string, unknown>;
			const name = typeof record.name === "string" ? record.name : "";
			const mime = typeof record.mime === "string" ? record.mime : "";
			const data = typeof record.data === "string" ? record.data : "";
			const bytes = decodeBase64(data);
			if (!bytes || bytes.byteLength === 0) {
				return c.json(
					{
						error: "invalid_data",
						message: `${name || "文件"} 不是合法的 base64`,
					},
					400,
				);
			}
			if (bytes.byteLength > MAX_UPLOAD_BYTES) {
				return c.json(
					{ error: "file_too_large", message: `${name || "文件"} 超过 5 MB` },
					413,
				);
			}
			total += bytes.byteLength;
			if (total > MAX_TOTAL_BYTES) {
				return c.json(
					{
						error: "batch_too_large",
						message: "这一批总大小超过 12 MB，分两批传",
					},
					413,
				);
			}
			files.push({ name, mime, bytes });
		}

		const token = await resolveGithubToken(c.env);
		if (!token) {
			return c.json(
				{
					error: "github_token_missing",
					message: "还没配置 GitHub 令牌，去「站点设置 → 集成」填一个",
				},
				412,
			);
		}

		const result = await uploadMedia({ token, files, actorUid: user.uid });
		if (!result.ok) {
			await writeAudit(c.env.DB, {
				actorUid: user.uid,
				action: "media.upload",
				target: "media",
				detail: { count: files.length, status: result.status },
			});
			return c.json(
				{ error: "upload_failed", message: result.message ?? "上传失败" },
				asStatus(result.status),
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "media.upload",
			target: "media",
			detail: {
				count: result.created.length,
				path: result.created[0]?.path ?? result.reused[0]?.path,
			},
		});

		return c.json(
			{
				ok: true,
				commit: result.commit ?? null,
				created: result.created,
				reused: result.reused,
			},
			result.created.length > 0 ? 201 : 200,
		);
	},
);

/** 删除：先查引用，被文章用着就拦住并列出来 */
media.delete(
	"/library",
	requireRole("admin"),
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const path = typeof body.path === "string" ? body.path : "";
		if (!path) {
			return c.json({ error: "bad_request", message: "缺少 path" }, 400);
		}

		const token = await resolveGithubToken(c.env);
		if (!token) {
			return c.json(
				{ error: "github_token_missing", message: "还没配置 GitHub 令牌" },
				412,
			);
		}

		const result = await deleteMedia({ env: c.env, token, path });
		if (!result.ok) {
			return c.json(
				{
					error: result.status === 409 ? "in_use" : "delete_failed",
					message: result.message ?? "删除失败",
					usedBy: result.usedBy,
				},
				asStatus(result.status),
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "media.delete",
			target: path,
			detail: { path },
		});

		return c.json({ ok: true, commit: result.commit ?? null });
	},
);

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
