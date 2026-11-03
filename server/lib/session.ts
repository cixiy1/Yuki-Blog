import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hmacSha256Hex, randomToken, timingSafeEqualHex } from "./crypto";

/**
 * 无状态签名会话：cookie 里放 base64url(JSON) + "." + HMAC-SHA256。
 *
 * 载荷刻意只放 uid 与 session_epoch：
 *  - 放 role → 降权后旧票仍是管理员
 *  - 放 status → 封禁不生效
 *  - 放 email/display_name → 改名后展示不同步
 * 展示字段与权限一律每请求查库（loadSession 里那一条 SELECT）。
 */
export const SESSION_PAYLOAD_VERSION: number = 1;

/** HTTPS 下用 __Host- 前缀：强制 Secure + Path=/ + 无 Domain，子域无法覆盖 */
export const SESSION_COOKIE_SECURE: string = "__Host-yb_session";
export const SESSION_COOKIE: string = "yb_session";

/** 不勾「记住我」：票 12 小时 + 会话 cookie */
export const SESSION_TTL_SECONDS: number = 12 * 60 * 60;
/** 勾「记住我」：票 30 天 + 持久 cookie */
export const SESSION_TTL_REMEMBER_SECONDS: number = 30 * 24 * 60 * 60;

const CLOCK_SKEW_SECONDS = 60;

export interface SessionPayload {
	v: number;
	/** users.uid */
	u: number;
	/** 签发时的 users.session_epoch */
	e: number;
	/** 随机数，避免同一秒两次登录产生相同 cookie */
	n: string;
	/** 签发时间（unix 秒） */
	t: number;
	/** 过期时间（unix 秒） */
	x: number;
}

export function isHttpsUrl(url: string): boolean {
	return new URL(url).protocol === "https:";
}

export function sessionCookieName(url: string): string {
	return isHttpsUrl(url) ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
}

/** 读出 cookie 原文：两个名字都认，迁移期与本地 http 都能用 */
export function readSessionCookie(c: Context): string | null {
	return (
		getCookie(c, SESSION_COOKIE_SECURE) ?? getCookie(c, SESSION_COOKIE) ?? null
	);
}

export async function signSession(
	secret: string,
	payload: SessionPayload,
): Promise<string> {
	const encoded = btoa(JSON.stringify(payload))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	const signature = await hmacSha256Hex(secret, encoded);
	return `${encoded}.${signature}`;
}

export async function verifySession(
	secret: string,
	value: string,
	nowSeconds: number,
): Promise<SessionPayload | null> {
	const dot = value.lastIndexOf(".");
	if (dot <= 0) return null;

	const encoded = value.slice(0, dot);
	const signature = value.slice(dot + 1);
	const expected = await hmacSha256Hex(secret, encoded);
	if (!timingSafeEqualHex(expected, signature)) return null;

	let payload: SessionPayload;
	try {
		const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
		payload = JSON.parse(json) as SessionPayload;
	} catch {
		return null;
	}

	if (payload?.v !== SESSION_PAYLOAD_VERSION) return null;
	if (!Number.isInteger(payload.u) || payload.u <= 0) return null;
	if (!Number.isInteger(payload.e) || payload.e < 0) return null;
	if (typeof payload.n !== "string" || payload.n.length === 0) return null;
	if (!Number.isFinite(payload.t) || !Number.isFinite(payload.x)) return null;
	if (payload.x <= nowSeconds) return null;
	if (payload.t > nowSeconds + CLOCK_SKEW_SECONDS) return null;
	return payload;
}

export async function issueSession(
	secret: string,
	uid: number,
	epoch: number,
	ttlSeconds: number,
	nowSeconds: number,
): Promise<string> {
	return await signSession(secret, {
		v: SESSION_PAYLOAD_VERSION,
		u: uid,
		e: epoch,
		n: randomToken(4),
		t: nowSeconds,
		x: nowSeconds + ttlSeconds,
	});
}

export function setSessionCookie(
	c: Context,
	url: string,
	token: string,
	ttlSeconds: number,
	persist: boolean,
): void {
	setCookie(c, sessionCookieName(url), token, {
		path: "/",
		httpOnly: true,
		secure: isHttpsUrl(url),
		sameSite: "Lax",
		// 不勾记住我时不下发 Max-Age，浏览器关闭即失效
		...(persist ? { maxAge: ttlSeconds } : {}),
	});
}

/** 登出：两个名字都删，避免旧版 cookie 残留 */
export function clearSessionCookie(c: Context, url: string): void {
	const secure = isHttpsUrl(url);
	// __Host- 前缀强制要求 Secure，hono 的序列化器在 http 下会直接抛错，
	// 所以只在 https 请求里删它；http 下本来也不会种下这个名字。
	if (secure) {
		deleteCookie(c, SESSION_COOKIE_SECURE, { path: "/", secure: true });
	}
	deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
