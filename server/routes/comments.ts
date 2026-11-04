import { Hono } from "hono";
import { writeAudit } from "../lib/audit";
import {
	checkCommentSettings,
	countComments,
	deleteCommentTree,
	findCommentById,
	findReplyTarget,
	hashGuestEmail,
	hashGuestToken,
	insertComment,
	isValidTarget,
	listAdminComments,
	listPublicComments,
	readCommentSettings,
	setCommentStatus,
	verifyGuestToken,
	writeCommentSettings,
} from "../lib/comments";
import { hmacSha256Hex, randomToken } from "../lib/crypto";
import { consumeRate } from "../lib/ratelimit";
import { normalizeEmail } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

/**
 * 站内评论。
 *
 * 前台只认 target（文章 slug / guestbook / dynamic:<id>），不认 URL ——
 * URL 会随路由配置变化，评论不能跟着丢。
 *
 * 响应里永远不出现邮箱与 IP：游客邮箱只留摘要，IP 只留 HMAC。
 */

const MAX_NAME = 20;

function clientIp(c: {
	req: { header: (name: string) => string | undefined };
}): string {
	const direct = c.req.header("cf-connecting-ip");
	if (direct) return direct;
	const forwarded = c.req.header("x-forwarded-for");
	if (forwarded) return forwarded.split(",")[0].trim();
	return c.req.header("x-real-ip") ?? "local";
}

async function ipHashOf(secret: string, ip: string): Promise<string> {
	// HMAC 而不是裸 sha256：IP 空间小，裸摘要一撞就出原文
	return await hmacSha256Hex(secret, `comment-ip:${ip}`);
}

function charLength(value: string): number {
	// 按码点算，避免 emoji 被算成两个字
	return [...value].length;
}

export const comments: Hono<AppEnv> = new Hono<AppEnv>();

comments.get("/", async (c) => {
	const target = c.req.query("target") ?? "";
	if (!isValidTarget(target)) {
		return c.json({ error: "invalid_target", message: "target 不合法" }, 400);
	}

	const settings = await readCommentSettings(c.env.DB);
	const user = c.get("user");
	const { items, total } = settings.enabled
		? await listPublicComments(c.env.DB, target, user?.uid ?? null)
		: { items: [], total: 0 };

	return c.json({
		target,
		config: {
			enabled: settings.enabled,
			requireApproval: settings.requireApproval,
			allowGuest: settings.allowGuest,
			maxLength: settings.maxLength,
		},
		total,
		items,
		// 方便前端直接显示「以谁的身份发言」，不必再打一次 /me
		viewer: user
			? {
					uid: user.uid,
					name: user.display_name,
					avatar_url: user.avatar_url,
					is_admin: user.role === "admin" || user.role === "reviewer",
				}
			: null,
	});
});

comments.get("/count", async (c) => {
	const raw = c.req.query("targets") ?? "";
	const targets = raw
		.split(",")
		.map((item) => item.trim())
		.filter((item) => isValidTarget(item));
	const counts = await countComments(c.env.DB, targets);
	return c.json({ counts });
});

