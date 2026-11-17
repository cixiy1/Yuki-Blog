import { Hono } from "hono";
import { writeAudit } from "../lib/audit";
import {
	addCollaborator,
	COLLAB_LIMIT,
	canEditPost,
	canManageCollaborators,
	listCollaborators,
	removeCollaborator,
} from "../lib/collab";
import { readRepoPosts } from "../lib/post-index";
import { requireAuth } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

/**
 * 文章共创：邀请别人一起改这一篇。
 *
 * slug 走 query 而不用路径参数——子目录里的文章 slug 本身就带 `/`，
 * 塞进 `/:slug` 会被拆成两段。
 */
export const collab: Hono<AppEnv> = new Hono<AppEnv>();

interface OwnerRow {
	uid: number;
}

/** 文章作者：D1 里有行就以那一行为准，仓库里的老文章视为站主所有（null） */
async function ownerOf(
	db: D1Database,
	slug: string,
	assets: AssetsFetcher,
): Promise<{ ownerUid: number | null; exists: boolean }> {
	if (!slug) return { ownerUid: null, exists: false };

	const row = await db
		.prepare("SELECT uid FROM posts WHERE slug = ?1 LIMIT 1")
		.bind(slug)
		.first<OwnerRow>();
	if (row) return { ownerUid: row.uid, exists: true };

	const posts = await readRepoPosts(assets);
	return { ownerUid: null, exists: posts.some((post) => post.slug === slug) };
}

const BAD_SLUG = {
	error: "bad_request",
	message: "缺少 slug",
} as const;

const FORBIDDEN = {
	error: "forbidden",
	message: "只有作者与管理员能管理这篇的协作者",
} as const;

/** 成员名单：协作者也看得到（知道自己在和谁一起写），但只有作者能改 */
collab.get("/", requireAuth, async (c) => {
	const slug = (c.req.query("slug") ?? "").trim();
	if (!slug) return c.json(BAD_SLUG, 400);
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);

	const { ownerUid, exists } = await ownerOf(c.env.DB, slug, c.env.ASSETS);
	if (!exists)
		return c.json({ error: "not_found", message: "文章不存在" }, 404);

	const post = { slug, ownerUid };
	if (!(await canEditPost(c.env.DB, user, post))) {
		return c.json({ error: "forbidden", message: "这篇没有共享给你" }, 403);
	}

	return c.json({
		slug,
		limit: COLLAB_LIMIT,
		canManage: canManageCollaborators(user, post),
		members: await listCollaborators(c.env.DB, slug),
	});
});

collab.post(
	"/invite",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const payload = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const slug = typeof payload.slug === "string" ? payload.slug.trim() : "";
		const account =
			typeof payload.account === "string" ? payload.account.trim() : "";
		if (!slug) return c.json(BAD_SLUG, 400);
		if (!account) {
			return c.json(
				{ error: "bad_request", message: "填入要邀请的登录名" },
				400,
			);
		}

		const { ownerUid, exists } = await ownerOf(c.env.DB, slug, c.env.ASSETS);
		if (!exists)
			return c.json({ error: "not_found", message: "文章不存在" }, 404);

		const post = { slug, ownerUid };
		if (!canManageCollaborators(user, post)) {
			return c.json(FORBIDDEN, 403);
		}

		const result = await addCollaborator(c.env.DB, slug, account, user.uid);
		if (!result.ok) {
			const map: Record<string, [number, string]> = {
				not_found: [404, "没有这个登录名"],
				self: [400, "自己已经是作者了"],
				exists: [409, "这个人已经在名单里"],
				inactive: [400, "这个账号还没激活或被停用了"],
				limit: [409, `一篇文章最多 ${COLLAB_LIMIT} 个协作者`],
			};
			const [status, message] = map[result.code ?? "not_found"];
			return c.json(
				{ error: result.code ?? "bad_request", message },
				status as 400,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "post.collab.invite",
			target: `post:${slug}`,
			detail: { slug, uid: result.uid ?? null },
		});

		return c.json({
			ok: true,
			members: await listCollaborators(c.env.DB, slug),
		});
	},
);

collab.post(
	"/revoke",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const payload = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const slug = typeof payload.slug === "string" ? payload.slug.trim() : "";
		const uid = Number(payload.uid);
		if (!slug) return c.json(BAD_SLUG, 400);
		if (!Number.isInteger(uid) || uid <= 0) {
			return c.json({ error: "bad_request", message: "uid 非法" }, 400);
		}

		const { ownerUid, exists } = await ownerOf(c.env.DB, slug, c.env.ASSETS);
		if (!exists)
			return c.json({ error: "not_found", message: "文章不存在" }, 404);

		const post = { slug, ownerUid };
		if (!canManageCollaborators(user, post)) {
			return c.json(FORBIDDEN, 403);
		}

		const removed = await removeCollaborator(c.env.DB, slug, uid);
		if (!removed) {
			return c.json({ error: "not_found", message: "名单里没有这个人" }, 404);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "post.collab.revoke",
			target: `post:${slug}`,
			detail: { slug, uid },
		});

		return c.json({
			ok: true,
			members: await listCollaborators(c.env.DB, slug),
		});
	},
);
