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