comments.post("/", requireJsonBody, sameOriginGuard, async (c) => {
	const db = c.env.DB;
	const settings = await readCommentSettings(db);
	if (!settings.enabled) {
		return c.json(
			{ error: "comments_disabled", message: "评论功能已关闭" },
			403,
		);
	}

	const payload = (await c.req.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;

	const target = typeof payload.target === "string" ? payload.target : "";
	if (!isValidTarget(target)) {
		return c.json({ error: "invalid_target", message: "target 不合法" }, 400);
	}

	const user = c.get("user");
	if (user && user.status !== "active") {
		return c.json(
			{ error: "account_disabled", message: "账号不可用，无法评论" },
			403,
		);
	}
	if (!user && !settings.allowGuest) {
		return c.json({ error: "login_required", message: "登录后才能评论" }, 403);
	}

	const body = typeof payload.body === "string" ? payload.body.trim() : "";
	if (body.length === 0) {
		return c.json({ error: "empty_body", message: "评论不能为空" }, 400);
	}
	if (charLength(body) > settings.maxLength) {
		return c.json(
			{
				error: "too_long",
				message: `最多 ${settings.maxLength} 字`,
				maxLength: settings.maxLength,
			},
			400,
		);
	}

	let guestName: string | null = null;
	let guestEmailHash: string | null = null;
	// 游客没有 uid，也没有可信身份：邮箱是自填的、没人核验，不能拿来认人。
	// 改成发一个一次性令牌，摘要入库，原文只在这里返回一次，由浏览器保管。
	let guestToken: string | null = null;
	let guestTokenHash: string | null = null;
	if (!user) {
		const name = typeof payload.name === "string" ? payload.name.trim() : "";
		if (charLength(name) < 1 || charLength(name) > MAX_NAME) {
			return c.json(
				{ error: "invalid_name", message: `昵称 1–${MAX_NAME} 字` },
				400,
			);
		}
		guestName = name;

		const email = normalizeEmail(payload.email);
		if (!email) {
			return c.json({ error: "invalid_email", message: "邮箱格式不对" }, 400);
		}
		guestEmailHash = await hashGuestEmail(email);

		guestToken = randomToken(32);
		guestTokenHash = await hashGuestToken(guestToken);
	}

	const parentRaw = payload.parentId;
	let parentId: number | null = null;
	if (parentRaw !== undefined && parentRaw !== null) {
		const id = Number(parentRaw);
		if (!Number.isInteger(id) || id <= 0) {
			return c.json(
				{ error: "invalid_parent", message: "回复目标不正确" },
				400,
			);
		}
		const parent = await findReplyTarget(db, id, target);
		if (!parent) {
			return c.json(
				{ error: "parent_not_found", message: "要回复的评论不存在" },
				404,
			);
		}
		parentId = parent.id;
	}

	const ip = clientIp(c);
	const ipHash = await ipHashOf(c.env.SESSION_SECRET ?? "dev", ip);
	const now = Math.floor(Date.now() / 1000);

	// 两道闸：最小间隔挡连点，小时窗挡脚本刷
	const burst = await consumeRate(
		db,
		"comment-gap",
		ipHash,
		1,
		Math.max(1, settings.rateSeconds),
		now,
	);
	if (!burst.allowed) {
		return c.json(
			{
				error: "rate_limited",
				message: `慢一点，${burst.retryAfter} 秒后再发`,
				retryAfter: burst.retryAfter,
			},
			429,
		);
	}
	const hourly = await consumeRate(db, "comment-hour", ipHash, 20, 3600, now);
	if (!hourly.allowed) {
		return c.json(
			{
				error: "rate_limited",
				message: "一小时内发得太多了，歇会儿",
				retryAfter: hourly.retryAfter,
			},
			429,
		);
	}

	const isAdmin = user?.role === "admin" || user?.role === "reviewer";
	const status = isAdmin || !settings.requireApproval ? "approved" : "pending";
	const id = await insertComment(db, {
		target,
		parentId,
		bodyMd: body,
		uid: user?.uid ?? null,
		guestName,
		guestEmailHash,
		guestTokenHash,
		isAdmin: isAdmin === true,
		ipHash,
		status,
	});

	await writeAudit(db, {
		actorUid: user?.uid ?? null,
		action: "comment.create",
		target: `${target}#${id}`,
		detail: { status, guest: !user, comment_id: id },
		ipHash,
	});

	return c.json(
		{
			id,
			status,
			// 只在游客发表的这一次返回；丢了就再也没法删了，前端必须存下来
			guest_token: guestToken ?? undefined,
			message:
				status === "approved" ? "已发布" : "已提交，等站长看一眼就会显示",
		},
		201,
	);
});

/**
 * 删自己的评论；管理员走 /api/admin/comments/:id，权限更宽。
 *
 * 三种身份：
 *   · 管理员  —— 谁都删得了
 *   · 登录用户 —— 只删自己 uid 的
 *   · 游客    —— 带发表时拿到的令牌，比对库里的摘要
 * 令牌走 header 而不是 query：query 会进访问日志和 Referer。
 */
comments.delete("/:id", sameOriginGuard, async (c) => {
	const id = Number(c.req.param("id"));
	if (!Number.isInteger(id) || id <= 0) {
		return c.json({ error: "invalid_id", message: "评论 id 不正确" }, 400);
	}

	const row = await findCommentById(c.env.DB, id);
	if (!row) {
		return c.json({ error: "not_found", message: "评论不存在" }, 404);
	}

	const user = c.get("user");
	let allowed = false;
	if (user) {
		allowed = user.role === "admin" || row.uid === user.uid;
	} else {
		allowed = await verifyGuestToken(
			c.req.header("x-comment-token") ?? "",
			row.guest_token_hash,
		);
	}

	if (!allowed) {
		return c.json(
			{
				error: "forbidden",
				message: user
					? "只能删自己的评论"
					: "这条评论不是本浏览器发表的，删不了",
			},
			403,
		);
	}

	const target = await deleteCommentTree(c.env.DB, id);
	await writeAudit(c.env.DB, {
		actorUid: user?.uid ?? null,
		action: "comment.delete",
		target: target ? `${target}#${id}` : `#${id}`,
		detail: {
			comment_id: id,
			by_admin: user?.role === "admin",
			by_guest_token: !user,
		},
	});
	return c.json({ ok: true });
});

/**
 * 管理端。单独一个 router 挂在 /api/admin 上，
 * 好处是权限守卫只写在最外层一次，不会漏。
 */
export const commentsAdmin: Hono<AppEnv> = new Hono<AppEnv>();

commentsAdmin.use("/*", requireRole("reviewer"));

commentsAdmin.get("/comments", async (c) => {
	const status = c.req.query("status") ?? "pending";
	const target = (c.req.query("target") ?? "").trim();
	const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
	const result = await listAdminComments(c.env.DB, {
		status,
		target,
		page,
		pageSize: 20,
	});
	return c.json({ ...result, page, pageSize: 20, status, target });
});

commentsAdmin.post(
	"/comments/:id/status",
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);
		}
		const id = Number(c.req.param("id"));
		const payload = (await c.req.json().catch(() => ({}))) as {
			status?: unknown;
		};
		const status = payload.status;
		if (
			status !== "approved" &&
			status !== "rejected" &&
			status !== "pending"
		) {
			return c.json({ error: "invalid_status", message: "状态不对" }, 400);
		}
		if (!Number.isInteger(id) || id <= 0) {
			return c.json({ error: "invalid_id", message: "评论 id 不正确" }, 400);
		}

		const row = await findCommentById(c.env.DB, id);
		if (!row) {
			return c.json({ error: "not_found", message: "评论不存在" }, 404);
		}

		const ok = await setCommentStatus(c.env.DB, id, status, user.uid);
		if (!ok) {
			return c.json({ error: "not_found", message: "评论不存在" }, 404);
		}
		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "comment.review",
			target: `${row.target}#${id}`,
			detail: { status, comment_id: id },
		});
		return c.json({ ok: true, status });
	},
);

