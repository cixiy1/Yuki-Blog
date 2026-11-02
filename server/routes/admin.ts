import { Hono } from "hono";
import { requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";

/**
 * P2 只放一个探针，用来验 401/403 分支。
 * P6 的用户/组织/设置管理都会挂在这个路由下面。
 */
export const admin: Hono<AppEnv> = new Hono<AppEnv>();

admin.get("/ping", requireRole("admin"), (c) => {
	const user = c.get("user");
	return c.json({ ok: true, role: user?.role ?? null });
});
