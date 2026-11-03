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

/**
 * 登录名：3–20 位小写字母、数字、下划线，必须字母或数字开头。
 * 一律转小写后存储与比较，避免 Alice / alice 变成两个账号。
 * 保留字用于以后可能出现的路径或功能位（/admin、/support 之类）。
 */
const ACCOUNT_RE = /^[a-z0-9][a-z0-9_]{2,19}$/;
const RESERVED_ACCOUNTS = new Set([
	"admin",
	"administrator",
	"root",
	"system",
	"support",
	"moderator",
	"reviewer",
	"yuki",
	"yukiho",
]);

export function normalizeAccount(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const account = raw.trim().toLowerCase();
	if (!ACCOUNT_RE.test(account)) return null;
	if (RESERVED_ACCOUNTS.has(account)) return null;
	return account;
}

export interface PasswordPolicyResult {
	ok: boolean;
	value?: string;
	message?: string;
}

/**
 * 密码策略：NFC 归一后 8–128 个码点，至少一个字母 + 一个数字。
 * 不 trim——首尾空格是合法字符，trim 掉会让用户下次登录失败。
 */
export function checkPasswordPolicy(raw: unknown): PasswordPolicyResult {
	if (typeof raw !== "string") {
		return { ok: false, message: "密码格式不正确" };
	}
	if (raw.length > 512) {
		return { ok: false, message: "密码过长" };
	}
	const value = raw.normalize("NFC");
	const length = [...value].length;
	if (length < 8 || length > 128) {
		return { ok: false, message: "密码长度需在 8–128 位之间" };
	}
	if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
		return { ok: false, message: "密码至少要包含一个字母和一个数字" };
	}
	return { ok: true, value };
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
