const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 254;

/**
 * 邮箱是全站唯一的账号标识，必须只经这里归一化后入库与查询。
 * SQLite 的唯一索引区分大小写，不归一会把 A@x.com 与 a@x.com 变成两个账号。
 */
export function normalizeEmail(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const email = raw.trim().toLowerCase();
	if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
	if (!EMAIL_RE.test(email)) return null;
	return email;
}

/** 6 位数字，允许前导零 */
export function isLoginCode(raw: unknown): raw is string {
	return typeof raw === "string" && /^\d{6}$/.test(raw);
}

export function clientIp(request: Request): string {
	const forwarded = request.headers.get("cf-connecting-ip");
	if (forwarded) return forwarded.trim();
	const real = request.headers.get("x-real-ip");
	if (real) return real.trim();
	return "local";
}

/**
 * 只放行站内相对路径。`//evil.com`、`/\evil.com`、带协议的都要挡掉，
 * 否则登录后的跳转就是一个开放重定向。
 */
export function sanitizeNext(raw: unknown): string {
	if (typeof raw !== "string") return "/";
	if (raw.length === 0 || raw.length > 200) return "/";
	if (!raw.startsWith("/")) return "/";
	if (raw.startsWith("//")) return "/";
	if (raw.includes("\\")) return "/";
	if (raw.includes(":")) return "/";
	if (raw === "/api" || raw.startsWith("/api/")) return "/";
	return raw;
}

/**
 * 文章 slug：小写字母数字与连字符，2–60 位，首尾不能是连字符。
 * 这是站内唯一允许的地址写法——中文标题靠它转成可读英文地址，
 * 不做拼音转换，交给作者自己定。
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

export function isValidSlug(raw: unknown): raw is string {
	return typeof raw === "string" && SLUG_RE.test(raw);
}

/** 标签去重、去空、限 10 个、单个 24 字以内；传 null 表示格式非法 */
export function normalizeTags(raw: unknown): string[] | null {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) return null;
	const seen = new Set<string>();
	const tags: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string") return null;
		const tag = item.trim();
		if (tag.length === 0) continue;
		if (tag.length > 24) return null;
		if (seen.has(tag)) continue;
		seen.add(tag);
		tags.push(tag);
		if (tags.length > 10) return null;
	}
	return tags;
}
