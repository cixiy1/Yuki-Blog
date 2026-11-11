import { type Context, Hono } from "hono";
import { writeAudit } from "../lib/audit";
import {
	type FieldValue,
	joinMarkdown,
	KEY_RE,
	readAll,
	readScalar,
	setField,
	splitMarkdown,
} from "../lib/frontmatter";
import { publicOrigin } from "../lib/origin";
import { type RepoPost, readRepoPostsFor } from "../lib/post-index";
import {
	deleteRepoFile,
	readRepoFile,
	repoRawBase,
	writeRepoFile,
} from "../lib/repo-posts";
import { notifyReviewers, notifyWithdrawn } from "../lib/review-notify";
import { readSecret } from "../lib/site-config";
import { listSpecPages, readSpecPage, saveSpecPage } from "../lib/spec-pages";
import { isValidSlug, normalizeTags } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

/**
 * 我的文章：草稿阶段只碰 D1，正文存在 posts.body。
 * 写回 git 在 P4（提交审核 → 审核通过才进 src/content/posts/）。
 */
export const me: Hono<AppEnv> = new Hono<AppEnv>();

const MAX_TITLE = 120;
const MAX_SUMMARY = 300;
const MAX_BODY = 200_000;
const MAX_META = 20_000;
const MAX_COVER = 300;

/** 只有这两个状态能改能删；pending 要先撤回，published 一律锁定 */
const EDITABLE = new Set(["draft", "rejected"]);

/** 邮件里的链接要用对外地址，本地开发才退回请求自身的 origin */
export function originOf(c: Context<AppEnv>): string {
	return publicOrigin(c.req.raw, c.env.SITE_ORIGIN);
}

/* ---------------------------- 我的资料 ---------------------------- */

const DISPLAY_NAME_MAX = 32;
const BIO_MAX = 200;
const AVATAR_MAX = 400;

/**
 * 头像只收 https 外链与站内绝对路径。
 *
 * http 图片在 https 页面上会被浏览器拦成混合内容（看着像图挂了）；
 * data: 会把一行几 MB 塞进 users 表。上传要等媒体库，先不做。
 * 返回 undefined 表示格式不合法，null 表示清空。
 */
function readAvatar(raw: unknown): string | null | undefined {
	if (raw === undefined) return undefined;
	if (typeof raw !== "string") return undefined;
	const value = raw.trim();
	if (!value) return null;
	if (value.length > AVATAR_MAX) return undefined;
	// 站内路径：// 开头是协议相对 URL，不算站内
	if (value.startsWith("/") && !value.startsWith("//")) return value;
	try {
		const url = new URL(value);
		return url.protocol === "https:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

interface ProfileRow {
	uid: number;
	account: string;
	email: string;
	email_verified_at: string | null;
	role: string;
	status: string;
	display_name: string;
	avatar_url: string | null;
	bio: string | null;
}

/**
 * 改自己的资料。登录名（account）与邮箱不在这里：登录名是登录凭据，
 * 改邮箱要走验证信，等专门的流程。
 */
me.patch(
	"/profile",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const current = c.get("user");
		if (!current) return c.json({ error: "unauthorized" }, 401);

		const body = (await c.req.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (!body) {
			return c.json({ error: "bad_request", message: "请求格式不对" }, 400);
		}

		const name =
			typeof body.display_name === "string" ? body.display_name.trim() : "";
		if (!name || name.length > DISPLAY_NAME_MAX) {
			return c.json(
				{
					error: "bad_name",
					message: `昵称填 1–${DISPLAY_NAME_MAX} 个字符`,
				},
				400,
			);
		}

		const avatar = readAvatar(body.avatar_url);
		if (avatar === undefined) {
			return c.json(
				{
					error: "bad_avatar",
					message: "头像只支持 https 图片链接，或以 / 开头的站内路径",
				},
				400,
			);
		}

		const bio = typeof body.bio === "string" ? body.bio.trim() : "";
		if (bio.length > BIO_MAX) {
			return c.json(
				{ error: "bad_bio", message: `简介最多 ${BIO_MAX} 字` },
				400,
			);
		}

		const row = await c.env.DB.prepare(
			`UPDATE users
			    SET display_name = ?1,
			        avatar_url = ?2,
			        bio = ?3,
			        updated_at = datetime('now')
			  WHERE uid = ?4 AND status = 'active'
			 RETURNING uid, account, email, email_verified_at, role, status,
			           display_name, avatar_url, bio`,
		)
			.bind(name, avatar, bio || null, current.uid)
			.first<ProfileRow>();

		if (!row) {
			return c.json(
				{ error: "user_not_found", message: "账号状态异常，重新登录再试" },
				404,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: current.uid,
			action: "user.profile.update",
			target: row.account,
			detail: { fields: ["display_name", "avatar_url", "bio"] },
		});

		return c.json({
			ok: true,
			user: {
				uid: row.uid,
				account: row.account,
				email: row.email,
				role: row.role,
				status: row.status,
				display_name: row.display_name,
				avatar_url: row.avatar_url,
				bio: row.bio,
				email_verified: row.email_verified_at ? 1 : 0,
			},
		});
	},
);

export interface PostRow {
	id: number;
	uid: number;
	slug: string;
	title: string;
	summary: string | null;
	cover: string | null;
	tags: string | null;
	status: string;
	repo_path: string;
	body: string | null;
	meta_json: string | null;
	submitted_at: string | null;
	published_at: string | null;
	reviewed_at: string | null;
	review_note: string | null;
	/** 审核员改过的正文，只给作者参考，不参与发布 */
	review_body?: string | null;
	review_body_at?: string | null;
	review_body_by?: number | null;
	/** 上一次发出「待审提醒」的时间，用于节流 */
	review_notified_at?: string | null;
	created_at: string;
	updated_at: string;
}

function parseTags(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value)
			? value.filter((tag): tag is string => typeof tag === "string")
			: [];
	} catch {
		return [];
	}
}

