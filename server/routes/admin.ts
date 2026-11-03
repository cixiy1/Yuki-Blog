import { type Context, Hono } from "hono";
import { writeAudit } from "../lib/audit";
import { encryptPassword } from "../lib/password";
import { findByAccount, findByEmail, randomUid } from "../lib/users";
import {
	checkPasswordPolicy,
	isValidSlug,
	normalizeAccount,
	normalizeEmail,
} from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";
import { type PostRow, publishRowToRepo, toDetail } from "./me";

/**
 * 管理端接口：用户管理 + 审计日志。
 * 权限一律 requireRole("admin")——前端隐藏菜单只是体验，这里才是拦人的地方。
 * 响应里永远不出现 password_enc，列名一律显式列出，不用 SELECT *。
 */
export const admin: Hono<AppEnv> = new Hono<AppEnv>();

const LIST_COLUMNS =
	"u.uid, u.account, u.email, u.email_verified_at, u.role, u.status, u.display_name, u.avatar_url, u.last_login_at, u.created_at";

const ROLES = new Set(["user", "reviewer", "admin"]);
const STATUSES = new Set(["pending", "active", "disabled", "deleted"]);

const MAX_UID_RETRY = 5;
const NAME_MAX = 32;

/**
 * 改/删管理员时唯一的硬约束：操作完得还有别人能管站点。
 *
 * 原来的做法是「管理员一律不可改」，安全但把一个功能废掉了——站点通常只有
 * 一个管理员，于是那一行永远是锁的。现在按结果判断：只要还剩一个 active
 * admin 就放行，剩下最后一个时拒绝。
 */
async function otherActiveAdmins(
	db: D1Database,
	excludeUid: number,
): Promise<number> {
	const row = await db
		.prepare(
			"SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND uid <> ?1",
		)
		.bind(excludeUid)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

function readName(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const name = raw.trim();
	if (!name || name.length > NAME_MAX) return null;
	return name;
}

interface AdminUserRow {
	uid: number;
	account: string;
	email: string;
	email_verified_at: string | null;
	role: string;
	status: string;
	display_name: string;
	avatar_url: string | null;
	last_login_at: string | null;
	created_at: string;
}

interface AuditRow {
	id: number;
	actor_uid: number | null;
	action: string;
	target: string | null;
	detail_json: string | null;
	ip_hash: string | null;
	created_at: string;
}

function toPublic(row: AdminUserRow): Record<string, unknown> {
	return {
		uid: row.uid,
		account: row.account,
		email: row.email,
		role: row.role,
		status: row.status,
		display_name: row.display_name,
		avatar_url: row.avatar_url,
		email_verified: row.email_verified_at ? 1 : 0,
		last_login_at: row.last_login_at,
		created_at: row.created_at,
	};
}

function toAudit(row: AuditRow): Record<string, unknown> {
	return {
		id: row.id,
		actor_uid: row.actor_uid,
		action: row.action,
		target: row.target,
		detail: row.detail_json,
		ip_hash: row.ip_hash,
		created_at: row.created_at,
	};
}

function clampInt(
	raw: string | undefined,
	fallback: number,
	max: number,
): number {
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) return fallback;
	return Math.min(value, max);
}

