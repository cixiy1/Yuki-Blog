import { api } from "./api";

/**
 * 文章共创的接口封装。
 *
 * 一篇文章的协作者名单按 slug 存：仓库文章没有 D1 行，草稿又有 slug，
 * slug 是两层唯一共有的标识。
 */
export interface CollabMember {
	uid: number;
	account: string;
	display_name: string | null;
	avatar_url: string | null;
	role: string;
	invited_by: number;
	created_at: string;
}

export interface CollabState {
	slug: string;
	limit: number;
	/** 当前登录者能不能加人/踢人（作者与管理员才行） */
	canManage: boolean;
	members: CollabMember[];
}

export function getCollab(slug: string): Promise<CollabState> {
	return api.get<CollabState>(`/api/collab?slug=${encodeURIComponent(slug)}`);
}

export function inviteCollab(
	slug: string,
	account: string,
): Promise<{ ok: boolean; members: CollabMember[] }> {
	return api.post<{ ok: boolean; members: CollabMember[] }>(
		"/api/collab/invite",
		{ slug, account },
	);
}

export function revokeCollab(
	slug: string,
	uid: number,
): Promise<{ ok: boolean; members: CollabMember[] }> {
	return api.post<{ ok: boolean; members: CollabMember[] }>(
		"/api/collab/revoke",
		{ slug, uid },
	);
}