function parseMeta(raw: string | null): Record<string, unknown> {
	if (!raw) return {};
	try {
		const value: unknown = JSON.parse(raw);
		return value !== null && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** 毫秒时间戳：D1 的 datetime('now') 是 UTC 且不带时区标记，补 Z 再算 */
function toMillis(value: unknown): number {
	if (!value) return 0;
	const raw = String(value);
	// frontmatter 只有日期（2026-11-01）时补零点；直接拼 Z 会解析失败
	const iso = raw.includes("T")
		? raw
		: /\d:\d/.test(raw)
			? `${raw.replace(" ", "T")}Z`
			: `${raw}T00:00:00Z`;
	const at = Date.parse(iso);
	return Number.isNaN(at) ? 0 : at;
}

/**
 * 仓库里的文章映射成和 D1 行同一个形状。
 * id 固定 0：它们没有 D1 记录，前端靠 origin 区分，不能拿去调 /posts/:id。
 * 日期取 UTC 日（快照里是毫秒时间戳），补成 ISO 再让前端换算本地时区会显示 08:00:00。
 */
function repoToSummary(post: RepoPost): Record<string, unknown> {
	const day = (ms: number | null | undefined): string =>
		typeof ms === "number" && Number.isFinite(ms)
			? new Date(ms).toISOString().slice(0, 10)
			: "";
	const published = day(post.published);
	const updated = day(post.updated) || published;
	return {
		id: 0,
		origin: "repo",
		slug: post.slug,
		title: post.title,
		summary: post.description,
		cover: post.cover,
		tags: post.tags,
		status: "published",
		repo_path: post.repoPath,
		submitted_at: null,
		published_at: published,
		reviewed_at: null,
		review_note: null,
		created_at: published,
		updated_at: updated,
		source_link: post.sourceLink,
		author: post.author,
		// 列表上要能一眼分出「这篇只有指定的人能看」
		visibility: post.visibility ?? "public",
	};
}

/**
 * 每篇文章的已通过评论数，key 用 frontmatter slug（评论表的 target 就是这个）。
 * 一次 GROUP BY 比逐个 slug 拼 IN 省事；表还没建（老库）时返回空表，
 * 别让列表因为一个附属指标整个 500。
 */
async function commentCounts(db: D1Database): Promise<Map<string, number>> {
	try {
		const rows = await db
			.prepare(
				"SELECT target, COUNT(*) AS total FROM comments WHERE status = 'approved' GROUP BY target",
			)
			.all<{ target: string; total: number }>();
		return new Map((rows.results ?? []).map((row) => [row.target, row.total]));
	} catch {
		return new Map();
	}
}

function toSummary(row: PostRow): Record<string, unknown> {
	const meta = parseMeta(row.meta_json);
	return {
		origin: "db",
		id: row.id,
		slug: row.slug,
		title: row.title,
		summary: row.summary ?? "",
		cover: row.cover ?? "",
		tags: parseTags(row.tags),
		status: row.status,
		repo_path: row.repo_path,
		source_link: typeof meta.sourceLink === "string" ? meta.sourceLink : "",
		author: typeof meta.author === "string" ? meta.author : "",
		submitted_at: row.submitted_at,
		published_at: row.published_at,
		reviewed_at: row.reviewed_at,
		review_note: row.review_note,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

/** 审核台要看正文，所以详情形状对外导出，admin 路由复用同一份字段 */
export function toDetail(row: PostRow): Record<string, unknown> {
	return {
		...toSummary(row),
		body: row.body ?? "",
		meta: parseMeta(row.meta_json),
		review_body: row.review_body ?? null,
		review_body_at: row.review_body_at ?? null,
	};
}

/** 取字段：key 不存在表示「这次不改」；null 或空串表示清空 */
function readText(
	payload: Record<string, unknown>,
	key: string,
	max: number,
): string | null | undefined {
	if (!(key in payload)) return undefined;
	const raw = payload[key];
	if (typeof raw !== "string") return null;
	const text = raw.trim();
	if (text.length > max) return null;
	return text.length === 0 ? null : text;
}

async function slugTaken(
	db: D1Database,
	slug: string,
	exceptId: number,
): Promise<boolean> {
	const row = await db
		.prepare("SELECT id FROM posts WHERE slug = ?1 AND id <> ?2")
		.bind(slug, exceptId)
		.first<{ id: number }>();
	return row !== null;
}

async function uniqueSlug(
	db: D1Database,
	base: string,
	exceptId: number,
): Promise<string | null> {
	const trimmed = base.slice(0, 50);
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const suffix =
			attempt === 0 ? "" : `-${Math.random().toString(36).slice(2, 6)}`;
		const candidate = `${trimmed}${suffix}`;
		if (!isValidSlug(candidate)) return null;
		if (!(await slugTaken(db, candidate, exceptId))) return candidate;
	}
	return null;
}

function repoPathFor(uid: number, slug: string): string {
	return `inbox/u/${uid}/${slug}/index.mdx`;
}

async function findOwned(
	c: Context<AppEnv>,
	id: number,
): Promise<PostRow | null> {
	const user = c.get("user");
	if (!user) return null;
	return await c.env.DB.prepare(
		"SELECT * FROM posts WHERE id = ?1 AND uid = ?2",
	)
		.bind(id, user.uid)
		.first<PostRow>();
}

const POST_NOT_FOUND = {
	error: "post_not_found",
	message: "文章不存在",
} as const;

function lockedBody(status: string): Record<string, unknown> {
	return {
		error: "post_locked",
		status,
		message:
			status === "pending"
				? "已提交审核，先撤回再编辑"
				: "已发布的文章不能再改",
	};
}

function readId(c: Context<AppEnv>): number | null {
	const id = Number(c.req.param("id"));
	return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 我的文章 = 自己在 D1 里的稿子 + 仓库里署名为自己的已发布文章。
 *
 * 站点上现有的文章都写在用户系统之前，frontmatter 没有 author 字段——那批算站主的。
 * 「全站文章」是另一栏，两者在多作者之前内容基本一样，但语义要对：
 * 别人写的不会出现在这里。
 */
me.get("/posts", requireAuth, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ posts: [] });

	const rows = await c.env.DB.prepare(
		"SELECT * FROM posts WHERE uid = ?1 ORDER BY updated_at DESC, id DESC LIMIT 200",
	)
		.bind(user.uid)
		.all<PostRow>();

	// 仓库里的文章都算站主的。不能拿 frontmatter 的 author 过滤：那栏在转载
	// 文章里写的是原文出处（比如「腾讯云开发者社区」），不是站内作者。
	const isAdmin = user.role === "admin";
	const repoPosts = isAdmin
		? await readRepoPostsFor(c.env.ASSETS, c.get("user"))
		: [];
	const repoBySlug = new Map(repoPosts.map((post) => [post.slug, post]));
	const counts = await commentCounts(c.env.DB);

	/*
	 * 已经落到仓库的 D1 行（发布时写了 repo_path）按仓库文章呈现。
	 * 不这么处理会掉进死胡同：它停在 status=published，前端只给「查看」，
	 * 进去是只读页；而仓库里那份同名文章又被下面的去重挡掉了，编辑入口彻底消失。
	 * 快照里已经有同名文件时直接丢掉 D1 行，让仓库那份（标题、更新时间以文件为准）顶上。
	 */
	const mine: Record<string, unknown>[] = [];
	for (const row of rows.results ?? []) {
		const inRepo = isAdmin && row.status === "published" && row.repo_path;
		if (!inRepo) {
			mine.push({ ...toSummary(row), comments: counts.get(row.slug) ?? 0 });
			continue;
		}
		if (repoBySlug.has(row.slug)) continue;
		mine.push({
			...toSummary(row),
			origin: "repo",
			id: 0,
			comments: counts.get(row.slug) ?? 0,
		});
	}

	const known = new Set(mine.map((post) => String(post.slug)));
	const owned: Record<string, unknown>[] = repoPosts
		.filter((post) => !known.has(post.slug))
		.map((post) => ({
			...repoToSummary(post),
			comments: counts.get(post.slug) ?? 0,
		}));

	const posts = [...mine, ...owned].sort(
		(a, b) =>
			toMillis(b.published_at ?? b.updated_at) -
			toMillis(a.published_at ?? a.updated_at),
	);
	return c.json({ posts });
});

/**
 * 全站文章：仓库里的已发布文章 + D1 里已发布但没有对应文件的（过渡期兼容）。
 * 「我的文章」只放自己的稿子，全站是另一栏，两者不混。
 */
me.get("/all-posts", requireAuth, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ posts: [] });
	if (user.role === "user") {
		return c.json(
			{ error: "forbidden", message: "没有查看全站文章的权限" },
			403,
		);
	}

	const counts = await commentCounts(c.env.DB);
	// 显式标类型：展开 Record<string, unknown> 会把索引签名丢掉，只剩新加的 comments，
	// 后面访问 post.slug 就会报「属性不存在」
	const repo: Record<string, unknown>[] = (
		await readRepoPostsFor(c.env.ASSETS, c.get("user"))
	).map((post) => ({
		...repoToSummary(post),
		comments: counts.get(post.slug) ?? 0,
	}));
	const known = new Set(repo.map((post) => String(post.slug)));

	const rows = await c.env.DB.prepare(
		"SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 200",
	).all<PostRow>();
	const extra: Record<string, unknown>[] = (rows.results ?? [])
		.filter((row) => !known.has(row.slug))
		.map((row) => ({ ...toSummary(row), comments: counts.get(row.slug) ?? 0 }));

	const posts = [...repo, ...extra].sort(
		(a, b) =>
			toMillis(b.published_at ?? b.updated_at) -
			toMillis(a.published_at ?? a.updated_at),
	);
	return c.json({ posts });
});

