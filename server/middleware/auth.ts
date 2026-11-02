import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { sha256Hex } from "../lib/crypto";
import { findSession, SESSION_COOKIE } from "../lib/session";
import { type AppEnv, ROLE_LEVEL, type Role } from "../types";

/**
 * 读 cookie 并挂到 c.var.user，只做读取，不拦请求。
 * 是否要求登录、是否封禁，交给 requireAuth / requireRole 判——
 * 否则 /api/health 这类公开接口也会被登录态影响。
 */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
	c.set("user", null);
	const token = getCookie(c, SESSION_COOKIE);
	if (token) {
		const user = await findSession(c.env.DB, await sha256Hex(token));
		if (user) c.set("user", user);
	}
	await next();
};

/** 没有有效会话 → 401；有会话但账号被停用 → 403 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "unauthorized", message: "请先登录" }, 401);
	}
	if (user.status !== "active") {
		return c.json({ error: "account_suspended", message: "账号已被停用" }, 403);
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
				{ error: "account_suspended", message: "账号已被停用" },
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
