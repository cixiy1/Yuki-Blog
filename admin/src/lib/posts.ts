import { api } from "./api";

export type PostStatus =
	| "draft"
	| "pending"
	| "published"
	| "rejected"
	| "archived";

export interface PostSummary {
	id: number;
	/** db = D1 里的草稿/送审稿；repo = 仓库里早就存在的文章，只读 */
	origin: "db" | "repo";
	slug: string;
	title: string;
	summary: string;
	cover: string;
	tags: string[];
	status: PostStatus;
	repo_path: string;
	/** 转载来源，空串表示原创 */
	source_link: string;
	author: string;
	submitted_at: string | null;
	published_at: string | null;
	reviewed_at: string | null;
	review_note: string | null;
	created_at: string;
	updated_at: string;
}

export interface PostDetail extends PostSummary {
	body: string;
	meta: Record<string, unknown>;
}

export const STATUS_LABEL: Record<string, string> = {
	draft: "草稿",
	pending: "待审",
	published: "已发布",
	rejected: "被退回",
	archived: "已归档",
};

/** 编辑态：只有这两个状态可以改 */
export const EDITABLE_STATUS = ["draft", "rejected"];

export function isEditable(status: string): boolean {
	return EDITABLE_STATUS.includes(status);
}

export function formatTime(iso: string | null): string {
	if (!iso) return "—";
	// D1 的 datetime('now') 是 UTC 且不带时区标记，补上 Z 再按本地时间显示
	const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
	const date = new Date(normalized);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString("zh-CN", { hour12: false });
}

export async function listPosts(): Promise<PostSummary[]> {
	const data = await api.get<{ posts: PostSummary[] }>("/api/me/posts");
	return data.posts ?? [];
}

export async function getPost(id: number): Promise<PostDetail | null> {
	const data = await api.get<{ post: PostDetail | null }>(
		`/api/me/posts/${id}`,
	);
	return data.post;
}

export async function createPost(title: string): Promise<PostDetail | null> {
	const data = await api.post<{ post: PostDetail | null }>("/api/me/posts", {
		title,
	});
	return data.post;
}

export async function savePost(
	id: number,
	patch: Partial<
		Pick<
			PostDetail,
			"title" | "slug" | "summary" | "cover" | "body" | "tags" | "meta"
		>
	>,
): Promise<PostDetail | null> {
	const data = await api.put<{ post: PostDetail | null }>(
		`/api/me/posts/${id}`,
		patch,
	);
	return data.post;
}

export async function deletePost(id: number): Promise<void> {
	await api.delete(`/api/me/posts/${id}`);
}

/** 管理员直接发布：写成仓库文件并触发构建，不进审核队列 */
export async function publishPost(id: number): Promise<PostDetail | null> {
	const data = await api.post<{ post: PostDetail | null }>(
		`/api/me/posts/${id}/publish`,
	);
	return data.post;
}

export async function submitPost(id: number): Promise<PostDetail | null> {
	const data = await api.post<{ post: PostDetail | null }>(
		`/api/me/posts/${id}/submit`,
	);
	return data.post;
}

export async function withdrawPost(id: number): Promise<PostDetail | null> {
	const data = await api.post<{ post: PostDetail | null }>(
		`/api/me/posts/${id}/withdraw`,
	);
	return data.post;
}

/* ---------- 仓库文章：直接读写 src/content/posts 下的文件 ---------- */

export interface RepoPostDetail {
	slug: string;
	repoPath: string;
	/** 文章所在目录的 raw 前缀，给编辑器预览图片用 */
	rawBase: string;
	sha: string;
	title: string;
	description: string;
	tags: string[];
	category: string;
	series: string;
	sourceLink: string;
	published: string;
	draft: boolean;
	body: string;
}

export interface RepoPostPatch {
	slug: string;
	/** 用户改过的地址；留空表示沿用原 slug */
	nextSlug: string;
	title: string;
	description: string;
	tags: string[];
	category: string;
	series: string;
	sourceLink: string;
	published: string;
	draft: boolean;
	body: string;
}

export async function getRepoPost(slug: string): Promise<RepoPostDetail | null> {
	const data = await api.get<{ post: RepoPostDetail }>(
		`/api/me/repo-posts?slug=${encodeURIComponent(slug)}`,
	);
	return data.post ?? null;
}

/** 保存即提交到仓库并触发构建，站点约一分钟后就变了 */
export async function saveRepoPost(
	patch: RepoPostPatch,
): Promise<{ sha: string }> {
	return api.put<{ sha: string }>("/api/me/repo-posts", patch);
}

export async function deleteRepoPost(slug: string): Promise<void> {
	await api.delete<unknown>(`/api/me/repo-posts?slug=${encodeURIComponent(slug)}`);
}

/** 全站文章：仓库里的已发布内容，编辑走仓库文件 */
export async function listAllPosts(): Promise<PostSummary[]> {
	const data = await api.get<{ posts: PostSummary[] }>("/api/me/all-posts");
	return data.posts ?? [];
}

/**
 * 文章里的 `./images/a.webp` 是 Astro 的资产引用，构建时会被换成 `/_astro/hash.webp`，
 * 原路径在站点上不存在。编辑器直接渲染会 404，所以预览时换成仓库的 raw 地址，
 * 保存时再换回相对路径——否则每次保存都会把正文里的图片地址改写成 raw URL。
 */
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

export function bodyToPreview(body: string, rawBase: string): string {
	if (!rawBase) return body;
	return body.replace(
		IMAGE_RE,
		(whole: string, alt: string, src: string, title: string) => {
			if (/^(?:https?:|data:|\/|#)/i.test(src)) return whole;
			const clean = src.replace(/^\.\//, "");
			return `![${alt}](${rawBase}${clean}${title ?? ""})`;
		},
	);
}

export function bodyToStorage(body: string, rawBase: string): string {
	if (!rawBase) return body;
	return body.replace(
		IMAGE_RE,
		(whole: string, alt: string, src: string, title: string) => {
			if (!src.startsWith(rawBase)) return whole;
			return `![${alt}](./${src.slice(rawBase.length)}${title ?? ""})`;
		},
	);
}
