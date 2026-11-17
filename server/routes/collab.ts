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
import { notifyCollabInvite, notifyCollabRevoked } from "../lib/collab-notify";
import { publicOrigin } from "../lib/origin";
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

interface PostInfoRow {
	id: number;
	uid: number;
	title: string;
	repo_path: string | null;
}

export interface PostInfo {
	ownerUid: number | null;
	exists: boolean;
	title: string;
	/** 已发布到仓库：编辑它会直接提交文件、触发构建 */
	published: boolean;
	/** 管理端编辑页地址；没有 id 的仓库文章走 slug 路由 */
	link: string;
}

/**
 * 这篇文章是谁的、叫什么、在管理端哪个地址。
 *
 * D1 里有行就以那一行为准；仓库里的老文章没有作者这一栏（视为站主所有，ownerUid 为 null），
 * 标题从构建快照里取。
 */
async function postInfo(
	db: D1Database,
	assets: AssetsFetcher,
	origin: string,
	slug: string,
): Promise<PostInfo> {
	if (!slug) {
		return {
			ownerUid: null,
			exists: false,
			title: "",
			published: false,
			link: origin,
		};
	}

	const row = await db
		.prepare(
			"SELECT id, uid, title, repo_path FROM posts WHERE slug = ?1 LIMIT 1",
		)
		.bind(slug)
		.first<PostInfoRow>();

	// 已经落到仓库的 D1 行改的是文件，不是草稿
	if (row) {
		const published =
			Boolean(row.repo_path) &&
			row.repo_path?.startsWith("src/content/posts/") === true;
		return {
			ownerUid: row.uid,
			exists: true,
			title: row.title ?? "",
			published,
			link: published
				? `${origin}/admin/#/posts/repo/${encodeURIComponent(slug)}`
				: `${origin}/admin/#/posts/${row.id}`,
		};
	}

	const posts = await readRepoPosts(assets);
	const hit = posts.find((post) => post.slug === slug);
	return {
		ownerUid: null,
		exists: Boolean(hit),
		title: hit?.title ?? "",
		published: true,
		link: `${origin}/admin/#/posts/repo/${encodeURIComponent(slug)}`,
	};
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

	const info = await postInfo(c.env.DB, c.env.ASSETS, publicOrigin(c.req.raw, c.env.SITE_ORIGIN), slug);
	if (!info.exists)
		return c.json({ error: "not_found", message: "文章不存在" }, 404);

	const post = { slug, ownerUid: info.ownerUid };
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

		const info = await postInfo(c.env.DB, c.env.ASSETS, publicOrigin(c.req.raw, c.env.SITE_ORIGIN), slug);
		if (!info.exists)
			return c.json({ error: "not_found", message: "文章不存在" }, 404);

		const post = { slug, ownerUid: info.ownerUid };
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

		// 已进名单了，信发不出去也不能把邀请吞回去：把结果带给前端，让它提示一句
		const mail = await notifyCollabInvite(c.env, {
			uid: result.uid ?? 0,
			title: info.title,
			inviter: user.display_name || user.account,
			link: info.link,
			published: info.published,
		});

		return c.json({
			ok: true,
			mail,
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

		const info = await postInfo(c.env.DB, c.env.ASSETS, publicOrigin(c.req.raw, c.env.SITE_ORIGIN), slug);
		if (!info.exists)
			return c.json({ error: "not_found", message: "文章不存在" }, 404);

		const post = { slug, ownerUid: info.ownerUid };
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

		// 收回也要说一声：对方下次点进去发现 404，不该靠猜
		const mail = await notifyCollabRevoked(c.env, {
			uid,
			title: info.title,
			operator: user.display_name || user.account,
			link: info.link,
		});

		return c.json({
			ok: true,
			mail,
			members: await listCollaborators(c.env.DB, slug),
		});
	},
);
