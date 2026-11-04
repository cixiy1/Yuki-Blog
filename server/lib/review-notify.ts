import { resolveAdminEmails } from "./admin-mail";
import {
	sendReviewApprovedMail,
	sendReviewNotifyMail,
	sendReviewWithdrawMail,
} from "./mail";

/**
 * 「有新稿待审」的邮件提醒。
 *
 * 收件人取「管理员邮箱」：站点设置里填了就用它（可填多个），没填则退化为
 * 所有启用中的管理员与审核员账号——刚部署完不配也能收到。
 *
 * 发信失败只写日志，不能让作者提交审核这件事跟着失败。
 */

export interface ReviewNotifyPost {
	id: number;
	uid: number;
	title: string;
	summary: string | null;
	body: string | null;
	meta_json: string | null;
}

/** 中文按字算，英文按词算，取个两者都说得过去的估计 */
function countWords(body: string): number {
	const han = (body.match(/[\u4e00-\u9fa5]/g) ?? []).length;
	const rest = body
		.replace(/[\u4e00-\u9fa5]/g, " ")
		.split(/\s+/)
		.filter((word) => /[a-zA-Z0-9]/.test(word)).length;
	return han + rest;
}

function readCategory(metaJson: string | null): string {
	if (!metaJson) return "";
	try {
		const meta: unknown = JSON.parse(metaJson);
		if (!meta || typeof meta !== "object") return "";
		const value = (meta as Record<string, unknown>).category;
		return typeof value === "string" ? value.trim() : "";
	} catch {
		return "";
	}
}

/** 摘要缺省时从正文首段抽一句，别让邮件只剩个标题 */
function fallbackSummary(body: string): string {
	const plain = body
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^[>#\-\s]+/gm, "")
		.replace(/[*_`]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
}

export async function notifyReviewers(
	env: Env,
	post: ReviewNotifyPost,
	origin: string,
): Promise<void> {
	try {
		const to = await resolveAdminEmails(env);
		if (to.length === 0) {
			console.log("[review] 没配管理员邮箱，也没有可用的管理员账号，跳过提醒");
			return;
		}

		const author = await env.DB.prepare(
			"SELECT display_name FROM users WHERE uid = ?1",
		)
			.bind(post.uid)
			.first<{ display_name: string }>();

		const body = post.body ?? "";
		const summary = (post.summary ?? "").trim() || fallbackSummary(body);

		const result = await sendReviewNotifyMail(env, {
			to,
			title: post.title,
			author: author?.display_name ?? "",
			category: readCategory(post.meta_json),
			summary,
			wordCount: countWords(body),
			link: `${origin}/admin/#/review/${post.id}`,
		});

		if (!result.ok) {
			console.error(
				"[review] 待审提醒没发出去:",
				result.hint ?? result.providerMessage ?? "未知原因",
			);
			return;
		}
		console.log(
			`[review] 待审提醒已发送（${result.mode}${result.sent ? "" : "，未配置通道只记日志"}）→ ${to.join(", ")}`,
		);
	} catch (error) {
		console.error(
			"[review] 待审提醒异常:",
			error instanceof Error ? error.message : String(error),
		);
	}
}

/**
 * 作者主动撤回时告诉审核人「别看了」。
 * 待审邮件已经发出去过，撤回不发信，人家会白打开一次。
 */
export async function notifyWithdrawn(
	env: Env,
	post: ReviewNotifyPost,
	origin: string,
): Promise<void> {
	try {
		const to = await resolveAdminEmails(env);
		if (to.length === 0) {
			console.log("[review] 没有可通知的收件人，跳过撤回提醒");
			return;
		}

		const author = await env.DB.prepare(
			"SELECT display_name FROM users WHERE uid = ?1",
		)
			.bind(post.uid)
			.first<{ display_name: string }>();

		const result = await sendReviewWithdrawMail(env, {
			to,
			title: post.title,
			author: author?.display_name ?? "",
			link: `${origin}/admin/#/review`,
		});

		if (!result.ok) {
			console.error(
				"[review] 撤回提醒没发出去:",
				result.hint ?? result.providerMessage ?? "未知原因",
			);
			return;
		}
		console.log(
			`[review] 撤回提醒已发送（${result.mode}${result.sent ? "" : "，未配置通道只记日志"}）→ ${to.join(", ")}`,
		);
	} catch (error) {
		console.error(
			"[review] 撤回提醒异常:",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export interface ReviewApprovedPost {
	title: string;
	slug: string;
}

/**
 * 通过之后回信给作者，带上审核员写的备注。
 *
 * 只发作者本人，不走「管理员邮箱」——那是给自己人看的收件人；
 * 这封是给写作者的答复，抄给管理员只会让两边都收到重复邮件。
 * 作者账号没填邮箱就跳过，日志里留一句，别让通过流程跟着失败。
 */
export async function notifyApproved(
	env: Env,
	post: ReviewApprovedPost,
	note: string,
	authorEmail: string,
	origin: string,
): Promise<void> {
	try {
		const to = authorEmail.trim();
		if (!to) {
			console.log("[review] 作者没填邮箱，跳过通过提醒");
			return;
		}

		const result = await sendReviewApprovedMail(env, {
			to,
			title: post.title,
			note,
			link: `${origin}/posts/${post.slug}/`,
		});

		if (!result.ok) {
			console.error(
				"[review] 通过提醒没发出去:",
				result.hint ?? result.providerMessage ?? "未知原因",
			);
			return;
		}
		console.log(
			`[review] 通过提醒已发送（${result.mode}${result.sent ? "" : "，未配置通道只记日志"}）→ ${to}`,
		);
	} catch (error) {
		console.error(
			"[review] 通过提醒异常:",
			error instanceof Error ? error.message : String(error),
		);
	}
}
