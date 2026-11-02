import { type Context, Hono } from "hono";
import { writeAudit } from "../lib/audit";
import { requireRole } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

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
		if (uid === me.uid) {
			// 防呆：管理员把自己封了或被降权，就没人能管站点了
			return c.json(
				{ error: "self_forbidden", message: "不能修改自己的账号状态或角色" },
				409,
			);
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
		if (row.role === "admin") {
			// 第二个硬约束：管理员之间不能互相改，避免误操作锁死
			return c.json(
				{ error: "admin_immutable", message: "管理员账号只能在库里改" },
				409,
			);
		}

		const nextStatus = body?.status;
		const nextRole = body?.role;
		if (nextStatus === undefined && nextRole === undefined) {
			return c.json({ error: "no_change", message: "没有要改的字段" }, 400);
		}
		if (nextStatus !== undefined && !STATUSES.has(String(nextStatus))) {
			return c.json({ error: "invalid_status", message: "状态不合法" }, 400);
		}
		if (String(nextStatus) === "deleted") {
			return c.json(
				{ error: "invalid_status", message: "删除用户只能走运维脚本" },
				400,
			);
		}
		if (nextRole !== undefined) {
			if (!ROLES.has(String(nextRole))) {
				return c.json({ error: "invalid_role", message: "角色不合法" }, 400);
			}
			if (String(nextRole) === "admin") {
				return c.json(
					{ error: "admin_immutable", message: "不能通过接口把人提管理员" },
					409,
				);
			}
		}

		const status = nextStatus === undefined ? row.status : String(nextStatus);
		const role = nextRole === undefined ? row.role : String(nextRole);
		// 封禁即踢下线：session_epoch + 1，旧 cookie 立刻作废
		const bumpEpoch = status === "disabled" && row.status !== "disabled";

		const updated = await c.env.DB.prepare(
			`UPDATE users
			    SET status = ?1, role = ?2,
			        session_epoch = session_epoch + ?3,
			        updated_at = datetime('now')
			  WHERE uid = ?4 AND status = ?5
			 RETURNING ${LIST_COLUMNS.replaceAll("u.", "")}`,
		)
			.bind(status, role, bumpEpoch ? 1 : 0, uid, row.status)
			.first<AdminUserRow>();

		if (!updated) {
			return c.json(
				{ error: "conflict", message: "这个用户刚被别人改过，刷新再试" },
				409,
			);
		}

		if (status !== row.status) {
			await writeAudit(c.env.DB, {
				actorUid: me.uid,
				action: "admin.user.status",
				target: row.account,
				detail: { from: row.status, to: status },
			});
		}
		if (role !== row.role) {
			await writeAudit(c.env.DB, {
				actorUid: me.uid,
				action: "admin.user.role",
				target: row.account,
				detail: { from: row.role, to: role },
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
