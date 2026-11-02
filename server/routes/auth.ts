import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomDigits, sha256Hex, timingSafeEqualHex } from "../lib/crypto";
import { debugAuthEnabled, sendLoginCode } from "../lib/mail";
import { checkSendQuota } from "../lib/ratelimit";
import {
	createSessionToken,
	revokeSession,
	SESSION_COOKIE,
	SESSION_TTL_DAYS,
} from "../lib/session";
import { utcToIso } from "../lib/time";
import { clientIp, isLoginCode, normalizeEmail } from "../lib/validate";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

const CODE_TTL_SECONDS = 600;
const RESEND_AFTER_SECONDS = 60;
const MAX_CODE_ATTEMPTS = 5;
const MAX_UID_RETRY = 3;

interface CodeRow {
	id: number;
	code_hash: string;
	attempts: number;
}

interface UserRow {
	id: number;
	uid: number;
	email: string;
	role: string;
	status: string;
	email_verified: number;
	display_name: string;
	avatar_url: string | null;
}

export const auth: Hono<AppEnv> = new Hono<AppEnv>();

function randomUid(): number {
	return 100_000 + (Number.parseInt(randomDigits(6), 10) % 900_000);
}

function displayNameFromEmail(email: string): string {
	const local = email.split("@")[0] ?? "user";
	return local.slice(0, 40) || "user";
}

function isHttps(url: string): boolean {
	return new URL(url).protocol === "https:";
}

