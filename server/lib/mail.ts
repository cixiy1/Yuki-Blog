import {
	DEFAULT_FROM,
	type MailConfig,
	type MailMode,
	resolveMailConfig,
} from "./mail-config";
import {
	escapeHtml,
	factTable,
	hintText,
	inlineCode,
	linkLine,
	type MailBrand,
	type MailTheme,
	mailTheme,
	metaLine,
	paragraph,
	primaryButton,
	quoteBlock,
	renderMail,
	resolveBrand,
	sectionLabel,
	warnBlock,
} from "./mail-template";

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

/**
 * 邮件里要用对外地址。Worker 里的发信函数拿不到请求，所以：
 * env.SITE_ORIGIN 优先，其次用邮件里那个链接的 origin，最后回退线上域名。
 */
function originFrom(env: Env, fallbackLink: string): string {
	const configured = env.SITE_ORIGIN;
	if (configured?.startsWith("http")) return configured.replace(/\/$/, "");
	try {
		return new URL(fallbackLink).origin;
	} catch {
		return "https://yiyu14.top";
	}
}

/** 品牌与配色一起取，各封邮件开头都调它 */
async function mailStyle(
	env: Env,
	fallbackLink: string,
): Promise<{ brand: MailBrand; theme: MailTheme }> {
	const brand = await resolveBrand(env.DB, originFrom(env, fallbackLink));
	return { brand, theme: mailTheme(brand.hue) };
}

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
	const { brand, theme } = await mailStyle(env, origin);
	const channel =
		config.mode === "smtp"
			? `SMTP ${config.smtp.host}:${config.smtp.port}`
			: config.mode;
	const text = [
		"这封是 Yuki Blog 管理端发出的测试邮件。",
		"",
		`发信通道：${channel}`,
		`发件人：${config.from}`,
		`站点：${origin}`,
		"",
		"收到它说明验证码、找回密码这类邮件也能正常发出去。",
	].join("\n");

	const html = testMailHtml(brand, theme, {
		channel,
		from: config.from,
		origin,
	});

	const result = await sendMail(env, {
		to,
		subject: "发信配置测试 · Yuki Blog",
		text,
		html,
	});
	return { ...result, configMode: config.mode, from: config.from };
}

/**
 * 各封邮件的 HTML 组装单独导出：发信要连 SMTP，调版式不该被它挡住。
 * 预览脚本直接拿这些函数渲染，看到的就是线上那封信。
 */
export function testMailHtml(
	brand: MailBrand,
	theme: MailTheme,
	info: { channel: string; from: string; origin: string },
): string {
	return renderMail(brand, theme, {
		preheader: `发信通道 ${info.channel}，配置已生效`,
		heading: "发信配置测试",
		badge: { text: "通道已生效", tone: "accent" },
		body: [
			paragraph(theme, "下面三项是这封邮件实际用的配置。"),
			factTable(theme, [
				["发信通道", info.channel],
				["发件人", info.from],
				["站点", info.origin],
			]),
			hintText(
				theme,
				"收到它说明验证码、找回密码、待审提醒这些邮件也能正常发出去。",
			),
		].join("\n"),
		footNote: "这封只在管理端点「发送测试邮件」时发出。",
	});
}

export async function sendVerifyMail(
	env: Env,
	to: string,
	link: string,
	account: string,
): Promise<MailResult> {
	const { brand, theme } = await mailStyle(env, link);
	const text = [
		`你好 ${account}，欢迎注册 Yuki Blog。`,
		"",
		"点击下面的链接完成邮箱验证（24 小时内有效）：",
		link,
		"",
		"如果不是你本人注册，忽略这封邮件即可。",
	].join("\n");

	const html = verifyMailHtml(brand, theme, { account, link });

	return await sendMail(env, {
		to,
		subject: "验证你的邮箱 · Yuki Blog",
		text,
		html,
	});
}

export function verifyMailHtml(
	brand: MailBrand,
	theme: MailTheme,
	info: { account: string; link: string },
): string {
	return renderMail(brand, theme, {
		preheader: "验证这个邮箱，24 小时内有效。",
		heading: "验证你的邮箱",
		badge: { text: "24 小时内有效", tone: "muted" },
		body: [
			paragraph(
				theme,
				`你好 <strong>${escapeHtml(info.account)}</strong>，欢迎注册 ${escapeHtml(brand.name)}。`,
			),
			paragraph(theme, "点下面的按钮完成验证，这个链接 24 小时内有效。"),
			primaryButton(theme, info.link, "验证邮箱"),
			linkLine(theme, info.link),
			hintText(theme, "如果不是你本人注册，忽略这封邮件即可。"),
		].join("\n"),
	});
}

export async function sendResetMail(
	env: Env,
	to: string,
	link: string,
): Promise<MailResult> {
	const { brand, theme } = await mailStyle(env, link);
	const text = [
		"有人请求重置这个邮箱在 Yuki Blog 的密码。",
		"",
		"点击下面的链接设置新密码（1 小时内有效）：",
		link,
		"",
		"如果不是你本人操作，忽略这封邮件即可，密码不会变。",
	].join("\n");

	const html = resetMailHtml(brand, theme, link);

	return await sendMail(env, {
		to,
		subject: "重置密码 · Yuki Blog",
		text,
		html,
	});
}

