import {
	DEFAULT_FROM,
	type MailConfig,
	type MailMode,
	resolveMailConfig,
} from "./mail-config";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

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
	/** 实际走的通道：resend / smtp / off */
	mode?: MailMode;
	providerStatus?: number;
	providerMessage?: string;
	/** 面向人的失败原因，管理端「发送测试邮件」直接展示这句 */
	hint?: string;
}

const STYLE =
	"font-family:system-ui,-apple-system,'PingFang SC',sans-serif;line-height:1.7;color:#1f2328";

/** `Yuki Blog <mail@yiyu14.top>` → { name, email } */
function parseFrom(raw: string): { name?: string; email: string } {
	const text = (raw || DEFAULT_FROM).trim();
	const match = /^(.*?)<([^>]+)>$/.exec(text);
	if (match) {
		const name = match[1].trim().replace(/^"|"$/g, "");
		return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
	}
	return { email: text };
}

/** SMTP 侧的报错通常带命令与响应码，翻成一句能据以排查的话 */
function describeSmtpFailure(error: unknown): string {
	const err = error as {
		code?: string;
		responseCode?: number;
		message?: string;
	};
	const code = err?.code ?? (err?.responseCode ? String(err.responseCode) : "");
	const text = (err?.message ?? String(error)).slice(0, 300);
	if (/AUTH|535|534|5\.7\.8/i.test(`${code} ${text}`))
		return `服务器拒绝登录，检查用户名与授权码（很多邮箱要用「授权码」而不是登录密码）：${text}`;
	if (/ETIMEDOUT|timeout|timed out/i.test(text))
		return `连接超时，检查主机与端口，以及该主机是否放通出站 465/587：${text}`;
	if (/ENOTFOUND|DNS|getaddrinfo/i.test(text))
		return `解析不到这个 SMTP 主机名：${text}`;
	if (/SSL|TLS|certificate/i.test(text))
		return `TLS 握手失败，多半是加密方式选错（465 选 SSL、587 选 STARTTLS）：${text}`;
	return code ? `${code}: ${text}` : text;
}

