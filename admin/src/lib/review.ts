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

export async function approvePost(id: number): Promise<void> {
	await api.post(`/api/admin/review/${id}/approve`, {});
}

export async function rejectPost(id: number, note: string): Promise<void> {
	await api.post(`/api/admin/review/${id}/reject`, { note });
}