/**
 * 当前用户能读、但不在任何列表页上的文章（visibility 不是 public）。
 *
 * 站点是静态生成的，首页、归档、标签页在构建期就固化了，服务端没法给不同的人
 * 渲染不同的列表。这些文章因此不进任何列表；作者要找到它们只能靠浏览器现拉一次，
 * 前端据此在首页顶部补一块入口。
 *
 * 判定复用文章页那一套（readRepoPostsFor 内部就是 canReadPost），所以不会出现
 * 「列表里看得到、点进去 404」。
 *
 * 刻意不挂 requireAuth：首页每人都会请求一次，未登录回 401 会在控制台留一条红字。
 * 没有会话就是空列表，本来也没有可泄露的东西。
 */
me.get("/restricted", async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ posts: [] });

	const posts = (await readRepoPostsFor(c.env.ASSETS, user))
		.filter((post) => post.visibility && post.visibility !== "public")
		.sort((a, b) => b.published - a.published)
		.map((post) => ({
			slug: post.slug,
			title: post.title,
			summary: post.description,
			published: post.published,
			tags: post.tags,
			category: post.category,
			series: post.series,
			visibility: post.visibility,
		}));

	return c.json({ posts });
});

/** 系列里的一篇：编辑页据此提示「哪些序号已被占用」 */
interface SeriesEntry {
	slug: string;
	title: string;
	order: number | null;
}

/**
 * 系列一览，给编辑页的「选系列」窗口用。
 *
 * 分组口径与站点一致：series 字符串 trim 后精确相等算同一个系列——所以这个接口
 * 存在的意义就是让作者从列表里点，而不是手打一个「软件2615班务」出来分家。
 * 数据来源：仓库快照（构建期生成）+ D1 里自己的稿子和所有已发布文章。
 */
