import { Hono } from "hono";
import { loadSession } from "./middleware/auth";
import { noStore } from "./middleware/guard";
import { admin } from "./routes/admin";
import { auth } from "./routes/auth";
import { health } from "./routes/health";
import { me } from "./routes/me";
import type { AppEnv } from "./types";

export const app: Hono<AppEnv> = new Hono<AppEnv>();

// 认证相关响应一律不缓存；顺带让所有 API 都不被中间缓存
app.use("/api/*", noStore);
app.use("/api/*", loadSession);

app.route("/api", health);
app.route("/api/auth", auth);
app.route("/api/me", me);
app.route("/api/admin", admin);

// API 未命中返回 JSON，不要落成 HTML 404。
app.notFound((c) => {
	const { path } = c.req;
	if (path === "/api" || path.startsWith("/api/")) {
		return c.json({ error: "not_found", path }, 404);
	}
	return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
	console.error("[worker] unhandled error", error);
	return c.json({ error: "internal_error" }, 500);
});
