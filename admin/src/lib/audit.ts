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

/**
 * 与 server/lib/audit.ts 的 AuditAction 一一对应。
 * 服务端加了新动作这里没跟上的话，筛选下拉选不到，列表还会把原始英文串直接甩出来。
 */
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
	"user.profile.update",
	"user.email.request",
	"user.email.change",
	"admin.user.create",
	"admin.user.delete",
	"admin.user.status",
	"admin.user.role",
	"admin.user.profile",
	"admin.user.password",
	"org.create",
	"org.update",
	"org.member.add",
	"org.member.remove",
	"org.invite.create",
	"org.invite.revoke",
	"org.invite.accept",
	"admin.org.review",
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
	"review.withdraw",
	"media.upload",
	"media.delete",
	"media.replace",
	"series.update",
	"comment.create",
	"comment.delete",
	"comment.review",
	"admin.comments.config",
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
	"user.profile.update": "改个人资料",
	"user.email.request": "申请换邮箱",
	"user.email.change": "换邮箱",
	"admin.user.create": "新建用户",
	"admin.user.delete": "删除用户",
	"admin.user.status": "改用户状态",
	"admin.user.role": "改用户角色",
	"admin.user.profile": "改用户资料",
	"admin.user.password": "重置用户密码",
	"org.create": "新建组织",
	"org.update": "改组织",
	"org.member.add": "加成员",
	"org.member.remove": "移成员",
	"org.invite.create": "发邀请",
	"org.invite.revoke": "撤销邀请",
	"org.invite.accept": "接受邀请",
	"admin.org.review": "审核组织",
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
	"review.withdraw": "撤回审核",
	"media.upload": "上传图片",
	"media.delete": "删除图片",
	"media.replace": "替换图片",
	"series.update": "更新系列配置",
	"comment.create": "发表评论",
	"comment.delete": "删除评论",
	"comment.review": "审核评论",
	"admin.comments.config": "评论设置",
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