me.get("/series", requireAuth, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ series: [] });

	const groups = new Map<
		string,
		{ name: string; updated: number; posts: Map<string, SeriesEntry> }
	>();

	const put = (
		name: string,
		slug: string,
		title: string,
		order: number | null,
		at: number,
	): void => {
		const key = String(name ?? "").trim();
		if (!key || !slug) return;
		let group = groups.get(key);
		if (!group) {
			group = { name: key, updated: 0, posts: new Map() };
			groups.set(key, group);
		}
		// 仓库那份先入，D1 里的过渡行不覆盖它
		if (group.posts.has(slug)) return;
		group.posts.set(slug, { slug, title, order });
		if (at > group.updated) group.updated = at;
	};

	const repo = await readRepoPostsFor(c.env.ASSETS, c.get("user"));
	const repoSlugs = new Set(repo.map((post) => post.slug));
	for (const post of repo) {
		put(
			post.series,
			post.slug,
			post.title,
			typeof post.seriesOrder === "number" ? post.seriesOrder : null,
			post.updated ?? post.published,
		);
	}

	const rows = await c.env.DB.prepare(
		`SELECT slug, title, meta_json, published_at, updated_at FROM posts
		 WHERE uid = ?1 OR status = 'published' LIMIT 500`,
	)
		.bind(user.uid)
		.all<
			Pick<
				PostRow,
				"slug" | "title" | "meta_json" | "published_at" | "updated_at"
			>
		>();

	for (const row of rows.results ?? []) {
		if (repoSlugs.has(row.slug)) continue;
		const meta = parseMeta(row.meta_json);
		const rawOrder = meta.seriesOrder;
		const order = Number.isFinite(Number(rawOrder)) ? Number(rawOrder) : null;
		put(
			typeof meta.series === "string" ? meta.series : "",
			row.slug,
			row.title,
			order,
			toMillis(row.updated_at ?? row.published_at),
		);
	}

	const series = [...groups.values()]
		.map((group) => ({
			name: group.name,
			updated: group.updated,
			posts: [...group.posts.values()].sort((a, b) => {
				// 没写序号的一律排最后，与站点里的排序规则保持一致
				if (a.order === null && b.order === null)
					return a.title.localeCompare(b.title, "zh");
				if (a.order === null) return 1;
				if (b.order === null) return -1;
				return a.order - b.order || a.title.localeCompare(b.title, "zh");
			}),
		}))
		// 最近写过的系列排前面：新开的系列不用往下翻
		.sort(
			(a, b) => b.updated - a.updated || a.name.localeCompare(b.name, "zh"),
		);

	return c.json({ series });
});

me.post("/posts", requireAuth, requireJsonBody, sameOriginGuard, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);

	const payload = (await c.req.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	const rawTitle =
		typeof payload.title === "string" ? payload.title.trim() : "";
	const title = rawTitle.slice(0, MAX_TITLE) || "未命名文章";

	const base = isValidSlug(payload.slug)
		? payload.slug
		: `draft-${Math.random().toString(36).slice(2, 8)}`;
	const slug = await uniqueSlug(c.env.DB, base, 0);
	if (!slug) {
		return c.json(
			{ error: "slug_taken", message: "地址已被占用，换一个" },
			409,
		);
	}

	const created = await c.env.DB.prepare(
		`INSERT INTO posts (uid, repo_path, slug, title, status, body, meta_json, tags)
		 VALUES (?1, ?2, ?3, ?4, 'draft', '', '{}', '[]')
		 RETURNING *`,
	)
		.bind(user.uid, repoPathFor(user.uid, slug), slug, title)
		.first<PostRow>();

	return c.json({ post: created ? toDetail(created) : null }, 201);
});

me.get("/posts/:id", requireAuth, async (c) => {
	const id = readId(c);
	if (id === null) {
		return c.json({ error: "bad_request", message: "id 非法" }, 400);
	}
	const row = await findOwned(c, id);
	if (!row) return c.json(POST_NOT_FOUND, 404);
	return c.json({ post: toDetail(row) });
});

/**
 * 作者看自己稿子上的审核批注。
 * 只有被退回或待审的稿子才可能有批注（通过时会清掉），返回空数组也照常 200，
 * 前端不用为「没有批注」写分支。
 */
me.get("/posts/:id/notes", requireAuth, async (c) => {
	const id = readId(c);
	if (id === null) {
		return c.json({ error: "bad_request", message: "id 非法" }, 400);
	}
	const row = await findOwned(c, id);
	if (!row) return c.json(POST_NOT_FOUND, 404);

	const rows = await c.env.DB.prepare(
		`SELECT n.id, n.quote, n.note, n.created_at, u.display_name, u.account
		   FROM post_notes n
		   LEFT JOIN users u ON u.uid = n.reviewer_uid
		  WHERE n.post_id = ?1
		  ORDER BY n.id ASC`,
	)
		.bind(id)
		.all<{
			id: number;
			quote: string;
			note: string;
			created_at: string;
			display_name: string | null;
			account: string | null;
		}>();

	return c.json({
		notes: (rows.results ?? []).map((note) => ({
			id: note.id,
			quote: note.quote,
			note: note.note,
			created_at: note.created_at,
			reviewer: note.display_name || note.account || "审核员",
		})),
	});
});

