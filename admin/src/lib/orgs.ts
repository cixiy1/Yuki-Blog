import { api } from "./api";

/**
 * 组织：建组、拉人、接受邀请。
 *
 * 成员关系与邀请票都在 D1；站点页面用的名字/简介来自仓库里的
 * `config/orgs.json`（保存组织时由服务端同步写入，要等这次构建完成才可见）。
 */
export interface OrgSummary {
	id: number;
	slug: string;
	name: string;
	description: string;
	cover: string;
	owner_uid: number;
	created_at: string;
	myRole: "owner" | "admin" | "member" | null;
	members: number;
	canManage: boolean;
}

export interface OrgMember {
	uid: number;
	account: string;
	display_name: string | null;
	avatar_url: string | null;
	role: "owner" | "admin" | "member";
	created_at: string;
}

export interface OrgInvite {
	id: number;
	org_id: number;
	org_slug: string;
	org_name: string;
	uid: number;
	account: string;
	display_name: string | null;
	invited_by: number;
	inviter: string | null;
	status: string;
	created_at: string;
	expires_at: string;
	/** 只有「等我处理」的列表带：就地接受/拒绝要用 */
	token?: string;
}

/** 保存组织后站点页面的同步结果：site=false 表示要等下次构建才更新 */
export interface SiteSync {
	site: boolean;
	commit: string | null;
	warning?: string;
}

export interface OrgList {
	limit: number;
	orgs: OrgSummary[];
	invites: OrgInvite[];
}

export interface OrgDetail {
	org: {
		id: number;
		slug: string;
		name: string;
		description: string;
		cover: string;
		owner_uid: number;
		created_at: string;
	};
	myRole: "owner" | "admin" | "member" | null;
	canManage: boolean;
	limit: number;
	members: OrgMember[];
	invites: OrgInvite[];
}

/** 通知信的结果，与共创那套同一组取值 */
export type MailOutcome = "sent" | "no_email" | "no_mailer" | "failed";

export function listOrgs(): Promise<OrgList> {
	return api.get<OrgList>("/api/orgs");
}

export function getOrg(id: number): Promise<OrgDetail> {
	return api.get<OrgDetail>(`/api/orgs/${id}`);
}

export function createOrg(body: {
	slug: string;
	name: string;
	description?: string;
	cover?: string;
}): Promise<{ ok: boolean; org: OrgSummary; site: SiteSync }> {
	return api.post("/api/orgs", body);
}

export function updateOrg(
	id: number,
	body: { name?: string; description?: string; cover?: string },
): Promise<{ ok: boolean; site: SiteSync }> {
	return api.patch(`/api/orgs/${id}`, body);
}

export function deleteOrg(
	id: number,
): Promise<{ ok: boolean; site: SiteSync }> {
	return api.delete(`/api/orgs/${id}`);
}

/** 邀请：建票 + 发信，对方同意后才进组 */
export function inviteOrgMember(
	id: number,
	account: string,
): Promise<{
	ok: boolean;
	mail: MailOutcome;
	members: OrgMember[];
	invites: OrgInvite[];
}> {
	return api.post(`/api/orgs/${id}/members`, { account });
}

export function removeOrgMember(
	id: number,
	uid: number,
): Promise<{ ok: boolean; members: OrgMember[]; invites: OrgInvite[] }> {
	return api.post(`/api/orgs/${id}/members/remove`, { uid });
}

export function setOrgMemberRole(
	id: number,
	uid: number,
	role: "admin" | "member",
): Promise<{ ok: boolean; members: OrgMember[] }> {
	return api.post(`/api/orgs/${id}/members/role`, { uid, role });
}

export function revokeOrgInvite(
	id: number,
	inviteId: number,
): Promise<{ ok: boolean; invites: OrgInvite[] }> {
	return api.post(`/api/orgs/${id}/invites/revoke`, { inviteId });
}

export interface InviteView {
	org: { slug: string; name: string };
	inviter: string;
	status: string;
	mine: boolean;
	expired: boolean;
	expires_at: string;
}

export function getInvite(token: string): Promise<InviteView> {
	return api.get<InviteView>(`/api/orgs/invites/${encodeURIComponent(token)}`);
}

export function acceptInvite(
	token: string,
): Promise<{ ok: boolean; slug: string; name: string }> {
	return api.post("/api/orgs/invites/accept", { token });
}

export function declineInvite(token: string): Promise<{ ok: boolean }> {
	return api.post("/api/orgs/invites/decline", { token });
}