commentsAdmin.delete("/comments/:id", sameOriginGuard, async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "unauthorized", message: "请先登录" }, 401);
	}
	const id = Number(c.req.param("id"));
	if (!Number.isInteger(id) || id <= 0) {
		return c.json({ error: "invalid_id", message: "评论 id 不正确" }, 400);
	}
	const target = await deleteCommentTree(c.env.DB, id);
	if (target === null) {
		return c.json({ error: "not_found", message: "评论不存在" }, 404);
	}
	await writeAudit(c.env.DB, {
		actorUid: user.uid,
		action: "comment.delete",
		target: `${target}#${id}`,
		detail: { comment_id: id, by_admin: true },
	});
	return c.json({ ok: true });
});

commentsAdmin.get("/comments/config", async (c) => {
	return c.json({ config: await readCommentSettings(c.env.DB) });
});

commentsAdmin.put(
	"/comments/config",
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (user?.role !== "admin") {
			return c.json({ error: "forbidden", message: "需要 admin 权限" }, 403);
		}
		const payload = await c.req.json().catch(() => ({}));
		const check = checkCommentSettings(payload);
		if (!check.ok) {
			return c.json(
				{
					error: "invalid_config",
					message: check.issues[0] ?? "配置不合法",
					issues: check.issues,
				},
				400,
			);
		}
		await writeCommentSettings(c.env.DB, check.value, user.uid);
		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "admin.comments.config",
			detail: {
				keys: Object.keys(check.value).join(","),
				requireApproval: check.value.requireApproval,
				enabled: check.value.enabled,
			},
		});
		return c.json({ ok: true, config: check.value });
	},
);
