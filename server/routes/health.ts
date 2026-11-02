import { Hono } from "hono";

export const health: Hono<{ Bindings: Env }> = new Hono<{ Bindings: Env }>();

/**
 * 骨架阶段的健康检查：Worker 活着、D1 能读。
 * 不查任何业务表，避免迁移未跑时给出误判。
 */
health.get("/health", async (c) => {
	const time = new Date().toISOString();
	try {
		const row = await c.env.DB.prepare("select 1 as ok").first<{
			ok: number;
		}>();
		if (row?.ok !== 1) {
			throw new Error(`unexpected health probe result: ${JSON.stringify(row)}`);
		}
		return c.json({ ok: true, db: "ok", time });
	} catch (error) {
		console.error("[worker] health check failed", error);
		return c.json({ ok: false, db: "error", time }, 503);
	}
});
