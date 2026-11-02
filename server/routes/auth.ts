import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomDigits, sha256Hex, timingSafeEqualHex } from "../lib/crypto";
import {
	buildAuthorizeUrl,
	buildState,
	exchangeCode,
	fetchGithubProfile,
	fetchVerifiedEmail,
	OAUTH_STATE_COOKIE,
	OAUTH_STATE_TTL_SECONDS,
	pickDisplayName,
	verifyState,
} from "../lib/github";
import { debugAuthEnabled, sendLoginCode } from "../lib/mail";
import { checkSendQuota } from "../lib/ratelimit";
import {
	createSessionToken,
	revokeSession,
	SESSION_COOKIE,
	SESSION_TTL_DAYS,
} from "../lib/session";
import { utcToIso } from "../lib/time";
import {
	clientIp,
	isLoginCode,
	normalizeEmail,
	sanitizeNext,
} from "../lib/validate";
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

/** GitHub OAuth 跳转；没配 client id 时明确 503，不让人以为按钮坏了 */
auth.get("/github/start", async (c) => {
	const clientId = c.env.GITHUB_CLIENT_ID;
	const pepper = c.env.AUTH_PEPPER;
	if (!clientId || !pepper) {
		return c.json(
			{ error: "github_not_configured", message: "GitHub 登录尚未配置" },
			503,
		);
	}

	const origin = new URL(c.req.url).origin;
	const state = await buildState(pepper, sanitizeNext(c.req.query("next")));
	setCookie(c, OAUTH_STATE_COOKIE, state, {
		httpOnly: true,
		secure: isHttps(c.req.url),
		sameSite: "Lax",
		path: "/",
		maxAge: OAUTH_STATE_TTL_SECONDS,
	});
	return c.redirect(
		buildAuthorizeUrl(clientId, `${origin}/api/auth/github/callback`, state),
		302,
	);
});

/** OAuth 回调：失败一律 302 回登录页带 error，浏览器流程不返回 JSON */
auth.get("/github/callback", async (c) => {
	const origin = new URL(c.req.url).origin;
	const stateCookieOptions = {
		path: "/",
		httpOnly: true,
		sameSite: "Lax" as const,
		secure: isHttps(c.req.url),
	};
	const fail = (reason: string): Response => {
		deleteCookie(c, OAUTH_STATE_COOKIE, stateCookieOptions);
		return c.redirect(
			`${origin}/login?error=${encodeURIComponent(reason)}`,
			302,
		);
	};

	const clientId = c.env.GITHUB_CLIENT_ID;
	const clientSecret = c.env.GITHUB_CLIENT_SECRET;
	const pepper = c.env.AUTH_PEPPER;
	if (!clientId || !clientSecret || !pepper)
		return fail("github_not_configured");

	const denied = c.req.query("error");
	if (denied)
		return fail(denied === "access_denied" ? "github_denied" : "github_error");

	const code = c.req.query("code");
	const state = c.req.query("state");
	if (!code || !state) return fail("state_invalid");

	// 先比 cookie：防攻击者把自己的 code 塞给受害者（登录 CSRF / 账号嫁接）
	const cookieState = getCookie(c, OAUTH_STATE_COOKIE);
	if (!cookieState || !timingSafeEqualHex(cookieState, state))
		return fail("state_invalid");

	const payload = await verifyState(pepper, state, OAUTH_STATE_TTL_SECONDS);
	if (!payload) return fail("state_invalid");

	const accessToken = await exchangeCode(
		clientId,
		clientSecret,
		code,
		`${origin}/api/auth/github/callback`,
	);
	if (!accessToken) return fail("exchange_failed");

	const profile = await fetchGithubProfile(accessToken);
	if (!profile) return fail("profile_failed");

	const providerUid = String(profile.id);
	const bound = await c.env.DB.prepare(
		`SELECT u.id, u.uid, u.email, u.role, u.status, u.email_verified,
		        u.display_name, u.avatar_url
		   FROM oauth_accounts o
		   JOIN users u ON u.id = o.user_id
		  WHERE o.provider = 'github' AND o.provider_uid = ?1`,
	)
		.bind(providerUid)
		.first<UserRow>();

	if (bound && bound.status !== "active") return fail("account_suspended");

	let existing: UserRow | null = bound;
	let email = bound?.email ?? "";

	if (!bound) {
		const verifiedEmail = normalizeEmail(await fetchVerifiedEmail(accessToken));
		// users.email NOT NULL，拿不到已核验邮箱就不建号
		if (!verifiedEmail) return fail("email_unverified");
		email = verifiedEmail;
		existing = await c.env.DB.prepare(
			`SELECT id, uid, email, role, status, email_verified, display_name, avatar_url
			   FROM users WHERE email = ?1`,
		)
			.bind(email)
			.first<UserRow>();
		if (existing && existing.status !== "active")
			return fail("account_suspended");
	}

	const { token, tokenHash } = await createSessionToken();
	const ipHash = await sha256Hex(`${clientIp(c.req.raw)}|${pepper}`);
	const userAgent = (c.req.header("user-agent") ?? "").slice(0, 200);
	const displayName = existing
		? existing.display_name
		: pickDisplayName(profile);
	const avatarUrl = existing?.avatar_url ?? profile.avatar_url ?? null;

	let uid = existing ? existing.uid : randomUid();
	let completed = false;
	let lastError: unknown = null;

	for (let attempt = 0; attempt < MAX_UID_RETRY && !completed; attempt++) {
		try {
			await c.env.DB.batch([
				c.env.DB.prepare(
					`INSERT INTO users (uid, email, email_verified, display_name, avatar_url, last_login_at)
					 VALUES (?1, ?2, 1, ?3, ?4, datetime('now'))
					 ON CONFLICT(email) DO UPDATE SET
					   last_login_at = datetime('now'),
					   updated_at = datetime('now'),
					   avatar_url = COALESCE(users.avatar_url, excluded.avatar_url)`,
				).bind(uid, email, displayName, avatarUrl),
				c.env.DB.prepare(
					`INSERT INTO oauth_accounts (provider, provider_uid, user_id)
					 SELECT 'github', ?1, id FROM users WHERE email = ?2
					 ON CONFLICT DO NOTHING`,
				).bind(providerUid, email),
				c.env.DB.prepare(
					`INSERT INTO sessions (token_hash, user_id, expires_at, ip_hash, user_agent)
					 SELECT ?1, id, datetime('now', '+30 days'), ?2, ?3
					   FROM users WHERE email = ?4`,
				).bind(tokenHash, ipHash, userAgent, email),
				c.env.DB.prepare(
					`DELETE FROM sessions WHERE expires_at < datetime('now')`,
				),
			]);
			completed = true;
		} catch (error) {
			lastError = error;
			if (existing) break;
			uid = randomUid();
		}
	}

	if (!completed) {
		console.error("[auth] GitHub 登录建会话失败", lastError);
		return fail("login_failed");
	}

	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		secure: isHttps(c.req.url),
		sameSite: "Lax",
		path: "/",
		maxAge: SESSION_TTL_DAYS * 86_400,
	});
	deleteCookie(c, OAUTH_STATE_COOKIE, stateCookieOptions);
	return c.redirect(`${origin}${sanitizeNext(payload.next)}`, 302);
});