async function readJsonBody(
	c: Context<AppEnv>,
): Promise<Record<string, unknown> | null> {
	try {
		const body = await c.req.json();
		if (body && typeof body === "object" && !Array.isArray(body)) {
			return body as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

/** 发码 */
auth.post("/email-code", sameOriginGuard, requireJsonBody, async (c) => {
	const pepper = c.env.AUTH_PEPPER;
	if (!pepper) {
		return c.json(
			{ error: "server_misconfigured", message: "AUTH_PEPPER 未配置" },
			500,
		);
	}

	const body = await readJsonBody(c);
	const email = normalizeEmail(body?.email);
	if (!email) {
		return c.json(
			{ error: "invalid_email", message: "邮箱格式不正确", field: "email" },
			400,
		);
	}

	const ipHash = await sha256Hex(`${clientIp(c.req.raw)}|${pepper}`);
	const quota = await checkSendQuota(c.env.DB, email, ipHash);
	if (!quota.allowed) {
		c.header("Retry-After", String(quota.retryAfter ?? RESEND_AFTER_SECONDS));
		return c.json(
			{
				error: "rate_limited",
				scope: quota.scope,
				retry_after: quota.retryAfter,
			},
			429,
		);
	}

	const code = randomDigits(6);
	const codeHash = await sha256Hex(`${code}|${email}|login|${pepper}`);

	// 同一个邮箱的旧码立即作废，避免用户手里躺着两个都能用的码
	await c.env.DB.batch([
		c.env.DB.prepare(
			`UPDATE email_codes SET consumed_at = datetime('now')
			  WHERE email = ?1 AND purpose = 'login' AND consumed_at IS NULL`,
		).bind(email),
		c.env.DB.prepare(
			`INSERT INTO email_codes (email, code_hash, purpose, expires_at, ip_hash)
			 VALUES (?1, ?2, 'login', datetime('now', '+10 minutes'), ?3)`,
		).bind(email, codeHash, ipHash),
	]);

	const sent = await sendLoginCode(c.env, email, code);
	if (!sent.ok) {
		console.error(
			`[auth] 发信失败 ${email} status=${sent.providerStatus ?? "network"}`,
		);
		return c.json(
			{
				error: "mail_failed",
				message: "验证码邮件发送失败，请稍后再试",
				provider_status: sent.providerStatus,
			},
			502,
		);
	}

	const payload: Record<string, unknown> = {
		ok: true,
		expires_in: CODE_TTL_SECONDS,
		resend_after: RESEND_AFTER_SECONDS,
	};
	if (debugAuthEnabled(c.env, c.req.url)) {
		payload.debug_code = code;
	}
	return c.json(payload);
});

/** 验证码换会话；邮箱首次出现即注册 */
auth.post("/verify", sameOriginGuard, requireJsonBody, async (c) => {
	const pepper = c.env.AUTH_PEPPER;
	if (!pepper) {
		return c.json(
			{ error: "server_misconfigured", message: "AUTH_PEPPER 未配置" },
			500,
		);
	}

	const body = await readJsonBody(c);
	const email = normalizeEmail(body?.email);
	if (!email) {
		return c.json(
			{ error: "invalid_email", message: "邮箱格式不正确", field: "email" },
			400,
		);
	}
	if (!isLoginCode(body?.code)) {
		return c.json(
			{
				error: "invalid_code_format",
				message: "验证码为 6 位数字",
				field: "code",
			},
			400,
		);
	}
	const code = body.code;

	const [codeResult, userResult] = await c.env.DB.batch([
		c.env.DB.prepare(
			`SELECT id, code_hash, attempts FROM email_codes
			  WHERE email = ?1 AND purpose = 'login'
			    AND consumed_at IS NULL AND expires_at > datetime('now')
			  ORDER BY id DESC LIMIT 1`,
		).bind(email),
		c.env.DB.prepare(
			`SELECT id, uid, email, role, status, email_verified, display_name, avatar_url
			   FROM users WHERE email = ?1`,
		).bind(email),
	]);

	const codeRow = codeResult.results?.[0] as CodeRow | undefined;
	if (!codeRow) {
		return c.json(
			{ error: "code_invalid", message: "验证码无效或已过期" },
			400,
		);
	}
	if (codeRow.attempts >= MAX_CODE_ATTEMPTS) {
		return c.json(
			{
				error: "too_many_attempts",
				message: "尝试次数过多，请重新获取验证码",
				retry_after: 600,
			},
			429,
		);
	}

	const expected = await sha256Hex(`${code}|${email}|login|${pepper}`);
	if (!timingSafeEqualHex(expected, codeRow.code_hash)) {
		const attempts = codeRow.attempts + 1;
		const exhausted = attempts >= MAX_CODE_ATTEMPTS;
		await c.env.DB.prepare(
			`UPDATE email_codes
			    SET attempts = ?2,
			        consumed_at = CASE WHEN ?3 = 1 THEN datetime('now') ELSE consumed_at END
			  WHERE id = ?1`,
		)
			.bind(codeRow.id, attempts, exhausted ? 1 : 0)
			.run();
		if (exhausted) {
			return c.json(
				{
					error: "too_many_attempts",
					message: "尝试次数过多，请重新获取验证码",
					retry_after: 600,
				},
				429,
			);
		}
		return c.json(
			{
				error: "code_mismatch",
				message: "验证码错误",
				remaining: MAX_CODE_ATTEMPTS - attempts,
			},
			400,
		);
	}

	const existing = userResult.results?.[0] as UserRow | undefined;
	if (existing && existing.status !== "active") {
		return c.json({ error: "account_suspended", message: "账号已被停用" }, 403);
	}

	const { token, tokenHash } = await createSessionToken();
	const ipHash = await sha256Hex(`${clientIp(c.req.raw)}|${pepper}`);
	const userAgent = (c.req.header("user-agent") ?? "").slice(0, 200);
	const displayName = existing
		? existing.display_name
		: displayNameFromEmail(email);

	let uid = existing ? existing.uid : randomUid();
	let completed = false;
	let lastError: unknown = null;

	for (let attempt = 0; attempt < MAX_UID_RETRY && !completed; attempt++) {
		try {
			const results = await c.env.DB.batch([
				c.env.DB.prepare(
					`UPDATE email_codes SET consumed_at = datetime('now')
					  WHERE id = ?1 AND consumed_at IS NULL`,
				).bind(codeRow.id),
				c.env.DB.prepare(
					`INSERT INTO users (uid, email, email_verified, display_name, last_login_at)
					 VALUES (?1, ?2, 1, ?3, datetime('now'))
					 ON CONFLICT(email) DO UPDATE SET
					   last_login_at = datetime('now'),
					   updated_at = datetime('now')`,
				).bind(uid, email, displayName),
				c.env.DB.prepare(
					`INSERT INTO sessions (token_hash, user_id, expires_at, ip_hash, user_agent)
					 SELECT ?1, id, datetime('now', '+30 days'), ?2, ?3
					   FROM users WHERE email = ?4`,
				).bind(tokenHash, ipHash, userAgent, email),
				c.env.DB.prepare(
					`DELETE FROM sessions WHERE expires_at < datetime('now')`,
				),
				c.env.DB.prepare(
					`DELETE FROM email_codes
					  WHERE created_at < datetime('now', '-2 days')
					     OR (consumed_at IS NOT NULL AND created_at < datetime('now', '-1 day'))`,
				),
			]);

			const consumed = results[0]?.meta?.changes ?? 0;
			if (consumed === 0) {
				// 并发下已被另一个请求消费掉
				return c.json(
					{ error: "code_invalid", message: "验证码无效或已过期" },
					400,
				);
			}
			completed = true;
		} catch (error) {
			lastError = error;
			if (existing) break;
			// 新用户撞了 uid 唯一索引：batch 是事务，consume 一起回滚，换 uid 重试是安全的
			uid = randomUid();
		}
	}

	if (!completed) {
		console.error("[auth] 创建会话失败", lastError);
		return c.json(
			{ error: "internal_error", message: "登录失败，请重试" },
			500,
		);
	}

	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		secure: isHttps(c.req.url),
		sameSite: "Lax",
		path: "/",
		maxAge: SESSION_TTL_DAYS * 86_400,
	});

	return c.json({
		ok: true,
		user: {
			uid: existing ? existing.uid : uid,
			email: existing ? existing.email : email,
			role: existing ? existing.role : "user",
			display_name: displayName,
			avatar_url: existing ? existing.avatar_url : null,
		},
		session: {
			expires_at: new Date(
				Date.now() + SESSION_TTL_DAYS * 86_400_000,
			).toISOString(),
		},
	});
});

/** 当前登录态；未登录也返回 200 语义之外的东西，所以状态码用 401，body 保留 authenticated:false 方便前端判断 */
auth.get("/me", (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json(
			{ authenticated: false, error: "unauthorized", message: "未登录" },
			401,
		);
	}
	if (user.status !== "active") {
		return c.json({ authenticated: false, error: "account_suspended" }, 403);
	}
	return c.json({
		authenticated: true,
		user: {
			uid: user.uid,
			email: user.email,
			role: user.role,
			display_name: user.display_name,
			avatar_url: user.avatar_url,
			email_verified: user.email_verified,
		},
		session: { expires_at: utcToIso(user.expires_at) },
	});
});

/** 注销；没带 cookie 也返回 200，不给探测面 */
auth.post("/logout", sameOriginGuard, async (c) => {
	const token = getCookie(c, SESSION_COOKIE);
	if (token) {
		await revokeSession(c.env.DB, await sha256Hex(token));
	}
	deleteCookie(c, SESSION_COOKIE, {
		path: "/",
		httpOnly: true,
		sameSite: "Lax",
		secure: isHttps(c.req.url),
	});
	return c.json({ ok: true });
});
