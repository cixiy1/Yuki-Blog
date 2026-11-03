import { api } from "./api";

export interface AuditEntry {
	id: number;
	actor_uid: number | null;
	action: string;
	target: string | null;
	detail: string | null;
	ip_hash: string | null;
	created_at: string;
}

export interface AuditResult {
	logs: AuditEntry[];
	total: number;
	page: number;
	limit: number;
}

/** 与 server/lib/audit.ts 的 action 常量保持一致 */
export const AUDIT_ACTIONS: string[] = [
	"auth.register",
	"auth.login",
	"auth.login_failed",
	"auth.logout",
	"auth.verify_email",
	"auth.resend_verification",
	"auth.password_forgot",
	"auth.password_reset",
	"auth.password_change",
	"admin.user.create",
	"admin.user.delete",
	"admin.user.status",
	"admin.user.role",
	"admin.user.profile",
	"admin.user.password",
];

export const ACTION_LABEL: Record<string, string> = {
	"auth.register": "注册",
	"auth.login": "登录",
	"auth.login_failed": "登录失败",
	"auth.logout": "退出",
	"auth.verify_email": "验证邮箱",
	"auth.resend_verification": "重发验证",
	"auth.password_forgot": "申请重置密码",
	"auth.password_reset": "重置密码",
	"auth.password_change": "修改密码",
	"admin.user.create": "新建用户",
	"admin.user.delete": "删除用户",
	"admin.user.status": "改用户状态",
	"admin.user.role": "改用户角色",
	"admin.user.profile": "改用户资料",
	"admin.user.password": "重置用户密码",
};

export async function listAudit(
	action: string,
	page: number,
	limit = 30,
): Promise<AuditResult> {
	const params = new URLSearchParams();
	if (action) params.set("action", action);
	params.set("page", String(page));
	params.set("limit", String(limit));
	return await api.get<AuditResult>(`/api/admin/audit?${params.toString()}`);
}
