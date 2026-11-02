const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Yuki Blog <mail@yiyu14.top>";

/**
 * 本地调试开关，三重闸门缺一不可：
 * ① AUTH_DEBUG 只在 .dev.vars 里，wrangler.jsonc 的 vars 永远不写这个键；
 * ② 只认回环地址，即便有人把 AUTH_DEBUG 误配到生产也吐不出码；
 * ③ debug_code 只有 sendCode 这一个出口。
 *
 * 特别注意：不要写成「没配 RESEND_API_KEY 就吐码」，
 * 那会在生产忘配 key 时把验证码直接公开给全网。
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
	providerStatus?: number;
	providerMessage?: string;
}

export async function sendLoginCode(
	env: Env,
	to: string,
	code: string,
): Promise<MailResult> {
	if (!env.RESEND_API_KEY) {
		console.log(
			`[auth] RESEND_API_KEY 未配置，验证码只打印到 console: ${to} -> ${code}`,
		);
		return { ok: true };
	}

	const from = env.MAIL_FROM || DEFAULT_FROM;
	const text = [
		`你的登录验证码是 ${code}，10 分钟内有效。`,
		"",
		"如果不是你本人操作，忽略这封邮件即可。",
		"这封邮件由系统自动发出。",
	].join("\n");

	const html = `<div style="font-family:system-ui,-apple-system,'PingFang SC',sans-serif;line-height:1.7;color:#1f2328">
  <p>你的登录验证码是：</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
  <p style="color:#59636e">10 分钟内有效。如果不是你本人操作，忽略这封邮件即可。</p>
</div>`;

	try {
		const response = await fetch(RESEND_ENDPOINT, {
			method: "POST",
			headers: {
				authorization: `Bearer ${env.RESEND_API_KEY}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				from,
				to: [to],
				subject: `${code} 是你的登录验证码`,
				text,
				html,
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
				providerStatus: response.status,
				providerMessage: detail.slice(0, 300),
			};
		}
		return { ok: true };
	} catch (error) {
		console.error("[auth] Resend 请求异常", error);
		return { ok: false };
	}
}
