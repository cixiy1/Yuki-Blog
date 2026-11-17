import { sendCollabInviteMail, sendCollabRevokedMail } from "./mail";

/**
 * 共创的通知信。
 *
 * 只发给个人：邀请是「有人把稿子交到你手上」的私人通知，不走管理员邮箱那一套。
 * 发信失败不能让邀请失败——名单已经写进库了，回头作者能自己再确认一遍，
 * 所以这里只返回结果给接口，由前端决定要不要提示「信没发出去」。
 */

/**
 * sent       发出去了
 * no_email   对方账号没填邮箱
 * no_mailer  站点还没配发信通道（本地开发就是这种）
 * failed     配了但没发成功
 */
export type NotifyOutcome = "sent" | "no_email" | "no_mailer" | "failed";

interface Invitee {
	email: string;
	display_name: string;
	account: string;
}

async function readInvitee(env: Env, uid: number): Promise<Invitee | null> {
	const row = await env.DB.prepare(
		"SELECT email, display_name, account FROM users WHERE uid = ?1",
	)
		.bind(uid)
		.first<{
			email: string | null;
			display_name: string | null;
			account: string;
		}>();
	if (!row) return null;
	return {
		email: (row.email ?? "").trim(),
		display_name: row.display_name ?? "",
		account: row.account,
	};
}

export interface InviteNotifyInput {
	uid: number;
	title: string;
	inviter: string;
	link: string;
	published: boolean;
}

export async function notifyCollabInvite(
	env: Env,
	input: InviteNotifyInput,
): Promise<NotifyOutcome> {
	try {
		const invitee = await readInvitee(env, input.uid);
		if (!invitee?.email) {
			console.log("[collab] 被邀请人没有邮箱，跳过通知", input.uid);
			return "no_email";
		}

		const result = await sendCollabInviteMail(env, {
			to: invitee.email,
			title: input.title,
			inviter: input.inviter,
			link: input.link,
			published: input.published,
		});
		if (!result.ok) {
			console.log("[collab] 邀请邮件发送失败", result.hint ?? "");
			return "failed";
		}
		if (result.sent) return "sent";
		// 通道没配 vs 配了没发成功，管理端要给出不同的说法
		return result.mode === "off" ? "no_mailer" : "failed";
	} catch (error) {
		console.error("[collab] 邀请邮件异常", error);
		return "failed";
	}
}

export interface RevokeNotifyInput {
	uid: number;
	title: string;
	operator: string;
	link: string;
}

export async function notifyCollabRevoked(
	env: Env,
	input: RevokeNotifyInput,
): Promise<NotifyOutcome> {
	try {
		const invitee = await readInvitee(env, input.uid);
		if (!invitee?.email) return "no_email";

		const result = await sendCollabRevokedMail(env, {
			to: invitee.email,
			title: input.title,
			operator: input.operator,
			link: input.link,
		});
		if (!result.ok) return "failed";
		if (result.sent) return "sent";
		return result.mode === "off" ? "no_mailer" : "failed";
	} catch (error) {
		console.error("[collab] 收回通知异常", error);
		return "failed";
	}
}
