import { KEY_PUBLISHED, readSetting } from "./site-config";

/**
 * 邮件 HTML 模板。
 *
 * 版式照站点的样子来：浅色页底、白色卡片、1px 描边、16px 圆角，强调色取主题色相。
 * 两条硬约束决定了写法：
 *  1. 邮件客户端不认 oklch / color-mix / CSS 变量，颜色必须在服务端算成十六进制；
 *  2. Outlook 用 Word 渲染，只能吃表格布局，所以整封信是嵌套 table，不靠 flex。
 *
 * 主题色相取管理端发布过的 `site.themeColor.hue`，没发布过就用 siteConfig 的默认值。
 * 读库失败不能连累发信，一律回退。
 */

/** 与服务端无参兜底：站点默认色相 */
const DEFAULT_HUE = 180;
const DEFAULT_NAME = "Yuki Blog";
const DEFAULT_TAGLINE = "雪穗博客";

export interface MailBrand {
	name: string;
	tagline: string;
	hue: number;
	/** 站点对外地址，页脚「前往站点」用 */
	url: string;
}

export interface MailTheme {
	hue: number;
	/** 信纸外的底色，比卡片略深一点，让卡片浮起来 */
	pageBg: string;
	cardBg: string;
	/** 卡片描边 */
	line: string;
	/** 浅色块：引用、页脚、徽章底色 */
	tint: string;
	tintLine: string;
	ink: string;
	inkSoft: string;
	inkFaint: string;
	/** 按钮底、顶部色条 */
	accent: string;
	/** 强调文字，比 accent 再深一档，小字也压得住 */
	accentDeep: string;
	accentSoft: string;
}

const FONT =
	"-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

