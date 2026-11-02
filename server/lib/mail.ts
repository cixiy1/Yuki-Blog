const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Yuki Blog <mail@yiyu14.top>";

/**
 * 本地调试开关，三重闸门缺一不可：
 * ① AUTH_DEBUG 只在 .dev.vars 里，wrangler.jsonc 的 vars 永远不写这个键；
 * ② 只认回环地址，即便有人把 AUTH_DEBUG 误配到生产也吐不出东西；
 * ③ 只有各条「发信」路径会返回 debug_link。
 *
 * 不要写成「没配 RESEND_API_KEY 就回显链接」——
 * 那会在生产忘配 key 时把激活链接直接公开给全网。
 */
export function debugAuthEnabled(env: Env, requestUrl: string): boolean {
	if (env.AUTH_DEBUG !== "1") return false;
	const host = new URL(requestUrl).hostname;
	return (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "::1" ||
		host === "[::1]"
	);
}

export interface MailResult {
	ok: boolean;
	/** false 表示没有配置发信通道，调用方要决定降级策略 */
	sent: boolean;
	providerStatus?: number;
	providerMessage?: string;
}

const STYLE =
	"font-family:system-ui,-apple-system,'PingFang SC',sans-serif;line-height:1.7;color:#1f2328";

async function sendMail(
	env: Env,
	payload: { to: string; subject: string; text: string; html: string },
): Promise<MailResult> {
	if (!env.RESEND_API_KEY) {
		console.log(
			`[auth] RESEND_API_KEY 未配置，邮件只打印到 console: ${payload.to} | ${payload.subject}`,
		);
		return { ok: true, sent: false };
	}

	const from = env.MAIL_FROM || DEFAULT_FROM;
	try {
		const response = await fetch(RESEND_ENDPOINT, {
			method: "POST",
			headers: {
				authorization: `Bearer ${env.RESEND_API_KEY}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				from,
				to: [payload.to],
				subject: payload.subject,
				text: payload.text,
				html: payload.html,
			}),
			signal: AbortSignal.timeout(8000),
		});

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			console.error(
				`[auth] Resend 返回 ${response.status}: ${detail.slice(0, 300)}`,
			);
			return {
				ok: false,
				sent: true,
				providerStatus: response.status,
				providerMessage: detail.slice(0, 300),
			};
		}
		return { ok: true, sent: true };
	} catch (error) {
		console.error("[auth] Resend 请求异常", error);
		return { ok: false, sent: true };
	}
}

function buttonHtml(link: string, label: string): string {
	return `<p style="margin:20px 0"><a href="${link}" style="display:inline-block;padding:10px 20px;border-radius:10px;background:#0f766e;color:#fff;text-decoration:none;font-weight:600">${label}</a></p>`;
}

export async function sendVerifyMail(
	env: Env,
	to: string,
	link: string,
	account: string,
): Promise<MailResult> {
	const text = [
		`你好 ${account}，欢迎注册 Yuki Blog。`,
		"",
		"点击下面的链接完成邮箱验证（24 小时内有效）：",
		link,
		"",
		"如果不是你本人注册，忽略这封邮件即可。",
	].join("\n");

	const html = `<div style="${STYLE}">
  <p>你好 <strong>${account}</strong>，欢迎注册 Yuki Blog。</p>
  <p>点击下面的按钮完成邮箱验证，链接 24 小时内有效：</p>
  ${buttonHtml(link, "验证邮箱")}
  <p style="color:#59636e;font-size:13px">按钮打不开就复制这个地址：<br>${link}</p>
  <p style="color:#59636e;font-size:13px">如果不是你本人注册，忽略这封邮件即可。</p>
</div>`;

	return await sendMail(env, {
		to,
		subject: "验证你的邮箱 · Yuki Blog",
		text,
		html,
	});
}

export async function sendResetMail(
	env: Env,
	to: string,
	link: string,
): Promise<MailResult> {
	const text = [
		"有人请求重置这个邮箱在 Yuki Blog 的密码。",
		"",
		"点击下面的链接设置新密码（1 小时内有效）：",
		link,
		"",
		"如果不是你本人操作，忽略这封邮件即可，密码不会变。",
	].join("\n");

	const html = `<div style="${STYLE}">
  <p>有人请求重置这个邮箱在 Yuki Blog 的密码。</p>
  <p>点击下面的按钮设置新密码，链接 1 小时内有效：</p>
  ${buttonHtml(link, "重置密码")}
  <p style="color:#59636e;font-size:13px">按钮打不开就复制这个地址：<br>${link}</p>
  <p style="color:#59636e;font-size:13px">如果不是你本人操作，忽略这封邮件即可，密码不会变。</p>
</div>`;

	return await sendMail(env, {
		to,
		subject: "重置密码 · Yuki Blog",
		text,
		html,
	});
}

/** 邮箱已被注册时的提醒：既防枚举又给出明确下一步 */
export async function sendAccountExistsMail(
	env: Env,
	to: string,
	loginUrl: string,
	resetUrl: string,
): Promise<MailResult> {
	const text = [
		"有人用这个邮箱尝试注册 Yuki Blog，但该邮箱已经有账号了。",
		"",
		`直接登录：${loginUrl}`,
		`忘记密码：${resetUrl}`,
		"",
		"如果这不是你本人操作，忽略这封邮件即可。",
	].join("\n");

	const html = `<div style="${STYLE}">
  <p>有人用这个邮箱尝试注册 Yuki Blog，但该邮箱已经有账号了。</p>
  <p>如果就是你本人，直接登录或重置密码即可：</p>
  <p><a href="${loginUrl}" style="color:#0f766e">${loginUrl}</a><br>
     <a href="${resetUrl}" style="color:#0f766e">${resetUrl}</a></p>
  <p style="color:#59636e;font-size:13px">如果这不是你本人操作，忽略这封邮件即可。</p>
</div>`;

	return await sendMail(env, {
		to,
		subject: "这个邮箱已经注册过了 · Yuki Blog",
		text,
		html,
	});
}