me.put(
	"/posts/:id",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const id = readId(c);
		if (id === null) {
			return c.json({ error: "bad_request", message: "id 非法" }, 400);
		}
		const row = await findOwned(c, id);
		if (!row) return c.json(POST_NOT_FOUND, 404);
		if (!EDITABLE.has(row.status)) return c.json(lockedBody(row.status), 409);

		const payload = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;

		let slug = row.slug;
		if ("slug" in payload) {
			if (!isValidSlug(payload.slug)) {
				return c.json(
					{
						error: "invalid_slug",
						message:
							"地址只能是 2–60 位小写字母、数字与连字符，且首尾不能是连字符",
					},
					400,
				);
			}
			slug = payload.slug;
			if (slug !== row.slug && (await slugTaken(c.env.DB, slug, row.id))) {
				return c.json(
					{ error: "slug_taken", message: "地址已被占用，换一个" },
					409,
				);
			}
		}

		const title = readText(payload, "title", MAX_TITLE);
		const summary = readText(payload, "summary", MAX_SUMMARY);
		const cover = readText(payload, "cover", MAX_COVER);

		let tags = parseTags(row.tags);
		if ("tags" in payload) {
			const parsed = normalizeTags(payload.tags);
			if (parsed === null) {
				return c.json(
					{
						error: "invalid_tags",
						message: "标签最多 10 个，每个不超过 24 字",
					},
					400,
				);
			}
			tags = parsed;
		}

		let body = row.body ?? "";
		if ("body" in payload) {
			if (typeof payload.body !== "string") {
				return c.json(
					{ error: "invalid_body", message: "正文必须是字符串" },
					400,
				);
			}
			if (payload.body.length > MAX_BODY) {
				return c.json(
					{ error: "body_too_long", message: `正文不能超过 ${MAX_BODY} 字符` },
					400,
				);
			}
			body = payload.body;
		}

		let metaJson = row.meta_json ?? "{}";
		if ("meta" in payload) {
			if (payload.meta !== null && typeof payload.meta !== "object") {
				return c.json(
					{ error: "invalid_meta", message: "meta 必须是对象" },
					400,
				);
			}
			metaJson = JSON.stringify(payload.meta ?? {});
			if (metaJson.length > MAX_META) {
				return c.json({ error: "meta_too_long", message: "meta 过大" }, 400);
			}
		}

		const nextTitle = title ?? row.title;
		if (!nextTitle) {
			return c.json({ error: "invalid_title", message: "标题不能为空" }, 400);
		}

		const updated = await c.env.DB.prepare(
			`UPDATE posts
		    SET slug = ?1, repo_path = ?2, title = ?3, summary = ?4, cover = ?5,
		        tags = ?6, body = ?7, meta_json = ?8, updated_at = datetime('now')
		  WHERE id = ?9 AND uid = ?10
		 RETURNING *`,
		)
			.bind(
				slug,
				repoPathFor(row.uid, slug),
				nextTitle,
				summary === undefined ? row.summary : summary,
				cover === undefined ? row.cover : cover,
				JSON.stringify(tags),
				body,
				metaJson,
				row.id,
				row.uid,
			)
			.first<PostRow>();

		return c.json({ post: updated ? toDetail(updated) : null });
	},
);

me.delete("/posts/:id", requireAuth, sameOriginGuard, async (c) => {
	const id = readId(c);
	if (id === null) {
		return c.json({ error: "bad_request", message: "id 非法" }, 400);
	}
	const row = await findOwned(c, id);
	if (!row) return c.json(POST_NOT_FOUND, 404);
	if (!EDITABLE.has(row.status)) return c.json(lockedBody(row.status), 409);

	await c.env.DB.prepare("DELETE FROM posts WHERE id = ?1 AND uid = ?2")
		.bind(row.id, row.uid)
		.run();
	return c.json({ ok: true });
});

me.post("/posts/:id/submit", requireAuth, sameOriginGuard, async (c) => {
	const id = readId(c);
	if (id === null) {
		return c.json({ error: "bad_request", message: "id 非法" }, 400);
	}
	const row = await findOwned(c, id);
	if (!row) return c.json(POST_NOT_FOUND, 404);
	if (!EDITABLE.has(row.status)) return c.json(lockedBody(row.status), 409);

	if (row.title.trim().length === 0) {
		return c.json({ error: "invalid_title", message: "标题不能为空" }, 400);
	}
	if ((row.body ?? "").trim().length === 0) {
		return c.json({ error: "empty_body", message: "正文还是空的" }, 400);
	}
	if (!isValidSlug(row.slug)) {
		return c.json(
			{ error: "invalid_slug", message: "先给文章定一个合法地址" },
			400,
		);
	}

	// 同一篇稿子 10 分钟内只提醒一次：作者撤回再提交不该反复刷管理员的邮箱。
	// 判断放在 SQL 里，用返回值有没有变化来决定发不发，省一次查询。
	const updated = await c.env.DB.prepare(
		`UPDATE posts
		    SET status = 'pending', submitted_at = datetime('now'),
		        review_notified_at = CASE
		          WHEN review_notified_at IS NULL
		            OR review_notified_at < datetime('now', '-10 minutes')
		          THEN datetime('now')
		          ELSE review_notified_at
		        END,
		        updated_at = datetime('now')
		  WHERE id = ?1 AND uid = ?2
		 RETURNING *`,
	)
		.bind(row.id, row.uid)
		.first<PostRow>();

	if (
		updated &&
		updated.review_notified_at !== (row.review_notified_at ?? null)
	) {
		// 发信可能走 SMTP 要一两秒，不该拖住作者的提交按钮
		const task = notifyReviewers(c.env, updated, originOf(c));
		try {
			c.executionCtx.waitUntil(task);
		} catch {
			void task;
		}
	}

	return c.json({
		post: updated ? toDetail(updated) : null,
		// P4 才接 GitHub 写入，这里如实告诉前端，别让人以为已经上线
		git: { written: false, reason: "P4 才接 GitHub 写入" },
	});
});

