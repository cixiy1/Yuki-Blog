import { randomToken, sha256Hex } from "./crypto";

/**
 * 一次性 token：只存 sha256，明文只在邮件链接里出现一次。
 * 消费一律用「UPDATE ... WHERE used_at IS NULL AND expires_at > now RETURNING」
 * 单语句原子完成，不需要事务（D1 也没有交互式事务）。
 */
export const EMAIL_TOKEN_TTL_MINUTES: number = 24 * 60;
export const RESET_TOKEN_TTL_MINUTES: number = 60;

interface TokenRow {
	user_id: number;
}

export async function issueEmailToken(
	db: D1Database,
	userId: number,
	email: string,
): Promise<string> {
	const token = randomToken(32);
	await db
		.prepare(
			`INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at)
			 VALUES (?1, ?2, ?3, datetime('now', ?4))`,
		)
		.bind(
			userId,
			email,
			await sha256Hex(token),
			`+${EMAIL_TOKEN_TTL_MINUTES} minutes`,
		)
		.run();
	return token;
}

export async function consumeEmailToken(
	db: D1Database,
	rawToken: string,
): Promise<{ userId: number; email: string } | null> {
	const row = await db
		.prepare(
			`UPDATE email_verification_tokens
			    SET used_at = datetime('now')
			  WHERE token_hash = ?1
			    AND used_at IS NULL
			    AND expires_at > datetime('now')
			 RETURNING user_id, email`,
		)
		.bind(await sha256Hex(rawToken))
		.first<TokenRow & { email: string }>();
	return row ? { userId: row.user_id, email: row.email } : null;
}

export async function issueResetToken(
	db: D1Database,
	userId: number,
	email: string,
	ipHash: string | null,
): Promise<string> {
	const token = randomToken(32);
	await db
		.prepare(
			`INSERT INTO password_reset_tokens (user_id, email, token_hash, expires_at, request_ip_hash)
			 VALUES (?1, ?2, ?3, datetime('now', ?4), ?5)`,
		)
		.bind(
			userId,
			email,
			await sha256Hex(token),
			`+${RESET_TOKEN_TTL_MINUTES} minutes`,
			ipHash,
		)
		.run();
	return token;
}

export async function consumeResetToken(
	db: D1Database,
	rawToken: string,
): Promise<{ userId: number; email: string } | null> {
	const row = await db
		.prepare(
			`UPDATE password_reset_tokens
			    SET used_at = datetime('now')
			  WHERE token_hash = ?1
			    AND used_at IS NULL
			    AND expires_at > datetime('now')
			 RETURNING user_id, email`,
		)
		.bind(await sha256Hex(rawToken))
		.first<TokenRow & { email: string }>();
	return row ? { userId: row.user_id, email: row.email } : null;
}

/** 作废某人所有未用的同类 token（重发验证、重置密码成功之后用） */
export async function revokeTokens(
	db: D1Database,
	table: "email_verification_tokens" | "password_reset_tokens",
	userId: number,
): Promise<void> {
	await db
		.prepare(
			`UPDATE ${table} SET used_at = datetime('now')
			  WHERE user_id = ?1 AND used_at IS NULL`,
		)
		.bind(userId)
		.run();
}
