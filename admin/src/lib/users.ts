import { api } from "./api";

export interface AdminUser {
	uid: number;
	account: string;
	email: string;
	role: string;
	status: string;
	display_name: string;
	avatar_url: string | null;
	email_verified: number;
	last_login_at: string | null;
	created_at: string;
}

export interface UserListQuery {
	q?: string;
	role?: string;
	status?: string;
	page?: number;
	limit?: number;
}

export interface UserListResult {
	users: AdminUser[];
	total: number;
	page: number;
	limit: number;
}

export const ROLE_LABEL: Record<string, string> = {
	user: "普通用户",
	reviewer: "审核员",
	admin: "管理员",
};

export const STATUS_LABEL: Record<string, string> = {
	pending: "待验证",
	active: "正常",
	disabled: "已停用",
	deleted: "已删除",
};

export function formatTime(iso: string | null): string {
	if (!iso) return "—";
	const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
	const date = new Date(normalized);
	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleString("zh-CN", { hour12: false });
}

export async function listUsers(query: UserListQuery): Promise<UserListResult> {
	const params = new URLSearchParams();
	if (query.q) params.set("q", query.q);
	if (query.role) params.set("role", query.role);
	if (query.status) params.set("status", query.status);
	params.set("page", String(query.page ?? 1));
	params.set("limit", String(query.limit ?? 20));
	return await api.get<UserListResult>(`/api/admin/users?${params.toString()}`);
}

export async function patchUser(
	uid: number,
	patch: UserPatch,
): Promise<AdminUser> {
	const data = await api.patch<{ user: AdminUser }>(
		`/api/admin/users/${uid}`,
		patch,
	);
	return data.user;
}

export interface UserPatch {
	status?: string;
	role?: string;
	display_name?: string;
	email?: string;
	password?: string;
}

export interface NewUser {
	account: string;
	email: string;
	display_name?: string;
	password: string;
	role?: string;
	status?: "active" | "pending";
}

export interface AuditEntry {
	id: number;
	actor_uid: number | null;
	action: string;
	target: string | null;
	detail_json: string | null;
	ip_hash: string | null;
	created_at: string;
}

export async function getUser(
	uid: number,
): Promise<{ user: AdminUser; audit: AuditEntry[] }> {
	return await api.get<{ user: AdminUser; audit: AuditEntry[] }>(
		`/api/admin/users/${uid}`,
	);
}

export async function createUser(input: NewUser): Promise<AdminUser> {
	const data = await api.post<{ user: AdminUser }>("/api/admin/users", input);
	return data.user;
}

export async function deleteUser(uid: number): Promise<void> {
	await api.delete(`/api/admin/users/${uid}`);
}