async function readJson(
	c: Context<AppEnv>,
): Promise<Record<string, unknown> | null> {
	try {
		const body = await c.req.json();
		if (body && typeof body === "object" && !Array.isArray(body)) {
			return body as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

/** 冒烟探针，顺带报告当前角色 */
admin.get("/ping", requireRole("admin"), (c) => {
	const user = c.get("user");
	return c.json({ ok: true, role: user?.role ?? null });
});

admin.get("/users", requireRole("admin"), async (c) => {
	const q = (c.req.query("q") ?? "").trim();
	const role = c.req.query("role") ?? "";
	const status = c.req.query("status") ?? "";
	const page = clampInt(c.req.query("page"), 1, 10_000);
	const limit = clampInt(c.req.query("limit"), 20, 100);

	const where: string[] = [];
	const binds: unknown[] = [];

	if (q) {
		where.push(
			"(u.account LIKE ?1 OR u.email LIKE ?1 OR u.display_name LIKE ?1)",
		);
		binds.push(`%${q}%`);
	}
	if (ROLES.has(role)) {
		where.push(`u.role = ?${binds.length + 1}`);
		binds.push(role);
	}
	if (STATUSES.has(status)) {
		where.push(`u.status = ?${binds.length + 1}`);
		binds.push(status);
	}
	const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

	const totalRow = await c.env.DB.prepare(
		`SELECT COUNT(*) AS total FROM users u ${clause}`,
	)
		.bind(...binds)
		.first<{ total: number }>();

	const rows = await c.env.DB.prepare(
		`SELECT ${LIST_COLUMNS} FROM users u ${clause}
		  ORDER BY u.created_at DESC, u.uid DESC
		  LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
	)
		.bind(...binds, limit, (page - 1) * limit)
		.all<AdminUserRow>();

	return c.json({
		users: (rows.results ?? []).map(toPublic),
		total: totalRow?.total ?? 0,
		page,
		limit,
	});
});

admin.get("/users/:uid", requireRole("admin"), async (c) => {
	const uid = Number(c.req.param("uid"));
	if (!Number.isInteger(uid) || uid <= 0) {
		return c.json({ error: "bad_request", message: "uid 非法" }, 400);
	}

	const row = await c.env.DB.prepare(
		`SELECT ${LIST_COLUMNS} FROM users u WHERE u.uid = ?1`,
	)
		.bind(uid)
		.first<AdminUserRow>();
	if (!row) {
		return c.json({ error: "user_not_found", message: "用户不存在" }, 404);
	}

	const audits = await c.env.DB.prepare(
		`SELECT id, actor_uid, action, target, detail_json, ip_hash, created_at
		   FROM audit_log WHERE actor_uid = ?1 OR target = ?2
		  ORDER BY id DESC LIMIT 20`,
	)
		.bind(uid, row.account)
		.all<AuditRow>();

	return c.json({
		user: toPublic(row),
		audit: (audits.results ?? []).map(toAudit),
	});
});

admin.post(
	"/users",
	requireRole("admin"),
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const me = c.get("user");
		if (!me) return c.json({ error: "unauthorized" }, 401);
		const key = c.env.PASSWORD_ENC_KEY;
		if (!key) {
			return c.json(
				{ error: "misconfigured", message: "服务端没配 PASSWORD_ENC_KEY" },
				500,
			);
		}

		const body = await readJson(c);
		const account = normalizeAccount(body?.account);
		const email = normalizeEmail(body?.email);
		const policy = checkPasswordPolicy(body?.password);

		if (!account) {
			return c.json(
				{
					error: "invalid_account",
					message:
						"登录名 3–20 位，只能用小写字母、数字、下划线，且不能是保留字",
					field: "account",
				},
				400,
			);
		}
		if (!email) {
			return c.json(
				{ error: "invalid_email", message: "邮箱格式不正确", field: "email" },
				400,
			);
		}
		if (!policy.ok || !policy.value) {
			return c.json(
				{
					error: "weak_password",
					message: policy.message ?? "密码不符合要求",
					field: "password",
				},
				400,
			);
		}

		const name = readName(body?.display_name) ?? account;
		const role = body?.role === undefined ? "user" : String(body?.role);
		const status = body?.status === undefined ? "active" : String(body?.status);
		if (!ROLES.has(role)) {
			return c.json({ error: "invalid_role", message: "角色不合法" }, 400);
		}
		if (status !== "active" && status !== "pending") {
			return c.json(
				{ error: "invalid_status", message: "新建用户只能是正常或待验证" },
				400,
			);
		}

		if (await findByAccount(c.env.DB, account)) {
			return c.json(
				{
					error: "account_taken",
					message: "这个登录名已被占用",
					field: "account",
				},
				409,
			);
		}
		if (await findByEmail(c.env.DB, email)) {
			return c.json(
				{ error: "email_taken", message: "这个邮箱已经注册过", field: "email" },
				409,
			);
		}

		let created: AdminUserRow | null = null;
		let attempt = 0;
		while (attempt < MAX_UID_RETRY && !created) {
			attempt += 1;
			const uid = randomUid();
			// uid 参与 AAD，重试要针对新 uid 重新加密
			const enc = await encryptPassword(key, uid, policy.value);
			if (!enc) break;
			try {
				created = await c.env.DB.prepare(
					`INSERT INTO users
					   (uid, account, email, email_verified_at, role, status, display_name,
					    password_enc, password_updated_at)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
					 RETURNING ${LIST_COLUMNS.replaceAll("u.", "")}`,
				)
					.bind(
						uid,
						account,
						email,
						status === "active" ? new Date().toISOString() : null,
						role,
						status,
						name,
						enc,
					)
					.first<AdminUserRow>();
			} catch (error) {
				if (attempt >= MAX_UID_RETRY) {
					console.error("[admin] 建号失败", error);
					return c.json(
						{ error: "create_failed", message: "创建失败，请重试" },
						500,
					);
				}
			}
		}

		if (!created) {
			return c.json(
				{ error: "create_failed", message: "创建失败，请换一个登录名重试" },
				500,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: me.uid,
			action: "admin.user.create",
			target: account,
			detail: { uid: created.uid, role, status },
		});

		return c.json({ user: toPublic(created) }, 201);
	},
);

admin.delete(
	"/users/:uid",
	requireRole("admin"),
	sameOriginGuard,
	async (c) => {
		const me = c.get("user");
		if (!me) return c.json({ error: "unauthorized" }, 401);

		const uid = Number(c.req.param("uid"));
		if (!Number.isInteger(uid) || uid <= 0) {
			return c.json({ error: "bad_request", message: "uid 非法" }, 400);
		}
		if (uid === me.uid) {
			return c.json(
				{ error: "self_forbidden", message: "不能删除自己的账号" },
				409,
			);
		}

		const row = await c.env.DB.prepare(
			`SELECT ${LIST_COLUMNS} FROM users u WHERE u.uid = ?1`,
		)
			.bind(uid)
			.first<AdminUserRow>();
		if (!row) {
			return c.json({ error: "user_not_found", message: "用户不存在" }, 404);
		}
		if (row.status === "deleted") {
			return c.json(
				{ error: "already_deleted", message: "这个账号已经删过" },
				409,
			);
		}
		if (
			row.role === "admin" &&
			row.status === "active" &&
			(await otherActiveAdmins(c.env.DB, uid)) === 0
		) {
			return c.json(
				{ error: "last_admin", message: "这是最后一个可用管理员，不能删除" },
				409,
			);
		}

		// 软删除：账号名与邮箱要释放出来，不然本人想重新注册会被占用。
		// 审计按 uid 留档，历史记录不受影响。
		const deleted = await c.env.DB.prepare(
			`UPDATE users
		    SET status = 'deleted',
		        account = ?1,
		        email = ?2,
		        display_name = '已注销用户',
		        avatar_url = NULL,
		        bio = NULL,
		        password_enc = NULL,
		        session_epoch = session_epoch + 1,
		        updated_at = datetime('now')
		  WHERE uid = ?3 AND status <> 'deleted'
		 RETURNING ${LIST_COLUMNS.replaceAll("u.", "")}`,
		)
			.bind(`deleted_${uid}`, `deleted+${uid}@deleted.invalid`, uid)
			.first<AdminUserRow>();

		if (!deleted) {
			return c.json(
				{ error: "conflict", message: "这个用户刚被别人改过，刷新再试" },
				409,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: me.uid,
			action: "admin.user.delete",
			target: row.account,
			detail: { uid, role: row.role, status: row.status },
		});

		return c.json({ ok: true, user: toPublic(deleted) });
	},
);

admin.patch(
	"/users/:uid",
	requireRole("admin"),
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const me = c.get("user");
		if (!me) return c.json({ error: "unauthorized" }, 401);

		const uid = Number(c.req.param("uid"));
		if (!Number.isInteger(uid) || uid <= 0) {
			return c.json({ error: "bad_request", message: "uid 非法" }, 400);
		}

		const body = await readJson(c);
		const row = await c.env.DB.prepare(
			`SELECT ${LIST_COLUMNS} FROM users u WHERE u.uid = ?1`,
		)
			.bind(uid)
			.first<AdminUserRow>();
		if (!row) {
			return c.json({ error: "user_not_found", message: "用户不存在" }, 404);
		}
		if (row.status === "deleted") {
			return c.json({ error: "user_deleted", message: "这个账号已注销" }, 409);
		}

		const has = (key: string): boolean => body?.[key] !== undefined;
		if (!["status", "role", "display_name", "email", "password"].some(has)) {
			return c.json({ error: "no_change", message: "没有要改的字段" }, 400);
		}

		// 自己那一行只放资料字段：角色/状态一改就可能把自己锁在门外，
		// 密码走「改密码」入口（要验旧密码），不在这里重置。
		if (uid === me.uid) {
			const forbidden = ["status", "role", "password"].filter(has);
			if (forbidden.length > 0) {
				return c.json(
					{
						error: "self_forbidden",
						message: "不能在这里改自己的角色、状态或密码",
					},
					409,
				);
			}
		}

		const nextStatus = has("status") ? String(body?.status) : row.status;
		const nextRole = has("role") ? String(body?.role) : row.role;
		if (!STATUSES.has(nextStatus)) {
			return c.json({ error: "invalid_status", message: "状态不合法" }, 400);
		}
		if (nextStatus === "deleted") {
			return c.json(
				{ error: "invalid_status", message: "删除用户请用删除按钮" },
				400,
			);
		}
		if (!ROLES.has(nextRole)) {
			return c.json({ error: "invalid_role", message: "角色不合法" }, 400);
		}

		let nextName = row.display_name;
		if (has("display_name")) {
			const name = readName(body?.display_name);
			if (!name) {
				return c.json(
					{
						error: "invalid_name",
						message: `昵称 1–${NAME_MAX} 个字符`,
						field: "display_name",
					},
					400,
				);
			}
			nextName = name;
		}

		let nextEmail = row.email;
		let clearVerified = false;
		if (has("email")) {
			const email = normalizeEmail(body?.email);
			if (!email) {
				return c.json(
					{ error: "invalid_email", message: "邮箱格式不正确", field: "email" },
					400,
				);
			}
			if (email !== row.email) {
				const owner = await findByEmail(c.env.DB, email);
				if (owner && owner.uid !== uid) {
					return c.json(
						{ error: "email_taken", message: "这个邮箱已经被别的账号用了" },
						409,
					);
				}
				nextEmail = email;
				// 换了邮箱就不能再算已验证，等本人点新链接
				clearVerified = true;
			}
		}

		let enc: string | null = null;
		if (has("password")) {
			const key = c.env.PASSWORD_ENC_KEY;
			const policy = checkPasswordPolicy(body?.password);
			if (!key) {
				return c.json(
					{ error: "misconfigured", message: "服务端没配 PASSWORD_ENC_KEY" },
					500,
				);
			}
			if (!policy.ok || !policy.value) {
				return c.json(
					{
						error: "weak_password",
						message: policy.message ?? "密码不符合要求",
						field: "password",
					},
					400,
				);
			}
			enc = await encryptPassword(key, uid, policy.value);
			if (!enc) {
				return c.json(
					{ error: "encrypt_failed", message: "密码加密失败" },
					500,
				);
			}
		}

		// 唯一的不变式：操作之后至少还有一个能用（active）的管理员
		const wasActiveAdmin = row.role === "admin" && row.status === "active";
		const staysActiveAdmin = nextRole === "admin" && nextStatus === "active";
		if (
			wasActiveAdmin &&
			!staysActiveAdmin &&
			(await otherActiveAdmins(c.env.DB, uid)) === 0
		) {
			return c.json(
				{
					error: "last_admin",
					message: "这是最后一个可用管理员，降级或停用后没人能管站点",
				},
				409,
			);
		}

		const sets: string[] = [];
		const binds: unknown[] = [];
		const push = (sql: string, value: unknown): void => {
			binds.push(value);
			sets.push(sql.replace("?", `?${binds.length}`));
		};
		if (nextStatus !== row.status) push("status = ?", nextStatus);
		if (nextRole !== row.role) push("role = ?", nextRole);
		if (nextName !== row.display_name) push("display_name = ?", nextName);
		if (nextEmail !== row.email) push("email = ?", nextEmail);
		if (clearVerified) sets.push("email_verified_at = NULL");
		if (enc) {
			push("password_enc = ?", enc);
			sets.push("password_updated_at = datetime('now')");
		}
		// 停用、改密要立刻踢掉旧会话
		const bump =
			(nextStatus === "disabled" && row.status !== "disabled") || enc !== null;
		if (bump) sets.push("session_epoch = session_epoch + 1");
		sets.push("updated_at = datetime('now')");

		binds.push(uid, row.status, row.role);
		const updated = await c.env.DB.prepare(
			`UPDATE users SET ${sets.join(", ")}
			  WHERE uid = ?${binds.length - 2} AND status = ?${binds.length - 1} AND role = ?${binds.length}
			 RETURNING ${LIST_COLUMNS.replaceAll("u.", "")}`,
		)
			.bind(...binds)
			.first<AdminUserRow>();

		if (!updated) {
			return c.json(
				{ error: "conflict", message: "这个用户刚被别人改过，刷新再试" },
				409,
			);
		}

		if (nextStatus !== row.status) {
			await writeAudit(c.env.DB, {
				actorUid: me.uid,
				action: "admin.user.status",
				target: row.account,
				detail: { from: row.status, to: nextStatus },
			});
		}
		if (nextRole !== row.role) {
			await writeAudit(c.env.DB, {
				actorUid: me.uid,
				action: "admin.user.role",
				target: row.account,
				detail: { from: row.role, to: nextRole },
			});
		}
		if (nextName !== row.display_name) {
			await writeAudit(c.env.DB, {
				actorUid: me.uid,
				action: "admin.user.profile",
				target: row.account,
				detail: { field: "display_name", from: row.display_name, to: nextName },
			});
		}
		if (nextEmail !== row.email) {
			await writeAudit(c.env.DB, {
				actorUid: me.uid,
				action: "admin.user.profile",
				target: row.account,
				detail: { field: "email", from: row.email, to: nextEmail },
			});
		}
		if (enc) {
			await writeAudit(c.env.DB, {
				actorUid: me.uid,
				action: "admin.user.password",
				target: row.account,
				detail: { reset: true },
			});
		}

		return c.json({ user: toPublic(updated) });
	},
);

admin.get("/audit", requireRole("admin"), async (c) => {
	const action = (c.req.query("action") ?? "").trim();
	const page = clampInt(c.req.query("page"), 1, 10_000);
	const limit = clampInt(c.req.query("limit"), 30, 100);

	const where: string[] = [];
	const binds: unknown[] = [];
	if (action) {
		where.push("action = ?1");
		binds.push(action);
	}
	const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

	const totalRow = await c.env.DB.prepare(
		`SELECT COUNT(*) AS total FROM audit_log ${clause}`,
	)
		.bind(...binds)
		.first<{ total: number }>();

	const rows = await c.env.DB.prepare(
		`SELECT id, actor_uid, action, target, detail_json, ip_hash, created_at
		   FROM audit_log ${clause}
		  ORDER BY id DESC
		  LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
	)
		.bind(...binds, limit, (page - 1) * limit)
		.all<AuditRow>();

	return c.json({
		logs: (rows.results ?? []).map(toAudit),
		total: totalRow?.total ?? 0,
		page,
		limit,
	});
});

/* ---------- 审核队列：reviewer 及以上 ---------- */

interface QueueRow {
	id: number;
	uid: number;
	slug: string;
	title: string;
	summary: string | null;
	submitted_at: string | null;
	updated_at: string;
	body_len: number;
	display_name: string | null;
	account: string;
}

const QUEUE_MAX_NOTE = 200;

/** 待审稿件。作者名取不到时退回登录名，别让队列里出现空白的「作者」 */
admin.get("/review/queue", requireRole("reviewer"), async (c) => {
	const rows = await c.env.DB.prepare(
		`SELECT p.id, p.uid, p.slug, p.title, p.summary, p.submitted_at, p.updated_at,
		        length(coalesce(p.body, '')) AS body_len,
		        u.display_name, u.account
		   FROM posts p
		   LEFT JOIN users u ON u.uid = p.uid
		  WHERE p.status = 'pending'
		  ORDER BY p.submitted_at ASC, p.id ASC
		  LIMIT 100`,
	).all<QueueRow>();

	return c.json({
		posts: (rows.results ?? []).map((row) => ({
			...row,
			author: row.display_name || row.account || `uid ${row.uid}`,
		})),
	});
});

/**
 * 单篇待审稿的全文。审核不能只看标题和摘要——队列里那点字判断不了
 * 有没有抄袭、有没有写错、有没有夹带私货，所以这里把正文与元数据一起给前端。
 * 范围放宽到 reviewer 可读任何一条投稿（含已处理的），方便回看。
 */
admin.get("/review/:id", requireRole("reviewer"), async (c) => {
	const id = Number(c.req.param("id"));
	if (!Number.isInteger(id) || id <= 0) {
		return c.json({ error: "bad_request", message: "id 非法" }, 400);
	}

	const row = await c.env.DB.prepare("SELECT * FROM posts WHERE id = ?1")
		.bind(id)
		.first<PostRow>();
	if (!row) {
		return c.json({ error: "not_found", message: "这篇不见了" }, 404);
	}

	const author = await c.env.DB.prepare(
		"SELECT display_name, account, avatar_url FROM users WHERE uid = ?1",
	)
		.bind(row.uid)
		.first<{
			display_name: string | null;
			account: string;
			avatar_url: string | null;
		}>();

	return c.json({
		post: {
			...toDetail(row),
			author:
				author?.display_name || author?.account || `uid ${row.uid}`,
			author_account: author?.account ?? "",
			author_avatar: author?.avatar_url ?? null,
		},
	});
});

/**
 * 通过：写仓库 → 状态切 published。
 * 写仓库复用发布那条路，审核通过和管理员自己发没有区别。
 */
admin.post(
	"/review/:id/approve",
	requireRole("reviewer"),
	sameOriginGuard,
	async (c) => {
		const me = c.get("user");
		if (!me) return c.json({ error: "unauthorized" }, 401);

		const id = Number(c.req.param("id"));
		if (!Number.isInteger(id) || id <= 0) {
			return c.json({ error: "bad_request", message: "id 非法" }, 400);
		}

		const row = await c.env.DB.prepare("SELECT * FROM posts WHERE id = ?1")
			.bind(id)
			.first<PostRow>();
		if (!row) {
			return c.json({ error: "not_found", message: "这篇不见了" }, 404);
		}
		if (row.status !== "pending") {
			return c.json(
				{ error: "not_pending", message: "这篇已经不在待审里了，刷新看看" },
				409,
			);
		}
		if (row.title.trim().length === 0) {
			return c.json({ error: "invalid_title", message: "标题是空的" }, 400);
		}
		if ((row.body ?? "").trim().length === 0) {
			return c.json({ error: "empty_body", message: "正文是空的" }, 400);
		}
		if (!isValidSlug(row.slug)) {
			return c.json(
				{ error: "invalid_slug", message: "文章地址不合法，先让作者改" },
				400,
			);
		}

		const written = await publishRowToRepo(c, row, "feat(post): 发布");
		if (!written.ok) {
			return c.json(written.body, written.status as 400);
		}

		const updated = await c.env.DB.prepare(
			`UPDATE posts
			    SET status = 'published', repo_path = ?1,
			        published_at = datetime('now'), reviewed_at = datetime('now'),
			        review_note = NULL, updated_at = datetime('now')
			  WHERE id = ?2 AND status = 'pending'
			 RETURNING *`,
		)
			.bind(written.path, id)
			.first<PostRow>();
		if (!updated) {
			return c.json(
				{ error: "conflict", message: "状态刚被改过，刷新再看" },
				409,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: me.uid,
			action: "review.approve",
			target: row.slug,
			detail: { id, uid: row.uid },
		});

		return c.json({
			post: { id, slug: row.slug, status: "published" },
			repoPath: written.path,
			building: true,
		});
	},
);

/** 退回：必须写理由，作者在「我的文章」里能看到 */
admin.post(
	"/review/:id/reject",
	requireRole("reviewer"),
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const me = c.get("user");
		if (!me) return c.json({ error: "unauthorized" }, 401);

		const id = Number(c.req.param("id"));
		if (!Number.isInteger(id) || id <= 0) {
			return c.json({ error: "bad_request", message: "id 非法" }, 400);
		}

		const body = await readJson(c);
		const note = typeof body?.note === "string" ? body.note.trim() : "";
		if (note.length === 0) {
			return c.json(
				{ error: "empty_note", message: "写一句退回理由，作者才知道改什么" },
				400,
			);
		}

		const updated = await c.env.DB.prepare(
			`UPDATE posts
			    SET status = 'rejected', review_note = ?1,
			        reviewed_at = datetime('now'), updated_at = datetime('now')
			  WHERE id = ?2 AND status = 'pending'
			 RETURNING *`,
		)
			.bind(note.slice(0, QUEUE_MAX_NOTE), id)
			.first<PostRow>();
		if (!updated) {
			return c.json(
				{ error: "not_pending", message: "这篇已经不在待审里了，刷新看看" },
				409,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: me.uid,
			action: "review.reject",
			target: updated.slug,
			detail: { id, uid: updated.uid, note: note.slice(0, QUEUE_MAX_NOTE) },
		});

		return c.json({ post: { id, slug: updated.slug, status: "rejected" } });
	},
);
