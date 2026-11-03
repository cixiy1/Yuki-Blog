import { api } from "./api";

/** 待审队列里的一条。正文不拉全文，只给长度，够判断要不要点开 */
export interface QueueItem {
	id: number;
	uid: number;
	slug: string;
	title: string;
	summary: string | null;
	submitted_at: string | null;
	updated_at: string;
	body_len: number;
	author: string;
}

export async function listQueue(): Promise<QueueItem[]> {
	const data = await api.get<{ posts: QueueItem[] }>("/api/admin/review/queue");
	return data.posts ?? [];
}

/** 一条划词批注：引用原文 + 建议 */
export interface ReviewNote {
	id: number;
	quote: string;
	note: string;
	created_at: string;
	reviewer: string;
	reviewer_uid: number;
}

/** 队列里点开某一篇后的全文，字段与「我的文章」详情同形，另带作者信息 */
export interface ReviewPost {
	id: number;
	uid: number;
	slug: string;
	title: string;
	summary: string;
	cover: string;
	tags: string[];
	body: string;
	meta: Record<string, unknown>;
	status: string;
	source_link: string;
	author: string;
	author_account: string;
	author_avatar: string | null;
	repo_path: string;
	submitted_at: string | null;
	updated_at: string;
	review_note: string | null;
	/** 审核员存下的改稿，作者点「采用」才会用 */
	review_body: string | null;
	review_body_at: string | null;
	notes: ReviewNote[];
}

export async function getQueuePost(id: number): Promise<ReviewPost> {
	const data = await api.get<{ post: ReviewPost }>(`/api/admin/review/${id}`);
	return data.post;
}

export async function addReviewNote(
	id: number,
	quote: string,
	note: string,
): Promise<ReviewNote> {
	const data = await api.post<{ note: ReviewNote }>(
		`/api/admin/review/${id}/notes`,
		{ quote, note },
	);
	return data.note;
}

export async function deleteReviewNote(
	id: number,
	noteId: number,
): Promise<void> {
	await api.delete(`/api/admin/review/${id}/notes/${noteId}`);
}

export async function approvePost(id: number): Promise<void> {
	await api.post(`/api/admin/review/${id}/approve`, {});
}

export async function rejectPost(id: number, note: string): Promise<void> {
	await api.post(`/api/admin/review/${id}/reject`, { note });
}

/** 审核员改好的正文，只存 D1 给作者参考 */
export interface SaveBodyResult {
	changed: boolean;
	cleared: boolean;
	saved_at: string | null;
}

export async function saveReviewBody(
	id: number,
	body: string,
): Promise<SaveBodyResult> {
	return api.post<SaveBodyResult>(`/api/admin/review/${id}/body`, { body });
}