/** 撤回：pending → draft，给作者留一条改稿的路 */
me.post("/posts/:id/withdraw", requireAuth, sameOriginGuard, async (c) => {
	const id = readId(c);
	if (id === null) {
		return c.json({ error: "bad_request", message: "id 非法" }, 400);
	}
	const row = await findOwned(c, id);
	if (!row) return c.json(POST_NOT_FOUND, 404);
	if (row.status !== "pending") {
		return c.json(
			{ error: "not_pending", message: "只有待审的文章可以撤回" },
			409,
		);
	}

	const updated = await c.env.DB.prepare(
		`UPDATE posts
		    SET status = 'draft', submitted_at = NULL, review_notified_at = NULL,
		        updated_at = datetime('now')
		  WHERE id = ?1 AND uid = ?2 AND status = 'pending'
		 RETURNING *`,
	)
		.bind(row.id, row.uid)
		.first<PostRow>();

	if (!updated) {
		return c.json(
			{ error: "not_pending", message: "只有待审的文章可以撤回" },
			409,
		);
	}

	await writeAudit(c.env.DB, {
		actorUid: row.uid,
		action: "review.withdraw",
		target: `post:${row.id}`,
		detail: { slug: row.slug, from: "pending", to: "draft" },
	});

	// 撤回了就清掉提醒时间戳：改完重新提交必须让审核人收到新提醒，
	// 否则 10 分钟节流会把「撤回后又提交」的这条悄悄吞掉。
	const task = notifyWithdrawn(c.env, updated, originOf(c));
	try {
		c.executionCtx.waitUntil(task);
	} catch {
		void task;
	}

	return c.json({ post: toDetail(updated) });
});

/* ---------- 仓库文章：直接读写 src/content/posts 下的文件 ---------- */

function isOwner(c: Context<AppEnv>): boolean {
	return c.get("user")?.role === "admin";
}

function readField(payload: Record<string, unknown>, key: string): string {
	const value = payload[key];
	return typeof value === "string" ? value.trim() : "";
}

async function repoToken(c: Context<AppEnv>): Promise<string | null> {
	return readSecret(c.env.DB, c.env.PASSWORD_ENC_KEY ?? "", "github_token");
}

async function findRepoPost(
	c: Context<AppEnv>,
	slug: string,
): Promise<RepoPost | null> {
	if (!slug) return null;
	const posts = await readRepoPostsFor(c.env.ASSETS, c.get("user"));
	return posts.find((post) => post.slug === slug) ?? null;
}

/**
 * 定位文章文件。
 *
 * 优先查 post-index 快照，但快照是构建期的：刚在管理端发布的文章要等下一次构建
 * 才进快照，这段时间里编辑、删除都会 404。所以退回按 slug 猜默认路径
 * （只有单段 slug 才能这么猜，子目录的文章必须走快照）。
 */
async function resolveRepoPath(
	c: Context<AppEnv>,
	slug: string,
): Promise<string | null> {
	const item = await findRepoPost(c, slug);
	if (item) return item.repoPath;
	if (isValidSlug(slug)) return `src/content/posts/${slug}.md`;
	return null;
}

const TOKEN_MISSING = {
	error: "github_token_missing",
	message:
		"还没配置 GitHub 令牌，去「站点设置 → 集成」里填一个带 Contents 写权限的",
};

me.get("/repo-posts", requireAuth, async (c) => {
	if (!isOwner(c)) {
		return c.json(
			{ error: "forbidden", message: "只有站主能编辑仓库文章" },
			403,
		);
	}
	const slug = c.req.query("slug") ?? "";
	const path = await resolveRepoPath(c, slug);
	if (!path) return c.json({ error: "not_found", message: "文章不存在" }, 404);

	const token = await repoToken(c);
	if (!token) return c.json(TOKEN_MISSING, 412);

	const file = await readRepoFile(path, token);
	if (!file.ok || file.content === undefined) {
		return c.json(
			{ error: "repo_read_failed", message: file.message ?? "读取失败" },
			502,
		);
	}

	const { frontmatter, body } = splitMarkdown(file.content);
	return c.json({
		post: {
			slug,
			repoPath: path,
			rawBase: repoRawBase(path),
			sha: file.sha ?? "",
			body,
			// 整份 frontmatter 交给前端：认得的是表单字段，认不得的留在「自定义属性」里
			fields: readAll(frontmatter),
		},
	});
});

/** 单个字段值：收窄类型、去掉过长内容，乱写的类型直接丢 */
function cleanFieldValue(key: string, value: unknown): FieldValue | null {
	if (value === null) return null;

	if (typeof value === "string") {
		const text = value.trim();
		if (text.length === 0) return null;
		if (text.length > 2000) throw new Error(`${key} 太长`);
		return text;
	}
	if (typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`${key} 不是有效数字`);
		return value;
	}
	if (Array.isArray(value)) {
		const items = value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
		if (items.length > 20) throw new Error(`${key} 最多 20 项`);
		if (items.some((item) => item.length > 200)) {
			throw new Error(`${key} 单项太长`);
		}
		return items.length > 0 ? items : null;
	}
	if (typeof value === "object") {
		const out: Record<string, string> = {};
		for (const [childKey, childValue] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (!KEY_RE.test(childKey)) continue;
			if (typeof childValue !== "string") continue;
			const text = childValue.trim();
			if (text.length === 0) continue;
			if (text.length > 500) throw new Error(`${key}.${childKey} 太长`);
			out[childKey] = text;
		}
		return out;
	}
	return null;
}