async function sendViaResend(
	config: MailConfig,
	payload: { to: string; subject: string; text: string; html: string },
): Promise<MailResult> {
	try {
		const response = await fetch(RESEND_ENDPOINT, {
			method: "POST",
			headers: {
				authorization: `Bearer ${config.resendKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				from: config.from,
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
				`[mail] Resend 返回 ${response.status}: ${detail.slice(0, 300)}`,
			);
			const hint =
				response.status === 401 || response.status === 403
					? "API Key 不对或没有发信权限，去 Resend 重新生成一个。"
					: /domain/i.test(detail)
						? "发件域名还没在 Resend 通过验证：域名页加 DNS 记录，验证完再发。"
						: /only send testing emails/i.test(detail)
							? "Resend 在域名验证前只能发给账号自己的邮箱，先把域名验证掉。"
							: null;
			return {
				ok: false,
				sent: true,
				mode: "resend",
				providerStatus: response.status,
				providerMessage: detail.slice(0, 300),
				hint: hint ?? undefined,
			};
		}
		return { ok: true, sent: true, mode: "resend" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("[mail] Resend 请求异常", message);
		return {
			ok: false,
			sent: true,
			mode: "resend",
			providerMessage: message.slice(0, 300),
			hint: "请求没能发出去，检查网络或 Key 是否失效。",
		};
	}
}

async function sendViaSmtp(
	config: MailConfig,
	payload: { to: string; subject: string; text: string; html: string },
): Promise<MailResult> {
	const { host, port, security, user, pass } = config.smtp;
	const { WorkerMailer } = await import("worker-mailer");

	let mailer: Awaited<ReturnType<typeof WorkerMailer.connect>> | null = null;
	try {
		mailer = await WorkerMailer.connect({
			host,
			port,
			// 465 一上来就是 TLS；587 走 STARTTLS；none 只给内网中继和本地调试
			secure: security === "ssl",
			startTls: security === "starttls",
			credentials:
				user && pass ? { username: user, password: pass } : undefined,
			authType: ["login", "plain"],
			socketTimeoutMs: 10_000,
			responseTimeoutMs: 10_000,
			name: "yiyu14.top",
		});
		await mailer.send({
			from: parseFrom(config.from),
			to: payload.to,
			subject: payload.subject,
			text: payload.text,
			html: payload.html,
		});
		return { ok: true, sent: true, mode: "smtp" };
	} catch (error) {
		const hint = describeSmtpFailure(error);
		console.error("[mail] SMTP 发送失败:", hint);
		return {
			ok: false,
			sent: true,
			mode: "smtp",
			providerMessage: hint.slice(0, 300),
			hint,
		};
	} finally {
		await mailer?.close().catch(() => {});
	}
}

/**
 * 统一入口：按配置选通道。
 * 没配任何通道时只打日志（本地开发），返回值 ok=true 但 sent=false，
 * 调用方据此决定要不要把链接回显到接口里。
 */
async function sendMail(
	env: Env,
	payload: { to: string; subject: string; text: string; html: string },
): Promise<MailResult> {
	const config = await resolveMailConfig(env);

	if (config.mode === "off" || (config.mode === "smtp" && !config.smtp.host)) {
		console.log(
			`[mail] 未配置发信通道，邮件只打印到 console: ${payload.to} | ${payload.subject}`,
		);
		return { ok: true, sent: false, mode: "off" };
	}

	if (config.mode === "resend") {
		if (!config.resendKey) {
			return {
				ok: false,
				sent: false,
				mode: "resend",
				hint: "选了 Resend 但没填 API Key。",
			};
		}
		return await sendViaResend(config, payload);
	}

	return await sendViaSmtp(config, payload);
}

/** 管理端「发送测试邮件」：内容写清当前走哪条通道，方便一眼看出配置生效没 */
export async function sendTestMail(
	env: Env,
	to: string,
	origin: string,
): Promise<MailResult & { configMode: MailMode; from: string }> {
	const config = await resolveMailConfig(env);
	const text = [
		"这封是 Yuki Blog 管理端发出的测试邮件。",
		"",
		`发信通道：${config.mode === "smtp" ? `SMTP（${config.smtp.host}:${config.smtp.port}）` : config.mode}`,
		`发件人：${config.from}`,
		`站点：${origin}`,
		"",
		"收到它说明验证码、找回密码这类邮件也能正常发出去。",
	].join("\n");

	const html = `<div style="${STYLE}">
  <p>这封是 <strong>Yuki Blog 管理端</strong> 发出的测试邮件。</p>
  <p>发信通道：<code>${config.mode === "smtp" ? `SMTP ${config.smtp.host}:${config.smtp.port}` : config.mode}</code><br>
     发件人：<code>${config.from}</code><br>
     站点：<code>${origin}</code></p>
  <p style="color:#59636e;font-size:13px">收到它说明验证码、找回密码这类邮件也能正常发出去。</p>
</div>`;

	const result = await sendMail(env, {
		to,
		subject: "发信配置测试 · Yuki Blog",
		text,
		html,
	});
	return { ...result, configMode: config.mode, from: config.from };
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

/**
 * 换邮箱确认信：发到**新**地址。点链接前，账号上还是旧邮箱。
 */
export async function sendEmailChangeMail(
	env: Env,
	to: string,
	link: string,
	account: string,
	currentEmail: string,
): Promise<MailResult> {
	const text = [
		`你好 ${account}，有人请求把 Yuki Blog 账号的邮箱改成这个地址。`,
		"",
		`当前邮箱：${currentEmail}`,
		"",
		"点击下面的链接确认更换（24 小时内有效）：",
		link,
		"",
		"如果这不是你本人操作，忽略这封邮件即可，邮箱不会变。",
	].join("\n");

	const html = `<div style="${STYLE}">
  <p>你好 <strong>${escapeHtml(account)}</strong>，有人请求把 Yuki Blog 账号的邮箱改成这个地址。</p>
  <p>当前邮箱：<code>${escapeHtml(currentEmail)}</code></p>
  <p>点击下面的按钮确认更换，链接 24 小时内有效：</p>
  ${buttonHtml(link, "确认更换邮箱")}
  <p style="color:#59636e;font-size:13px">按钮打不开就复制这个地址：<br>${link}</p>
  <p style="color:#59636e;font-size:13px">如果这不是你本人操作，忽略这封邮件即可，邮箱不会变。</p>
</div>`;

	return await sendMail(env, {
		to,
		subject: "确认更换邮箱 · Yuki Blog",
		text,
		html,
	});
}

/** 换成功之后给旧地址的告知信：账号可能被人接管时，这是最后一道线索。 */
export async function sendEmailChangedNoticeMail(
	env: Env,
	to: string,
	account: string,
	newEmail: string,
	resetUrl: string,
): Promise<MailResult> {
	const text = [
		`Yuki Blog 账号 ${account} 的邮箱已经改成了 ${newEmail}。`,
		"",
		"如果这是你本人操作，忽略这封邮件。",
		`如果不是，立刻用这个地址找回密码，然后到账号设置里改回去并更换密码：${resetUrl}`,
	].join("\n");

	const html = `<div style="${STYLE}">
  <p>Yuki Blog 账号 <strong>${escapeHtml(account)}</strong> 的邮箱已经改成了 <code>${escapeHtml(newEmail)}</code>。</p>
  <p style="color:#59636e;font-size:13px">如果这是你本人操作，忽略这封邮件。</p>
  <p style="color:#b45309;font-size:13px">如果不是你操作，立刻用这个地址找回密码，然后到账号设置里把邮箱改回来并更换密码：</p>
  ${buttonHtml(resetUrl, "找回密码")}
</div>`;

	return await sendMail(env, {
		to,
		subject: "账号邮箱已更换 · Yuki Blog",
		text,
		html,
	});
}

function escapeHtml(raw: string): string {
	return raw
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * 逐个地址发送：SMTP 一次塞多个收件人，被其中一个拒掉会连累其他人。
 * 遇到第一个失败就返回，调用方据此决定日志。
 */
async function sendToEach(
	env: Env,
	to: string[],
	mail: { subject: string; text: string; html: string },
): Promise<MailResult> {
	let last: MailResult = { ok: true, sent: false, mode: "off" };
	for (const address of to) {
		last = await sendMail(env, { to: address, ...mail });
		if (!last.ok) return last;
	}
	return last;
}

export interface ReviewNotifyMail {
	to: string[];
	title: string;
	author: string;
	category: string;
	summary: string;
	wordCount: number;
	/** 审核页直达链接 */
	link: string;
}

/**
 * 有新稿提交审核时提醒管理员。
 */
export async function sendReviewNotifyMail(
	env: Env,
	payload: ReviewNotifyMail,
): Promise<MailResult> {
	const title = payload.title.trim() || "（未命名）";
	const facts = [
		payload.author ? `作者：${payload.author}` : "",
		payload.category ? `分类：${payload.category}` : "",
		`字数：${payload.wordCount}`,
	].filter(Boolean);
	const summary = payload.summary.trim();

	const text = [
		"有一篇新文章提交审核。",
		"",
		`《${title}》`,
		facts.join(" · "),
		"",
		...(summary ? ["摘要：", summary, ""] : []),
		`去审：${payload.link}`,
		"",
		"审核通过后会写到仓库并触发构建，约 1 分钟后线上可见。",
	].join("\n");

	const html = `<div style="${STYLE}">
  <p>有一篇新文章提交审核。</p>
  <p style="font-size:17px;font-weight:600;margin:12px 0 6px">《${escapeHtml(title)}》</p>
  <p style="color:#59636e;font-size:13px;margin:0 0 14px">${escapeHtml(facts.join(" · "))}</p>
  ${summary ? `<blockquote style="margin:0 0 4px;padding:10px 14px;border-left:3px solid #d5d9de;color:#3d444d;font-size:14px">${escapeHtml(summary)}</blockquote>` : ""}
  ${buttonHtml(payload.link, "去审核")}
  <p style="color:#59636e;font-size:13px">按钮打不开就复制这个地址：<br>${escapeHtml(payload.link)}</p>
  <p style="color:#59636e;font-size:13px">通过后写进仓库并触发构建，约 1 分钟后线上可见。</p>
</div>`;

	const subject = `待审：《${title}》 · Yuki Blog`;
	return await sendToEach(env, payload.to, { subject, text, html });
}

export interface ReviewWithdrawMail {
	to: string[];
	title: string;
	author: string;
	/** 审核队列地址，方便顺手确认它确实不在了 */
	link: string;
}

/**
 * 作者撤回待审稿时提醒审核人。
 * 目的只有一个：别让人点开一封待审邮件，却发现队列里没有这篇。
 */
export async function sendReviewWithdrawMail(
	env: Env,
	payload: ReviewWithdrawMail,
): Promise<MailResult> {
	const title = payload.title.trim() || "（未命名）";
	const author = payload.author.trim();

	const text = [
		`《${title}》已被作者撤回，不用再审。`,
		"",
		...(author ? [`作者：${author}`, ""] : []),
		"这篇回到草稿状态继续修改，改完重新提交会再发一封提醒。",
		`审核队列：${payload.link}`,
	].join("\n");

	const html = `<div style="${STYLE}">
  <p>下面这篇已被作者撤回，不用再审。</p>
  <p style="font-size:17px;font-weight:600;margin:12px 0 6px">《${escapeHtml(title)}》</p>
  ${author ? `<p style="color:#59636e;font-size:13px;margin:0 0 14px">作者：${escapeHtml(author)}</p>` : ""}
  <p style="color:#59636e;font-size:13px">这篇回到草稿状态继续修改，改完重新提交会再发一封提醒。</p>
  ${buttonHtml(payload.link, "打开审核队列")}
</div>`;

	const subject = `已撤回：《${title}》 · Yuki Blog`;
	return await sendToEach(env, payload.to, { subject, text, html });
}