export function resetMailHtml(
	brand: MailBrand,
	theme: MailTheme,
	link: string,
): string {
	return renderMail(brand, theme, {
		preheader: "设置新密码，链接 1 小时内有效。",
		heading: "重置密码",
		badge: { text: "1 小时内有效", tone: "muted" },
		body: [
			paragraph(theme, "有人请求重置这个邮箱的密码。"),
			paragraph(theme, "点下面的按钮设置新密码，链接 1 小时内有效。"),
			primaryButton(theme, link, "设置新密码"),
			linkLine(theme, link),
			hintText(theme, "如果不是你本人操作，忽略这封邮件即可，密码不会变。"),
		].join("\n"),
	});
}

/** 邮箱已被注册时的提醒：既防枚举又给出明确下一步 */
export async function sendAccountExistsMail(
	env: Env,
	to: string,
	loginUrl: string,
	resetUrl: string,
): Promise<MailResult> {
	const { brand, theme } = await mailStyle(env, loginUrl);
	const text = [
		"有人用这个邮箱尝试注册 Yuki Blog，但该邮箱已经有账号了。",
		"",
		`直接登录：${loginUrl}`,
		`忘记密码：${resetUrl}`,
		"",
		"如果这不是你本人操作，忽略这封邮件即可。",
	].join("\n");

	const html = accountExistsMailHtml(brand, theme, {
		loginUrl,
		resetUrl,
	});

	return await sendMail(env, {
		to,
		subject: "这个邮箱已经注册过了 · Yuki Blog",
		text,
		html,
	});
}

