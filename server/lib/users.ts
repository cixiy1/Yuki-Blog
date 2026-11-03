import { randomDigits } from "./crypto";

/**
 * users 表的一行，字段与 0005 迁移一致。
 * 注意 password_enc 只允许出现在登录与改密路径里，绝不进 API 响应。
 */
export interface UserRow {
	id: number;
	uid: number;
	account: string;
	email: string;
	email_verified_at: string | null;
	role: string;
	status: string;
	display_name: string;
	avatar_url: string | null;
	bio: string | null;
	password_enc: string | null;
	password_updated_at: string | null;
	session_epoch: number;
	last_login_at: string | null;
	created_at: string;
	updated_at: string;
}

/** 显式列白名单：任何 SELECT * 都可能把 password_enc 带进日志或响应 */
export const USER_COLUMNS =
	"id, uid, account, email, email_verified_at, role, status, display_name, avatar_url, bio, password_enc, password_updated_at, session_epoch, last_login_at, created_at, updated_at";

export function randomUid(): number {
	return 100_000 + (Number.parseInt(randomDigits(6), 10) % 900_000);
}

export async function findByUid(
	db: D1Database,
	uid: number,
): Promise<UserRow | null> {
	return await db
		.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE uid = ?1`)
		.bind(uid)
		.first<UserRow>();
}

export async function findByEmail(
	db: D1Database,
	email: string,
): Promise<UserRow | null> {
	return await db
		.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?1`)
		.bind(email)
		.first<UserRow>();
}

export async function findByAccount(
	db: D1Database,
	account: string,
): Promise<UserRow | null> {
	return await db
		.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE account = ?1`)
		.bind(account)
		.first<UserRow>();
}

/** 登录用：账号或邮箱都认。含 @ 一律按邮箱处理（账号名不允许 @） */
export async function findByIdentifier(
	db: D1Database,
	identifier: string,
): Promise<UserRow | null> {
	if (identifier.includes("@")) return await findByEmail(db, identifier);
	return await findByAccount(db, identifier);
}

/** 对外暴露的最小用户信息，API 契约与前端沿用下划线命名 */
export function publicUser(row: UserRow): Record<string, unknown> {
	return {
		uid: row.uid,
		account: row.account,
		email: row.email,
		role: row.role,
		status: row.status,
		display_name: row.display_name,
		avatar_url: row.avatar_url,
		email_verified: row.email_verified_at ? 1 : 0,
	};
}

/** 会话中间件用：比 publicUser 多几个内部字段，仍然不含 password_enc */
export interface SessionUser {
	uid: number;
	account: string;
	email: string;
	role: string;
	status: string;
	email_verified: number;
	display_name: string;
	avatar_url: string | null;
	session_epoch: number;
}

export function toSessionUser(row: UserRow): SessionUser {
	return {
		uid: row.uid,
		account: row.account,
		email: row.email,
		role: row.role,
		status: row.status,
		email_verified: row.email_verified_at ? 1 : 0,
		display_name: row.display_name,
		avatar_url: row.avatar_url,
		session_epoch: row.session_epoch,
	};
}