me.put(
	"/repo-posts",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		if (!isOwner(c)) {
			return c.json(
				{ error: "forbidden", message: "只有站主能编辑仓库文章" },
				403,
			);
		}
		const payload = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const slug = readField(payload, "slug");
		const path = await resolveRepoPath(c, slug);
		if (!path)
			return c.json({ error: "not_found", message: "文章不存在" }, 404);

		const title =
			typeof payload.fields === "object" &&
			payload.fields !== null &&
			typeof (payload.fields as Record<string, unknown>).title === "string"
				? String((payload.fields as Record<string, unknown>).title).trim()
				: "";
		if (!title) {
			return c.json({ error: "bad_request", message: "标题不能为空" }, 400);
		}
		const nextSlug = readField(payload, "nextSlug");
		if (nextSlug && nextSlug !== slug && !isValidSlug(nextSlug)) {
			return c.json({ error: "bad_slug", message: "地址格式不对" }, 400);
		}

		const token = await repoToken(c);
		if (!token) return c.json(TOKEN_MISSING, 412);

		const file = await readRepoFile(path, token);
		if (!file.ok || file.content === undefined) {
			return c.json(
				{ error: "repo_read_failed", message: file.message ?? "读取失败" },
				502,
			);
		}

		const parsed = splitMarkdown(file.content);
		let fm = parsed.frontmatter;

		const fields =
			payload.fields !== null && typeof payload.fields === "object"
				? (payload.fields as Record<string, unknown>)
				: null;
		if (!fields) {
			return c.json({ error: "bad_request", message: "缺少 fields" }, 400);
		}
		const keys = Object.keys(fields);
		if (keys.length > 40) {
			return c.json({ error: "too_many_fields", message: "字段太多" }, 400);
		}

		try {
			for (const key of keys) {
				// slug 单独处理：它决定 URL，必须和 nextSlug 的判断走同一条路
				if (key === "slug") continue;
				if (!KEY_RE.test(key)) {
					return c.json(
						{ error: "bad_key", message: `字段名不合法：${key}` },
						400,
					);
				}
				if (key === "tags") {
					const tags = normalizeTags(fields.tags);
					if (tags === null) {
						return c.json(
							{
								error: "bad_tags",
								message: "标签最多 10 个，每个不超过 24 字",
							},
							400,
						);
					}
					fm = setField(fm, key, tags);
					continue;
				}
				fm = setField(fm, key, cleanFieldValue(key, fields[key]));
			}
		} catch (error) {
			return c.json(
				{
					error: "bad_field",
					message: error instanceof Error ? error.message : "字段值不合法",
				},
				400,
			);
		}
		fm = setField(fm, "title", title.slice(0, 120));

		// 只有真改了地址才写 slug：原来没这一行的文章沿用文件名当 URL，
		// 凭空补一行 slug 有把旧链接改掉的风险
		if (nextSlug && nextSlug !== slug) {
			fm = setField(fm, "slug", nextSlug);
		}

		const body = typeof payload.body === "string" ? payload.body : parsed.body;
		const content = joinMarkdown(fm, body);

		const result = await writeRepoFile(
			path,
			content,
			token,
			`chore(post): 更新《${title}》`,
		);
		if (!result.ok) {
			return c.json(
				{ error: "repo_write_failed", message: result.message ?? "写入失败" },
				result.status === 400 ? 400 : 502,
			);
		}

		return c.json({
			ok: true,
			sha: result.sha ?? "",
			repoPath: path,
			// 写成功即触发构建，站点与列表要等这次构建完成才会变
			building: true,
		});
	},
);

me.delete("/repo-posts", requireAuth, sameOriginGuard, async (c) => {
	if (!isOwner(c)) {
		return c.json(
			{ error: "forbidden", message: "只有站主能删除仓库文章" },
			403,
		);
	}
	const path = await resolveRepoPath(c, c.req.query("slug") ?? "");
	if (!path) return c.json({ error: "not_found", message: "文章不存在" }, 404);

	const token = await repoToken(c);
	if (!token) return c.json(TOKEN_MISSING, 412);

	const file = await readRepoFile(path, token);
	if (!file.ok || !file.sha) {
		return c.json(
			{ error: "repo_read_failed", message: file.message ?? "读取失败" },
			502,
		);
	}

	const title = readScalar(
		splitMarkdown(file.content ?? "").frontmatter,
		"title",
	);
	const result = await deleteRepoFile(
		path,
		token,
		file.sha,
		`chore(post): 删除《${title || path}》`,
	);
	if (!result.ok) {
		return c.json(
			{ error: "repo_delete_failed", message: result.message ?? "删除失败" },
			502,
		);
	}

	return c.json({ ok: true, building: true });
});

/** 把 D1 草稿拼成仓库里的 markdown：frontmatter 按站内约定顺序排 */
export function buildPostFrontmatter(row: PostRow): string {
	let fm = "";
	fm = setField(fm, "title", row.title.trim());
	// Worker 跑在 UTC：凌晨 0–8 点（东八区）发布用 toISOString 会写成前一天。
	// 站点按北京时间走，固定加 8 小时再取日期
	const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
	fm = setField(fm, "published", now);
	if (row.summary) fm = setField(fm, "description", row.summary);
	const tags = parseTags(row.tags);
	if (tags.length > 0) fm = setField(fm, "tags", tags);
	if (row.cover) fm = setField(fm, "image", row.cover);

	const meta = parseMeta(row.meta_json);
	for (const [key, value] of Object.entries(meta)) {
		// 标题和日期由上面几行定，meta 里再写一遍只会打架
		if (key === "title" || key === "published" || !KEY_RE.test(key)) continue;
		try {
			fm = setField(fm, key, cleanFieldValue(key, value));
		} catch {
			// 单个字段超长或类型不对就跳过，不因为一条脏数据挡住整篇发布
		}
	}
	return fm;
}

/**
 * 把一篇 D1 稿子写进仓库。管理员直接发布和审核通过走同一条路。
 * 失败时返回要回给前端的 status + body，调用方原样吐出去。
 */
export async function publishRowToRepo(
	c: Context<AppEnv>,
	row: PostRow,
	action: string,
): Promise<
	| { ok: true; path: string }
	| { ok: false; status: number; body: Record<string, unknown> }
