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
	patch: { status?: string; role?: string },
): Promise<AdminUser> {
	const data = await api.patch<{ user: AdminUser }>(
		`/api/admin/users/${uid}`,
		patch,
	);
	return data.user;
}
