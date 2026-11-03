import { type Context, Hono } from "hono";
import {
	type FieldValue,
	joinMarkdown,
	KEY_RE,
	readAll,
	readScalar,
	setField,
	splitMarkdown,
} from "../lib/frontmatter";
import { putRepoFile } from "../lib/github-contents";
import { type RepoPost, readRepoPosts } from "../lib/post-index";
import {
	deleteRepoFile,
	readRepoFile,
	repoRawBase,
	writeRepoFile,
} from "../lib/repo-posts";
import { readSecret } from "../lib/site-config";
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

interface PostRow {
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
	const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
	const at = Date.parse(iso);
	return Number.isNaN(at) ? 0 : at;
}

/**
 * 仓库里的文章映射成和 D1 行同一个形状。
 * id 固定 0：它们没有 D1 记录，前端靠 origin 区分，不能拿去调 /posts/:id。
 */
function repoToSummary(post: RepoPost): Record<string, unknown> {
	const published = new Date(post.published).toISOString();
	const updated = post.updated
		? new Date(post.updated).toISOString()
		: published;
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
	};
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

function toDetail(row: PostRow): Record<string, unknown> {
	return {
		...toSummary(row),
		body: row.body ?? "",
		meta: parseMeta(row.meta_json),
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

	const mine = (rows.results ?? []).map(toSummary);
	const known = new Set(mine.map((post) => String(post.slug)));

	let owned: Record<string, unknown>[] = [];
	if (user.role === "admin") {
		// 站内目前只有站主一个作者，仓库里的文章都算他的。
		// 不能拿 frontmatter 的 author 过滤：那栏在转载文章里写的是原文出处
		//（比如「腾讯云开发者社区」），不是站内作者。
		owned = (await readRepoPosts(c.env.ASSETS))
			.filter((post) => !known.has(post.slug))
			.map((post) => repoToSummary(post));
	}

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

	const repo = (await readRepoPosts(c.env.ASSETS)).map((post) =>
		repoToSummary(post),
	);
	const known = new Set(repo.map((post) => String(post.slug)));

	const rows = await c.env.DB.prepare(
		"SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 200",
	).all<PostRow>();
	const extra = (rows.results ?? [])
		.filter((row) => !known.has(row.slug))
		.map((row) => toSummary(row));

	const posts = [...repo, ...extra].sort(
		(a, b) =>
			toMillis(b.published_at ?? b.updated_at) -
			toMillis(a.published_at ?? a.updated_at),
	);
	return c.json({ posts });
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

	const updated = await c.env.DB.prepare(
		`UPDATE posts
		    SET status = 'pending', submitted_at = datetime('now'), updated_at = datetime('now')
		  WHERE id = ?1 AND uid = ?2
		 RETURNING *`,
	)
		.bind(row.id, row.uid)
		.first<PostRow>();

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
		    SET status = 'draft', submitted_at = NULL, updated_at = datetime('now')
		  WHERE id = ?1 AND uid = ?2
		 RETURNING *`,
	)
		.bind(row.id, row.uid)
		.first<PostRow>();

	return c.json({ post: updated ? toDetail(updated) : null });
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
	const posts = await readRepoPosts(c.env.ASSETS);
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
	fm = setField(fm, "published", new Date().toISOString().slice(0, 10));
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

	const token = await repoToken(c);
	if (!token) return c.json(TOKEN_MISSING, 412);

	const path = `src/content/posts/${row.slug}.md`;
	const existing = await readRepoFile(path, token);
	if (existing.ok) {
		return c.json(
			{
				error: "slug_taken",
				message: `仓库里已经有 ${path}，换个地址再发`,
			},
			409,
		);
	}
	if (existing.status !== 404) {
		return c.json(
			{ error: "repo_read_failed", message: existing.message ?? "读取失败" },
			502,
		);
	}

	const content = joinMarkdown(buildPostFrontmatter(row), row.body ?? "");
	const written = await writeRepoFile(
		path,
		content,
		token,
		`feat(post): 发布《${row.title.trim()}》`,
	);
	if (!written.ok) {
		return c.json(
			{ error: "repo_write_failed", message: written.message ?? "写入失败" },
			502,
		);
	}

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