> {
	const token = await repoToken(c);
	if (!token) return { ok: false, status: 412, body: TOKEN_MISSING };

	const path = `src/content/posts/${row.slug}.md`;
	const existing = await readRepoFile(path, token);
	if (existing.ok) {
		return {
			ok: false,
			status: 409,
			body: {
				error: "slug_taken",
				message: `仓库里已经有 ${path}，换个地址再发`,
			},
		};
	}
	if (existing.status !== 404) {
		return {
			ok: false,
			status: 502,
			body: {
				error: "repo_read_failed",
				message: existing.message ?? "读取失败",
			},
		};
	}

	const content = joinMarkdown(buildPostFrontmatter(row), row.body ?? "");
	const written = await writeRepoFile(
		path,
		content,
		token,
		`${action}《${row.title.trim()}》`,
	);
	if (!written.ok) {
		return {
			ok: false,
			status: 502,
			body: {
				error: "repo_write_failed",
				message: written.message ?? "写入失败",
			},
		};
	}
	return { ok: true, path };
}

/**
 * 管理员直接发布：D1 草稿 → 仓库文件。
 *
 * 站主自己的稿子没有「提交审核」这一说——审核是给别人的投稿用的，
 * 让管理员排进自己的审核队列等于自己盖自己的章。
 */
me.post("/posts/:id/publish", requireAuth, sameOriginGuard, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized" }, 401);
	if (user.role !== "admin") {
		return c.json(
			{
				error: "forbidden",
				message: "只有管理员能直接发布，其他人的稿子走提交审核",
			},
			403,
		);
	}

	const id = readId(c);
	if (id === null) {
		return c.json({ error: "bad_request", message: "id 非法" }, 400);
	}
	const row = await findOwned(c, id);
	if (!row) return c.json(POST_NOT_FOUND, 404);
	if (!EDITABLE.has(row.status)) return c.json(lockedBody(row.status), 409);
	if (row.title.trim().length === 0) {
		return c.json({ error: "invalid_title", message: "标题不能为空" }, 400);
	}
	if ((row.body ?? "").trim().length === 0) {
		return c.json({ error: "empty_body", message: "正文还是空的" }, 400);
	}
	if (!isValidSlug(row.slug)) {
		return c.json(
			{ error: "invalid_slug", message: "先给文章定一个合法地址" },
			400,
		);
	}

	const written = await publishRowToRepo(c, row, "feat(post): 发布");
	if (!written.ok) {
		return c.json(written.body, written.status as 400);
	}
	const path = written.path;

	const updated = await c.env.DB.prepare(
		`UPDATE posts
		    SET status = 'published', repo_path = ?1,
		        published_at = datetime('now'), updated_at = datetime('now')
		  WHERE id = ?2 AND uid = ?3
		 RETURNING *`,
	)
		.bind(path, row.id, row.uid)
		.first<PostRow>();

	return c.json({
		post: updated ? toDetail(updated) : null,
		repoPath: path,
		building: true,
	});
});

/* ---------- 站点单页：src/content/spec 下的关于我、友链、留言板 ---------- */

const MAX_PAGE_BODY = 200_000;

const SPEC_FORBIDDEN = {
	error: "forbidden",
	message: "只有站主能编辑站点页面",
};

me.get("/spec-pages", requireAuth, async (c) => {
	if (!isOwner(c)) return c.json(SPEC_FORBIDDEN, 403);

	const token = await repoToken(c);
	if (!token) return c.json(TOKEN_MISSING, 412);

	const result = await listSpecPages(token);
	if (!result.ok) {
		return c.json(
			{ error: "repo_read_failed", message: result.message },
			result.status === 400 ? 400 : 502,
		);
	}
	return c.json({ pages: result.value });
});

me.get("/spec-page", requireAuth, async (c) => {
	if (!isOwner(c)) return c.json(SPEC_FORBIDDEN, 403);

	const file = c.req.query("file") ?? "";
	if (!file)
		return c.json({ error: "bad_request", message: "缺少文件名" }, 400);

	const token = await repoToken(c);
	if (!token) return c.json(TOKEN_MISSING, 412);

	const result = await readSpecPage(file, token);
	if (!result.ok) {
		return c.json(
			{ error: "repo_read_failed", message: result.message },
			result.status === 400 ? 400 : 502,
		);
	}
	return c.json({ page: result.value });
});

me.put(
	"/spec-page",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		if (!isOwner(c)) return c.json(SPEC_FORBIDDEN, 403);

		const payload = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const file = readField(payload, "file");
		if (!file)
			return c.json({ error: "bad_request", message: "缺少文件名" }, 400);

		const body = typeof payload.body === "string" ? payload.body : "";
		if (!body.trim()) {
			return c.json({ error: "bad_request", message: "正文不能为空" }, 400);
		}
		if (body.length > MAX_PAGE_BODY) {
			return c.json(
				{ error: "body_too_long", message: "正文太长了，精简一下再存" },
				413,
			);
		}
		const title = readField(payload, "title").slice(0, 120);
		const description = readField(payload, "description").slice(0, 300);

		const token = await repoToken(c);
		if (!token) return c.json(TOKEN_MISSING, 412);

		const result = await saveSpecPage({
			file,
			title,
			description,
			body,
			token,
		});
		if (!result.ok) {
			return c.json(
				{
					error: result.status === 409 ? "repo_conflict" : "repo_write_failed",
					message: result.message,
				},
				result.status === 409 ? 409 : 502,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: c.get("user")?.uid ?? null,
			action: "page.update",
			target: file,
			detail: { path: `src/content/spec/${file}`, sha: result.value.sha },
		});

		return c.json({ ok: true, sha: result.value.sha, building: true });
	},
);
