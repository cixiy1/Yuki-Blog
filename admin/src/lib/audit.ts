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
	"admin.settings.save",
	"admin.settings.apply",
	"admin.settings.publish",
	"admin.settings.publish_failed",
	"admin.settings.rollback",
	"admin.secrets.write",
	"admin.mail.save",
	"admin.mail.test",
	"review.approve",
	"review.note",
	"review.body",
	"review.reject",
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
	"admin.settings.save": "保存设置草稿",
	"admin.settings.apply": "应用设置草稿",
	"admin.settings.publish": "发布设置",
	"admin.settings.publish_failed": "发布设置失败",
	"admin.settings.rollback": "回滚设置",
	"admin.secrets.write": "写入密钥",
	"admin.mail.save": "保存发信配置",
	"admin.mail.test": "发送测试邮件",
	"review.approve": "审核通过",
	"review.note": "审核批注",
	"review.body": "审核改稿",
	"review.reject": "审核退回",
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
