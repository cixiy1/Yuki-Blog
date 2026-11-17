import type { NotifyOutcome } from "./collab-notify";
import { sendOrgInviteMail } from "./mail";

/**
 * 组织邀请的通知信。
 *
 * 与共创那封一个口径：信发不出去不影响邀请本身（票已经在库里，对方下次打开
 * 管理端也能看到待处理），结果回给接口由前端提示。
 */
export interface OrgInviteNotifyInput {
	uid: number;
	org: string;
	description: string;
	inviter: string;
	/** 站内落地页：/admin/#/orgs/invite/<token> */
	link: string;
	/** YYYY-MM-DD */
	expiresAt: string;
}

export async function notifyOrgInvite(
	env: Env,
	input: OrgInviteNotifyInput,
): Promise<NotifyOutcome> {
	try {
		const row = await env.DB.prepare("SELECT email FROM users WHERE uid = ?1")
			.bind(input.uid)
			.first<{ email: string | null }>();
		const email = (row?.email ?? "").trim();
		if (!email) {
			console.log("[org] 被邀请人没有邮箱，跳过通知", input.uid);
			return "no_email";
		}

		const result = await sendOrgInviteMail(env, {
			to: email,
			org: input.org,
			description: input.description,
			inviter: input.inviter,
			link: input.link,
			expiresAt: input.expiresAt,
		});
		if (!result.ok) {
			console.log("[org] 邀请邮件发送失败", result.hint ?? "");
			return "failed";
		}
		if (result.sent) return "sent";
		return result.mode === "off" ? "no_mailer" : "failed";
	} catch (error) {
		console.error("[org] 邀请邮件异常", error);
		return "failed";
	}
}
