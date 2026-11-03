/**
 * 审计日志。
 * 约定：action 统一 `域.对象.动词`，detail 只放结构化的小字段，
 * **绝不出现**密码、密文、token、邮箱验证码。
 * 写失败不影响主流程（审计不该让登录挂掉）。
 */
export type AuditAction =
	| "auth.register"
	| "auth.login"
	| "auth.login_failed"
	| "auth.logout"
	| "auth.verify_email"
	| "auth.resend_verification"
	| "auth.password_forgot"
	| "auth.password_reset"
	| "auth.password_change"
	| "admin.user.create"
	| "admin.user.delete"
	| "admin.user.status"
	| "admin.user.role"
	| "admin.user.profile"
	| "admin.user.password"
	| "org.create"
	| "org.update"
	| "org.member.add"
	| "org.member.remove"
	| "org.invite.create"
	| "org.invite.revoke"
	| "org.invite.accept"
	| "admin.org.review"
	| "admin.settings.save"
	| "admin.settings.apply"
	| "admin.settings.publish"
	| "admin.settings.publish_failed"
	| "admin.settings.rollback"
	| "admin.secrets.write"
	| "review.approve"
	| "review.reject";

const DETAIL_KEYS = new Set([
	"from",
	"to",
	"method",
	"reason",
	"org_id",
	"keys",
	"sha",
	"status",
	"cleared",
	"version",
	// 用户管理的补充字段：改了哪个字段、是不是重置密码、新建出来的 uid
	"field",
	"reset",
	"uid",
	"role",
	"note",
	"slug",
]);

export interface AuditInput {
	actorUid?: number | null;
	action: AuditAction;
	target?: string | null;
	detail?: Record<string, unknown>;
	ipHash?: string | null;
}

function pickDetail(
	detail: Record<string, unknown> | undefined,
): string | null {
	if (!detail) return null;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(detail)) {
		if (!DETAIL_KEYS.has(key)) continue;
		if (value === undefined || value === null) continue;
		if (typeof value === "string") out[key] = value.slice(0, 200);
		else if (typeof value === "number" || typeof value === "boolean")
			out[key] = value;
	}
	return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

export async function writeAudit(
	db: D1Database,
	input: AuditInput,
): Promise<void> {
	try {
		await db
			.prepare(
				`INSERT INTO audit_log (actor_uid, action, target, detail_json, ip_hash)
				 VALUES (?1, ?2, ?3, ?4, ?5)`,
			)
			.bind(
				input.actorUid ?? null,
				input.action,
				input.target ? input.target.slice(0, 120) : null,
				pickDetail(input.detail),
				input.ipHash ?? null,
			)
			.run();
	} catch (error) {
		console.error("[audit] 写入失败", input.action, error);
	}
}
