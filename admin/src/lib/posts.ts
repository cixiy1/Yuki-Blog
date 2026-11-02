import { api } from "./api";

export type PostStatus =
	| "draft"
	| "pending"
	| "published"
	| "rejected"
	| "archived";

export interface PostSummary {
	id: number;
	slug: string;
	title: string;
	summary: string;
	cover: string;
	tags: string[];
	status: PostStatus;
	repo_path: string;
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