/** hsl → #rrggbb。只为了把主题色相变成邮件客户端能认的颜色。 */
export function hslToHex(h: number, s: number, l: number): string {
	const hue = ((h % 360) + 360) % 360;
	const sat = Math.min(100, Math.max(0, s)) / 100;
	const light = Math.min(100, Math.max(0, l)) / 100;
	const c = (1 - Math.abs(2 * light - 1)) * sat;
	const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = light - c / 2;
	let rgb: [number, number, number];
	if (hue < 60) rgb = [c, x, 0];
	else if (hue < 120) rgb = [x, c, 0];
	else if (hue < 180) rgb = [0, c, x];
	else if (hue < 240) rgb = [0, x, c];
	else if (hue < 300) rgb = [x, 0, c];
	else rgb = [c, 0, x];
	const hex = rgb
		.map((value) =>
			Math.round((value + m) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("");
	return `#${hex}`;
}

export function mailTheme(hue: number): MailTheme {
	const h = Number.isFinite(hue)
		? Math.min(360, Math.max(0, hue))
		: DEFAULT_HUE;
	return {
		hue: h,
		pageBg: hslToHex(h, 18, 96),
		cardBg: "#ffffff",
		line: hslToHex(h, 16, 90),
		tint: hslToHex(h, 32, 95.5),
		tintLine: hslToHex(h, 28, 87),
		ink: "#1f2328",
		inkSoft: "#4d5761",
		inkFaint: "#7b848d",
		accent: hslToHex(h, 58, 35),
		accentDeep: hslToHex(h, 60, 28),
		accentSoft: hslToHex(h, 52, 96),
	};
}

let cached: { at: number; name: string; tagline: string; hue: number } | null =
	null;

/**
 * 读站点名与主题色相。站点设置发布过就跟着走，没发布过用内置默认。
 * 缓存 60 秒：一封待审通知可能连发十来个收件人，不必每封都查一次。
 */
async function brandBasics(
	db: D1Database,
): Promise<{ name: string; tagline: string; hue: number }> {
	if (cached && Date.now() - cached.at < 60_000) return cached;

	let name = DEFAULT_NAME;
	let tagline = DEFAULT_TAGLINE;
	let hue = DEFAULT_HUE;
	try {
		const published = await readSetting<Record<string, unknown>>(
			db,
			KEY_PUBLISHED,
		);
		const site = (published?.site ?? {}) as Record<string, unknown>;
		if (typeof site.title === "string" && site.title.trim()) {
			name = site.title.trim();
		}
		if (typeof site.subtitle === "string" && site.subtitle.trim()) {
			tagline = site.subtitle.trim();
		}
		const theme = (site.themeColor ?? {}) as Record<string, unknown>;
		if (typeof theme.hue === "number" && Number.isFinite(theme.hue)) {
			hue = theme.hue;
		}
	} catch {
		// 读不到就用默认，发信比配色重要
	}

	cached = { at: Date.now(), name, tagline, hue };
	return cached;
}

export async function resolveBrand(
	db: D1Database,
	originHint: string,
): Promise<MailBrand> {
	const basics = await brandBasics(db);
	return { ...basics, url: originHint.replace(/\/$/, "") };
}

export function escapeHtml(raw: string): string {
	return raw
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export interface MailLayout {
	/** 邮箱列表里预览的那一行，卡片里不显示 */
	preheader: string;
	/** 卡片里最大的那句：有文章就写文章名，没有就写这封信的用途 */
	heading?: string;
	/** 标题下的状态徽章 */
	badge?: { text: string; tone?: "accent" | "muted" | "warn" };
	/** 正文 HTML，用下面几个构件拼 */
	body: string;
	/** 页脚一句补充说明 */
	footNote?: string;
}

export function renderMail(
	brand: MailBrand,
	theme: MailTheme,
	layout: MailLayout,
): string {
	const badge = layout.badge
		? `<p style="margin:${layout.heading ? "10px" : "0"} 0 0;">${badgeHtml(
				theme,
				layout.badge.text,
				layout.badge.tone ?? "accent",
			)}</p>`
		: "";
	const heading = layout.heading
		? `<p style="margin:0;font-size:20px;font-weight:700;line-height:1.5;color:${theme.ink};">${escapeHtml(layout.heading)}</p>`
		: "";

	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(layout.preheader)}</title>
<style>
@media only screen and (max-width:600px){
.yb-pad{padding-left:20px!important;padding-right:20px!important}
.yb-wrap{padding:16px 8px!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${theme.pageBg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${theme.pageBg}">${escapeHtml(layout.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:${theme.pageBg};">
<tr>
<td align="center" class="yb-wrap" style="padding:32px 12px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background:${theme.cardBg};border:1px solid ${theme.line};border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,30,0.05);">
<tr>
<td style="height:3px;background:${theme.accent};font-size:0;line-height:0;">&nbsp;</td>
</tr>
<tr>
<td class="yb-pad" style="padding:22px 30px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="font-family:${FONT};font-size:15px;font-weight:700;color:${theme.ink};letter-spacing:0.2px;">
<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${theme.accent};vertical-align:middle;margin-right:7px;"></span>${escapeHtml(brand.name)}</td>
<td align="right" style="font-family:${FONT};font-size:12px;color:${theme.inkFaint};">${escapeHtml(brand.tagline)}</td>
</tr>
</table>
</td>
</tr>
<tr>
<td class="yb-pad" style="padding:20px 30px 0;font-family:${FONT};font-size:15px;line-height:1.75;color:${theme.ink};">
${heading}
${badge}
</td>
</tr>
<tr>
<td class="yb-pad" style="padding:14px 30px 26px;font-family:${FONT};font-size:15px;line-height:1.75;color:${theme.ink};">
${layout.body}
</td>
</tr>
<tr>
<td class="yb-pad" style="padding:16px 30px 20px;border-top:1px solid ${theme.line};background:${theme.tint};">
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.7;color:${theme.inkFaint};">
${layout.footNote ? `${layout.footNote}<br>` : ""}这封邮件由 ${escapeHtml(brand.name)} 自动发出，不用回复。<br>
<a href="${escapeHtml(brand.url)}" style="color:${theme.accentDeep};text-decoration:none;">${escapeHtml(brand.url.replace(/^https?:\/\//, ""))}</a>
</p>
</td>
</tr>
</table>

<p style="margin:14px 0 0;font-family:${FONT};font-size:11px;color:${theme.inkFaint};">如果按钮点不开，可以把邮件里的链接复制到浏览器。</p>

</td>
</tr>
</table>
</body>
</html>`;
}

export function paragraph(theme: MailTheme, html: string): string {
	return `<p style="margin:0 0 14px;color:${theme.ink};">${html}</p>`;
}

/** 作者 · 分类 · 字数 这一行 */
export function metaLine(theme: MailTheme, text: string): string {
	if (!text.trim()) return "";
	return `<p style="margin:0 0 18px;font-size:13px;color:${theme.inkFaint};">${escapeHtml(text)}</p>`;
}

/** 引用块上方的小标签，字号压得比正文小，别跟标题抢 */
export function sectionLabel(theme: MailTheme, text: string): string {
	return `<p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.4px;color:${theme.inkFaint};">${escapeHtml(text)}</p>`;
}

export function quoteBlock(theme: MailTheme, text: string): string {
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 18px;">
<tr>
<td style="padding:12px 16px;background:${theme.tint};border-left:3px solid ${theme.accent};border-radius:0 8px 8px 0;font-size:14px;line-height:1.75;color:${theme.inkSoft};white-space:pre-wrap;">${escapeHtml(text)}</td>
</tr>
</table>`;
}

export function primaryButton(
	theme: MailTheme,
	link: string,
	label: string,
): string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:22px 0 18px;">
<tr>
<td style="background:${theme.accent};border-radius:10px;">
<a href="${escapeHtml(link)}" style="display:inline-block;padding:11px 24px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
</td>
</tr>
</table>`;
}

export function linkLine(theme: MailTheme, link: string): string {
	return `<p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:${theme.inkFaint};word-break:break-all;">按钮打不开就复制这个地址：<br><a href="${escapeHtml(link)}" style="color:${theme.accentDeep};text-decoration:none;">${escapeHtml(link)}</a></p>`;
}

export function hintText(theme: MailTheme, text: string): string {
	return `<p style="margin:0 0 10px;font-size:13px;color:${theme.inkFaint};">${text}</p>`;
}

export function divider(theme: MailTheme): string {
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:20px 0;">
<tr><td style="height:1px;background:${theme.line};font-size:0;line-height:0;">&nbsp;</td></tr>
</table>`;
}

function badgeHtml(
	theme: MailTheme,
	text: string,
	tone: "accent" | "muted" | "warn",
): string {
	const palette = {
		accent: {
			bg: theme.accentSoft,
			fg: theme.accentDeep,
			line: theme.tintLine,
		},
		muted: { bg: "#f1f3f5", fg: theme.inkSoft, line: "#e3e7ea" },
		warn: { bg: "#fdf3e3", fg: "#8a5209", line: "#f2ddbb" },
	}[tone];
	return `<span style="display:inline-block;padding:3px 11px;border-radius:999px;border:1px solid ${palette.line};background:${palette.bg};color:${palette.fg};font-size:12px;font-weight:600;letter-spacing:0.2px;">${escapeHtml(text)}</span>`;
}

/** 键值表：测试邮件里列通道、发件人这些 */
export function factTable(
	theme: MailTheme,
	rows: Array<[string, string]>,
): string {
	const body = rows
		.map(
			([key, value], index) => `<tr>
<td style="padding:8px 0;${index > 0 ? `border-top:1px solid ${theme.line};` : ""}font-size:13px;color:${theme.inkFaint};width:88px;vertical-align:top;">${escapeHtml(key)}</td>
<td style="padding:8px 0;${index > 0 ? `border-top:1px solid ${theme.line};` : ""}font-size:13px;color:${theme.ink};word-break:break-all;">${escapeHtml(value)}</td>
</tr>`,
		)
		.join("");
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:4px 0 18px;">${body}</table>`;
}

/** 需要提醒但不算错误的一句，用暖色块托住。语义色不跟主题走，免得撞上同色系主题时失去警示。 */
export function warnBlock(html: string): string {
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px;">
<tr>
<td style="padding:12px 16px;background:#fdf6ec;border-left:3px solid #d9a441;border-radius:0 8px 8px 0;font-size:13px;line-height:1.7;color:#7c5209;">${html}</td>
</tr>
</table>`;
}

export function inlineCode(theme: MailTheme, text: string): string {
	return `<code style="padding:1px 5px;border-radius:4px;background:${theme.tint};border:1px solid ${theme.tintLine};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:${theme.accentDeep};">${escapeHtml(text)}</code>`;
}

export { FONT };
