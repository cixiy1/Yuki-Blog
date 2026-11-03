import type { MiddlewareHandler } from "hono";
import { readSessionCookie, verifySession } from "../lib/session";
import { findByUid, toSessionUser } from "../lib/users";
import { type AppEnv, ROLE_LEVEL, type Role } from "../types";

/**
 * 读 cookie → 验签 → 查库 → 挂到 c.var.user。
 *
 * 无状态 cookie 的好处是不用查会话表，但「改角色 / 封禁 / 踢下线」必须立刻生效，
 * 所以这里仍然查一次 users（按 uid 的唯一索引，代价很小）。
 * 结论：一次请求只查这一次，后面的 requireRole 直接用结果，不再二次查库。
 *
 * 票里的 session_epoch 与库里不一致时**当作未登录**（401），
 * 不返回 403——否则等于告诉别人「这张票曾经是真的」。
 */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
	c.set("user", null);

	const secret = c.env.SESSION_SECRET;
	const raw = readSessionCookie(c);
	if (secret && raw) {
		const payload = await verifySession(
			secret,
			raw,
			Math.floor(Date.now() / 1000),
		);
		if (payload) {
			const row = await findByUid(c.env.DB, payload.u);
			if (row && row.session_epoch === payload.e) {
				c.set("user", toSessionUser(row));
			}
		}
	}

	await next();
};

/** 没有有效会话 → 401；有会话但账号不可用 → 403（区分原因，前端要给不同提示） */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "unauthorized", message: "请先登录" }, 401);
	}
	if (user.status === "pending") {
		return c.json(
			{ error: "email_unverified", message: "邮箱还没验证，先去收信" },
			403,
		);
	}
	if (user.status !== "active") {
		return c.json({ error: "account_disabled", message: "账号已被停用" }, 403);
	}
	await next();
};

/** 等级不够 → 403，与 401 分开，前端才能区分「去登录」和「没权限」 */
export function requireRole(minimum: Role): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);
		}
		if (user.status !== "active") {
			return c.json(
				{ error: "account_disabled", message: "账号已被停用" },
				403,
			);
		}
		const actual = ROLE_LEVEL[user.role as Role] ?? 0;
		if (actual < ROLE_LEVEL[minimum]) {
			return c.json(
				{
					error: "forbidden",
					message: `需要 ${minimum} 权限`,
					required_role: minimum,
					role: user.role,
				},
				403,
			);
		}
		await next();
	};
}
