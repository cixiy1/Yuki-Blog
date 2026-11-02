import { randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE: string = "yb_session";
export const SESSION_TTL_DAYS: number = 30;

/** 会话里带出来的最小用户信息，够 P2 的路由与前端用 */
export interface SessionUser {
	id: number;
	uid: number;
	email: string;
	role: string;
	status: string;
	email_verified: number;
	display_name: string;
	avatar_url: string | null;
	expires_at: string;
}

export interface SessionToken {
	token: string;
	tokenHash: string;
}

/**
 * token 本身 256 bit，哈希只是让库里没有可直接使用的凭据，
 * 不需要 pepper（pepper 是给低熵的 6 位验证码用的）。
 */
export async function createSessionToken(): Promise<SessionToken> {
	const token = randomToken(32);
	return { token, tokenHash: await sha256Hex(token) };
}

export async function findSession(
	db: D1Database,
	tokenHash: string,
): Promise<SessionUser | null> {
	return await db
		.prepare(
			`SELECT u.id, u.uid, u.email, u.role, u.status, u.email_verified,
			        u.display_name, u.avatar_url, s.expires_at
			   FROM sessions s
			   JOIN users u ON u.id = s.user_id
			  WHERE s.token_hash = ?1
			    AND s.expires_at > datetime('now')`,
		)
		.bind(tokenHash)
		.first<SessionUser>();
}

export async function revokeSession(
	db: D1Database,
	tokenHash: string,
): Promise<void> {
	await db
		.prepare("DELETE FROM sessions WHERE token_hash = ?1")
		.bind(tokenHash)
		.run();
}