export function accountExistsMailHtml(
	brand: MailBrand,
	theme: MailTheme,
	info: { loginUrl: string; resetUrl: string },
): string {
	const { loginUrl, resetUrl } = info;
	const resetLink = `<a href="${escapeHtml(resetUrl)}" style="color:${theme.accentDeep};text-decoration:none;">重置密码</a>`;

	return renderMail(brand, theme, {
		preheader: "这个邮箱已有账号，直接登录即可。",
		heading: "这个邮箱已经注册过了",
		badge: { text: "无需重复注册", tone: "muted" },
		body: [
			paragraph(
				theme,
				`有人用这个邮箱尝试注册 ${escapeHtml(brand.name)}，但它已经有账号了。`,
			),
			paragraph(theme, "如果就是你本人，直接登录就行。"),
			primaryButton(theme, loginUrl, "直接登录"),
			linkLine(theme, loginUrl),
			paragraph(theme, `忘记密码的话，可以${resetLink}。`),
			hintText(theme, "如果这不是你本人操作，忽略这封邮件即可。"),
		].join("\n"),
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
	const { brand, theme } = await mailStyle(env, link);
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

	const html = emailChangeMailHtml(brand, theme, {
		account,
		currentEmail,
		newEmail: to,
		link,
	});

	return await sendMail(env, {
		to,
		subject: "确认更换邮箱 · Yuki Blog",
		text,
		html,
	});
}

export function emailChangeMailHtml(
	brand: MailBrand,
	theme: MailTheme,
	info: {
		account: string;
		currentEmail: string;
		newEmail: string;
		link: string;
	},
): string {
	return renderMail(brand, theme, {
		preheader: `确认把账号邮箱从 ${info.currentEmail} 换成这个地址。`,
		heading: "确认更换邮箱",
		badge: { text: "24 小时内有效", tone: "muted" },
		body: [
			paragraph(
				theme,
				`你好 <strong>${escapeHtml(info.account)}</strong>，有人请求把账号绑定的邮箱换成这个地址。`,
			),
			factTable(theme, [
				["当前邮箱", info.currentEmail],
				["新邮箱", info.newEmail],
			]),
			paragraph(theme, "点下面的按钮确认更换，链接 24 小时内有效。"),
			primaryButton(theme, info.link, "确认更换邮箱"),
			linkLine(theme, info.link),
			hintText(theme, "如果这不是你本人操作，忽略这封邮件即可，邮箱不会变。"),
		].join("\n"),
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
	const { brand, theme } = await mailStyle(env, resetUrl);
	const text = [
		`Yuki Blog 账号 ${account} 的邮箱已经改成了 ${newEmail}。`,
		"",
		"如果这是你本人操作，忽略这封邮件。",
		`如果不是，立刻用这个地址找回密码，然后到账号设置里改回去并更换密码：${resetUrl}`,
	].join("\n");

	const html = emailChangedMailHtml(brand, theme, {
		account,
		newEmail,
		resetUrl,
	});

	return await sendMail(env, {
		to,
		subject: "账号邮箱已更换 · Yuki Blog",
		text,
		html,
	});
}

export function emailChangedMailHtml(
	brand: MailBrand,
	theme: MailTheme,
	info: { account: string; newEmail: string; resetUrl: string },
): string {
	return renderMail(brand, theme, {
		preheader: `账号邮箱已改成 ${info.newEmail}`,
		heading: "账号邮箱已更换",
		badge: { text: "安全提醒", tone: "warn" },
		body: [
			paragraph(
				theme,
				`账号 <strong>${escapeHtml(info.account)}</strong> 的邮箱已经改成了 ${inlineCode(theme, info.newEmail)}。`,
			),
			paragraph(theme, "如果是你本人操作，这封邮件不用管。"),
			warnBlock(
				"如果不是你改的，说明有人拿到了你的账号。立刻用下面的按钮找回密码，再去账号设置里把邮箱改回来并换一个密码。",
			),
			primaryButton(theme, info.resetUrl, "找回密码"),
			linkLine(theme, info.resetUrl),
		].join("\n"),
	});
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
	const { brand, theme } = await mailStyle(env, payload.link);

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

	const html = reviewNotifyHtml(brand, theme, {
		title,
		facts,
		summary,
		link: payload.link,
	});

	const subject = `待审：《${title}》 · Yuki Blog`;
	return await sendToEach(env, payload.to, { subject, text, html });
}

export function reviewNotifyHtml(
	brand: MailBrand,
	theme: MailTheme,
	info: { title: string; facts: string[]; summary: string; link: string },
): string {
	return renderMail(brand, theme, {
		preheader: `《${info.title}》等你审`,
		heading: `《${info.title}》`,
		badge: { text: "待审核", tone: "accent" },
		body: [
			metaLine(theme, info.facts.join(" · ")),
			...(info.summary
				? [sectionLabel(theme, "摘要"), quoteBlock(theme, info.summary)]
				: []),
			primaryButton(theme, info.link, "去审核"),
			linkLine(theme, info.link),
			hintText(theme, "通过后写进仓库并触发构建，约 1 分钟后线上可见。"),
		].join("\n"),
		footNote:
			"收到这封是因为你的邮箱在「站点设置 → 集成 → 发信 → 管理员邮箱」里。",
	});
}

export interface ReviewApprovedMail {
	to: string;
	title: string;
	/** 审核员写的备注，可为空 */
	note: string;
	/** 作者看到的文章地址 */
	link: string;
}

/**
 * 稿子通过后回信给作者。
 * 备注是顺手留的话，没写就只报一句「已发布」——作者提交审核后本来就该知道结果。
 */
export async function sendReviewApprovedMail(
	env: Env,
	payload: ReviewApprovedMail,
): Promise<MailResult> {
	const title = payload.title.trim() || "（未命名）";
	const note = payload.note.trim();
	const { brand, theme } = await mailStyle(env, payload.link);

	const text = [
		`《${title}》已通过审核，已经发布。`,
		"",
		...(note ? ["审核员留了一句话：", note, ""] : []),
		`阅读：${payload.link}`,
		"",
		"发布后仍可在「我的文章」里重新编辑。",
	].join("\n");

	const html = reviewApprovedHtml(brand, theme, {
		title,
		note,
		link: payload.link,
	});

	return await sendMail(env, {
		to: payload.to,
		subject: `已通过：《${title}》 · Yuki Blog`,
		text,
		html,
	});
}

export function reviewApprovedHtml(
	brand: MailBrand,
	theme: MailTheme,
	info: { title: string; note: string; link: string },
): string {
	return renderMail(brand, theme, {
		preheader: `《${info.title}》已发布${info.note ? "，审核员留了句话" : ""}`,
		heading: `《${info.title}》`,
		badge: { text: "已通过审核", tone: "accent" },
		body: [
			...(info.note
				? [
						sectionLabel(theme, "审核员留了一句话"),
						quoteBlock(theme, info.note),
					]
				: [paragraph(theme, "审核员没有留备注，稿子已按原文发布。")]),
			primaryButton(theme, info.link, "打开文章"),
			hintText(theme, "发布后仍可在「我的文章」里重新编辑。"),
		].join("\n"),
	});
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
	const { brand, theme } = await mailStyle(env, payload.link);

	const text = [
		`《${title}》已被作者撤回，不用再审。`,
		"",
		...(author ? [`作者：${author}`, ""] : []),
		"这篇回到草稿状态继续修改，改完重新提交会再发一封提醒。",
		`审核队列：${payload.link}`,
	].join("\n");

	const html = reviewWithdrawHtml(brand, theme, {
		title,
		author,
		link: payload.link,
	});

	const subject = `已撤回：《${title}》 · Yuki Blog`;
	return await sendToEach(env, payload.to, { subject, text, html });
}

export function reviewWithdrawHtml(
	brand: MailBrand,
	theme: MailTheme,
	info: { title: string; author: string; link: string },
): string {
	return renderMail(brand, theme, {
		preheader: `《${info.title}》被作者撤回，不用再审`,
		heading: `《${info.title}》`,
		badge: { text: "不用再审", tone: "muted" },
		body: [
			...(info.author ? [metaLine(theme, `作者：${info.author}`)] : []),
			paragraph(
				theme,
				"作者把稿子撤回了，这篇不在待审队列里。改完重新提交会再发一封提醒。",
			),
			primaryButton(theme, info.link, "打开审核队列"),
		].join("\n"),
	});
}
