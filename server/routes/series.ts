import { Hono } from "hono";
import { writeAudit } from "../lib/audit";
import { resolveGithubToken } from "../lib/media-store";
import {
	listSeriesRows,
	readSeriesConfig,
	saveSeriesConfig,
} from "../lib/series-store";
import { requireRole } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

/**
 * 系列管理：封面、简介、卡片形态。
 *
 * 系列本身来自文章分组，这里只管「配置」这一半：读构建期快照 + 写仓库里的
 * `config/series.json`。保存即 commit，会触发一次构建，所以响应里带回 commit。
 */
export const seriesAdmin: Hono<AppEnv> = new Hono<AppEnv>();

seriesAdmin.get("/series", requireRole("admin"), async (c) => {
	const rows = await listSeriesRows(c.env.ASSETS);
	if (!rows.ok) {
		return c.json({ error: "index_failed", message: rows.message }, 502);
	}

	// 配置在仓库文件里，读它要令牌；令牌没配时页面上至少还能看到系列清单
	const token = await resolveGithubToken(c.env);
	if (!token) {
		return c.json({
			defaultLayout: "icon",
			series: {},
			rows: rows.rows,
			warning: "还没配置 GitHub 令牌，暂时只能看，不能保存",
		});
	}

	const config = await readSeriesConfig(token);
	if (!config.ok) {
		return c.json({
			error: "config_read_failed",
			message: config.message ?? "读取系列配置失败",
		});
	}

	return c.json({
		defaultLayout: config.config.defaultLayout,
		series: config.config.series,
		rows: rows.rows,
	});
});

seriesAdmin.put(
	"/series",
	requireRole("admin"),
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

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

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const series =
			body.series &&
			typeof body.series === "object" &&
			!Array.isArray(body.series)
				? (body.series as Record<string, unknown>)
				: {};

		const result = await saveSeriesConfig({
			token,
			defaultLayout: body.defaultLayout,
			series,
		});
		if (!result.ok) {
			await writeAudit(c.env.DB, {
				actorUid: user.uid,
				action: "series.update",
				target: "series",
				detail: { status: result.status, keys: Object.keys(series).join(",") },
			});
			return c.json(
				{ error: "save_failed", message: result.message ?? "保存失败" },
				result.status === 400 ? 400 : 502,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "series.update",
			target: "series",
			detail: {
				keys: Object.keys(series).join(","),
				sha: result.commit ?? null,
			},
		});

		return c.json({
			ok: true,
			commit: result.commit ?? null,
			defaultLayout: result.config.defaultLayout,
			series: result.config.series,
		});
	},
);
