import { Hono } from "hono";
import { health } from "./routes/health";

type AppEnv = { Bindings: Env };

export const app: Hono<AppEnv> = new Hono<AppEnv>();

app.route("/api", health);

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
