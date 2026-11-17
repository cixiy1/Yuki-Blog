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

/** 通知信的结果：sent 已发出 / no_email 对方没邮箱 / no_mailer 站点没配发信 / failed 发送失败 */
export type MailOutcome = "sent" | "no_email" | "no_mailer" | "failed";

export interface CollabMutation {
	ok: boolean;
	mail: MailOutcome;
	members: CollabMember[];
}

export function inviteCollab(
	slug: string,
	account: string,
): Promise<CollabMutation> {
	return api.post<CollabMutation>("/api/collab/invite", { slug, account });
}

export function revokeCollab(
	slug: string,
	uid: number,
): Promise<CollabMutation> {
	return api.post<CollabMutation>("/api/collab/revoke", { slug, uid });
}

/** 按组织整组邀请的结果：加了几个人、信发出几封 */
export interface CollabOrgInvite {
	ok: boolean;
	added: number;
	skipped: number;
	/** 名额上限撞到了，后面的人没加进去 */
	limit: boolean;
	mails: { sent: number; no_email: number; no_mailer: number; failed: number };
	members: CollabMember[];
}

export function inviteCollabOrg(
	slug: string,
	orgId: number,
): Promise<CollabOrgInvite> {
	return api.post<CollabOrgInvite>("/api/collab/invite-org", { slug, orgId });
}
