import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { writeAudit } from "../lib/audit";
import { sha256Hex, timingSafeEqualHex } from "../lib/crypto";
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
import {
	debugAuthEnabled,
	sendAccountExistsMail,
	sendEmailChangedNoticeMail,
	sendEmailChangeMail,
	sendResetMail,
	sendVerifyMail,
} from "../lib/mail";
import { publicOrigin } from "../lib/origin";
import {
	encryptPassword,
	type PasswordKeys,
	verifyPassword,
} from "../lib/password";
import { consumeRate, resetRate } from "../lib/ratelimit";
import {
	clearSessionCookie,
	isHttpsUrl,
	issueSession,
	SESSION_TTL_REMEMBER_SECONDS,
	SESSION_TTL_SECONDS,
	setSessionCookie,
} from "../lib/session";
import { readSecret } from "../lib/site-config";
import {
	consumeEmailToken,
	consumeResetToken,
	issueEmailToken,
	issueResetToken,
	revokeTokens,
} from "../lib/tokens";
import {
	findByAccount,
	findByEmail,
	findByIdentifier,
	findByRowId,
	findByUid,
	publicUser,
	randomUid,
	USER_COLUMNS,
	type UserRow,
} from "../lib/users";
import {
	checkPasswordPolicy,
	clientIp,
	normalizeAccount,
	normalizeEmail,
	sanitizeNext,
} from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

/**
 * 认证：账号/邮箱 + 密码登录，注册后邮件激活，找回密码走一次性链接。
 * 模型参考 FatFish-Study-Platform，但换掉了 Workers 撑不住的几处
 * （scrypt、进程内限流、文件配置、token 明文入库、无状态登出）。
 */
export const auth: Hono<AppEnv> = new Hono<AppEnv>();

const MAX_UID_RETRY = 5;

interface Secrets {
	pepper: string;
	session: string;
	passwordKey: string;
	passwordKeyPrev?: string;
}

function readSecrets(c: Context<AppEnv>): Secrets | null {
	const pepper = c.env.AUTH_PEPPER;
	const session = c.env.SESSION_SECRET;
	const passwordKey = c.env.PASSWORD_ENC_KEY;
	if (!pepper || !session || !passwordKey) return null;
	return {
		pepper,
		session,
		passwordKey,
		passwordKeyPrev: c.env.PASSWORD_ENC_KEY_PREV || undefined,
	};
}

function passwordKeys(secrets: Secrets): PasswordKeys {
	return { current: secrets.passwordKey, previous: secrets.passwordKeyPrev };
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function siteOrigin(c: Context<AppEnv>): string {
	return publicOrigin(c.req.raw, c.env.SITE_ORIGIN);
}

async function ipHash(c: Context<AppEnv>, pepper: string): Promise<string> {
	return await sha256Hex(`${clientIp(c.req.raw)}|${pepper}`);
}

async function subjectHash(pepper: string, value: string): Promise<string> {
	return await sha256Hex(`${value}|${pepper}`);
}

async function readJson(
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

function misconfigured(c: Context<AppEnv>): Response {
	return c.json(
		{ error: "server_misconfigured", message: "服务端密钥未配置" },
		500,
	);
}

function rateLimited(
	c: Context<AppEnv>,
	retryAfter: number,
	scope: string,
): Response {
	c.header("Retry-After", String(Math.max(1, retryAfter)));
	return c.json({ error: "rate_limited", scope, retry_after: retryAfter }, 429);
}

/** 登录成功：签票 + 下发 cookie + 记审计 */
async function completeLogin(
	c: Context<AppEnv>,
	secrets: Secrets,
	user: UserRow,
	remember: boolean,
	ip: string,
): Promise<void> {
	const ttl = remember ? SESSION_TTL_REMEMBER_SECONDS : SESSION_TTL_SECONDS;
	const token = await issueSession(
		secrets.session,
		user.uid,
		user.session_epoch,
		ttl,
		nowSeconds(),
	);
	setSessionCookie(c, c.req.url, token, ttl, remember);
	await writeAudit(c.env.DB, {
		actorUid: user.uid,
		action: "auth.login",
		target: user.account,
		detail: { method: remember ? "password_remember" : "password" },
		ipHash: ip,
	});
}

function debugLink(
	c: Context<AppEnv>,
	link: string,
): Record<string, string> | Record<string, never> {
	return debugAuthEnabled(c.env, c.req.url) ? { debug_link: link } : {};
}

/* ------------------------------ 注册 ------------------------------ */

auth.post("/register", sameOriginGuard, requireJsonBody, async (c) => {
	const secrets = readSecrets(c);
	if (!secrets) return misconfigured(c);

	const body = await readJson(c);
	const email = normalizeEmail(body?.email);
	const account = normalizeAccount(body?.account);
	const policy = checkPasswordPolicy(body?.password);

	if (!email) {
		return c.json(
			{ error: "invalid_email", message: "邮箱格式不正确", field: "email" },
			400,
		);
	}
	if (!account) {
		return c.json(
			{
				error: "invalid_account",
				message: "登录名 3–20 位，只能用小写字母、数字、下划线，且不能是保留字",
				field: "account",
			},
			400,
		);
	}
	if (!policy.ok || !policy.value) {
		return c.json(
			{
				error: "weak_password",
				message: policy.message ?? "密码不符合要求",
				field: "password",
			},
			400,
		);
	}

	const ip = await ipHash(c, secrets.pepper);
	const ipQuota = await consumeRate(
		c.env.DB,
		"register:ip",
		ip,
		5,
		3600,
		nowSeconds(),
	);
	if (!ipQuota.allowed)
		return rateLimited(c, ipQuota.retryAfter, "register:ip");

	const emailKey = await subjectHash(secrets.pepper, email);
	const emailQuota = await consumeRate(
		c.env.DB,
		"register:email",
		emailKey,
		1,
		600,
		nowSeconds(),
	);
	if (!emailQuota.allowed)
		return rateLimited(c, emailQuota.retryAfter, "register:email");

	// 登录名是公开标识，藏不住也不值得藏，冲突直接说
	const accountOwner = await findByAccount(c.env.DB, account);
	if (accountOwner) {
		return c.json(
			{
				error: "account_taken",
				message: "这个登录名被占用了",
				field: "account",
			},
			409,
		);
	}

	const origin = siteOrigin(c);
	const existing = await findByEmail(c.env.DB, email);
	if (existing) {
		// 防邮箱枚举：不建号、不改密码，只发一封「你已经有账号」的提醒
		const noticeQuota = await consumeRate(
			c.env.DB,
			"notice:email",
			emailKey,
			1,
			3600,
			nowSeconds(),
		);
		if (noticeQuota.allowed) {
			await sendAccountExistsMail(
				c.env,
				email,
				`${origin}/login/`,
				`${origin}/forgot-password/`,
			);
		}
		return c.json({ ok: true, verify_required: true }, 202);
	}

	let created: UserRow | null = null;
	let attempt = 0;
	while (attempt < MAX_UID_RETRY && !created) {
		attempt += 1;
		const currentUid = randomUid();
		// uid 参与 AAD，每次重试都要针对新 uid 重新加密
		const enc = await encryptPassword(
			secrets.passwordKey,
			currentUid,
			policy.value,
		);
		if (!enc) return misconfigured(c);
		try {
			created = await c.env.DB.prepare(
				`INSERT INTO users (uid, account, email, status, display_name, password_enc, password_updated_at)
				 VALUES (?1, ?2, ?3, 'pending', ?4, ?5, datetime('now'))
				 RETURNING id, uid, account, email, email_verified_at, role, status, display_name,
				           avatar_url, bio, password_enc, password_updated_at, session_epoch,
				           last_login_at, created_at, updated_at`,
			)
				.bind(currentUid, account, email, account, enc)
				.first<UserRow>();
		} catch (error) {
			if (attempt >= MAX_UID_RETRY) {
				console.error("[auth] 建号失败", error);
				return c.json(
					{ error: "register_failed", message: "注册失败，请重试" },
					500,
				);
			}
		}
	}

	if (!created) {
		return c.json(
			{ error: "register_failed", message: "注册失败，请重试" },
			500,
		);
	}

	const token = await issueEmailToken(c.env.DB, created.id, email);
	const link = `${origin}/verify/?token=${token}`;
	const mail = await sendVerifyMail(c.env, email, link, account);

	await writeAudit(c.env.DB, {
		actorUid: created.uid,
		action: "auth.register",
		target: account,
		detail: { method: "password", email_sent: mail.sent ? "yes" : "no" },
		ipHash: ip,
	});

	return c.json(
		{ ok: true, verify_required: true, ...debugLink(c, link) },
		202,
	);
});

/* ------------------------------ 登录 ------------------------------ */

auth.post("/login", sameOriginGuard, requireJsonBody, async (c) => {
	const secrets = readSecrets(c);
	if (!secrets) return misconfigured(c);

	const body = await readJson(c);
	const rawIdentifier =
		typeof body?.identifier === "string" ? body.identifier.trim() : "";
	const password = typeof body?.password === "string" ? body.password : "";
	const remember = body?.remember === true;

	if (!rawIdentifier || !password) {
		return c.json(
			{ error: "invalid_credentials", message: "账号或密码不正确" },
			401,
		);
	}

	const identifier = rawIdentifier.includes("@")
		? (normalizeEmail(rawIdentifier) ?? "")
		: rawIdentifier.toLowerCase();
	if (!identifier) {
		return c.json(
			{ error: "invalid_credentials", message: "账号或密码不正确" },
			401,
		);
	}

	const ip = await ipHash(c, secrets.pepper);
	const ipQuota = await consumeRate(
		c.env.DB,
		"login:ip",
		ip,
		30,
		900,
		nowSeconds(),
	);
	if (!ipQuota.allowed) return rateLimited(c, ipQuota.retryAfter, "login:ip");

	const idKey = await subjectHash(secrets.pepper, identifier);
	const idQuota = await consumeRate(
		c.env.DB,
		"login:id",
		idKey,
		10,
		900,
		nowSeconds(),
	);
	if (!idQuota.allowed) return rateLimited(c, idQuota.retryAfter, "login:id");

	const user = await findByIdentifier(c.env.DB, identifier);
	const verdict = user
		? await verifyPassword(
				passwordKeys(secrets),
				user.uid,
				user.password_enc,
				password,
			)
		: "mismatch";

	if (!user || verdict === "mismatch") {
		await writeAudit(c.env.DB, {
			actorUid: user?.uid ?? null,
			action: "auth.login_failed",
			target: identifier,
			detail: { method: "password" },
			ipHash: ip,
		});
		// 密码错 / 没这个人 / 没有本地密码，一律同一句，防枚举
		return c.json(
			{ error: "invalid_credentials", message: "账号或密码不正确" },
			401,
		);
	}

	// 密码对但状态不对：这时候可以明确告知原因
	if (user.status === "pending") {
		return c.json(
			{
				error: "email_unverified",
				message: "邮箱还没验证，先去收信",
				email: user.email,
			},
			403,
		);
	}
	if (user.status !== "active") {
		return c.json({ error: "account_disabled", message: "账号已被停用" }, 403);
	}

	if (verdict === "needs_reencrypt") {
		const reenc = await encryptPassword(
			secrets.passwordKey,
			user.uid,
			password,
		);
		if (reenc) {
			await c.env.DB.prepare(
				`UPDATE users SET password_enc = ?1, password_updated_at = datetime('now'),
				        updated_at = datetime('now')
				  WHERE uid = ?2`,
			)
				.bind(reenc, user.uid)
				.run();
		}
	}

	await c.env.DB.prepare(
		"UPDATE users SET last_login_at = datetime('now') WHERE uid = ?1",
	)
		.bind(user.uid)
		.run();

	// 正常登录不该被自己以前的失败拖累
	await resetRate(c.env.DB, "login:id", idKey, 900, nowSeconds());
	await resetRate(c.env.DB, "login:ip", ip, 900, nowSeconds());

	await completeLogin(c, secrets, user, remember, ip);
	return c.json({ ok: true, user: publicUser(user) });
});

/* ------------------------------ 会话 ------------------------------ */

auth.post("/logout", async (c) => {
	const user = c.get("user");
	if (user) {
		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "auth.logout",
			target: user.account,
		});
	}
	clearSessionCookie(c, c.req.url);
	return c.json({ ok: true });
});

auth.post("/logout-all", requireAuth, sameOriginGuard, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized" }, 401);

	await c.env.DB.prepare(
		`UPDATE users SET session_epoch = session_epoch + 1, updated_at = datetime('now')
		  WHERE uid = ?1`,
	)
		.bind(user.uid)
		.run();
	clearSessionCookie(c, c.req.url);
	await writeAudit(c.env.DB, {
		actorUid: user.uid,
		action: "auth.logout",
		target: user.account,
		detail: { method: "all_devices" },
	});
	return c.json({ ok: true });
});

auth.get("/me", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ authenticated: false, error: "unauthorized" }, 401);
	}
	if (user.status !== "active") {
		return c.json(
			{
				authenticated: false,
				error:
					user.status === "pending" ? "email_unverified" : "account_disabled",
			},
			403,
		);
	}
	return c.json({
		authenticated: true,
		user: {
			uid: user.uid,
			account: user.account,
			email: user.email,
			role: user.role,
			status: user.status,
			display_name: user.display_name,
			avatar_url: user.avatar_url,
			bio: user.bio,
			email_verified: user.email_verified,
			has_password: user.has_password,
		},
	});
});

/* ---------------------------- 邮件验证 ---------------------------- */

auth.post("/verify-email", sameOriginGuard, requireJsonBody, async (c) => {
	const secrets = readSecrets(c);
	if (!secrets) return misconfigured(c);

	const body = await readJson(c);
	const token = typeof body?.token === "string" ? body.token.trim() : "";
	if (!token) {
		return c.json({ error: "token_invalid", message: "链接无效或已过期" }, 400);
	}

	const ip = await ipHash(c, secrets.pepper);
	const quota = await consumeRate(
		c.env.DB,
		"verify:token",
		ip,
		20,
		3600,
		nowSeconds(),
	);
	if (!quota.allowed) return rateLimited(c, quota.retryAfter, "verify:token");

	const consumed = await consumeEmailToken(c.env.DB, token);
	if (!consumed) {
		return c.json({ error: "token_invalid", message: "链接无效或已过期" }, 400);
	}

	const before = await findByRowId(c.env.DB, consumed.userId);
	if (!before) {
		return c.json({ error: "token_invalid", message: "链接无效或已过期" }, 400);
	}

	/*
	 * 同一个 token 表服务两件事，靠「token 上的邮箱 vs 账号当前邮箱」分流：
	 * 相同 = 注册激活（顺带登录）；不同 = 更换邮箱确认（不动会话）。
	 */
	if (before.email !== consumed.email) {
		const target = consumed.email;
		let changed: UserRow | null = null;
		try {
			changed = await c.env.DB.prepare(
				`UPDATE users
				    SET email = ?1,
				        email_verified_at = datetime('now'),
				        updated_at = datetime('now')
				  WHERE id = ?2 AND status IN ('pending', 'active')
				 RETURNING ${USER_COLUMNS}`,
			)
				.bind(target, before.id)
				.first<UserRow>();
		} catch {
			// 唯一索引撞车：确认信发出后这个地址被别的账号换走了
			return c.json(
				{
					error: "email_taken",
					message: "这个邮箱刚被别的账号用了，去账号设置换一个",
				},
				409,
			);
		}

		if (!changed) {
			return c.json(
				{ error: "account_disabled", message: "账号已被停用" },
				403,
			);
		}

		// 旧地址收到告知信：账号若被人接管，这是他唯一能察觉的地方
		await sendEmailChangedNoticeMail(
			c.env,
			before.email,
			changed.account,
			target,
			`${siteOrigin(c)}/forgot-password/`,
		);
		await writeAudit(c.env.DB, {
			actorUid: changed.uid,
			action: "user.email.change",
			target: changed.account,
			detail: { from: before.email, to: target },
			ipHash: ip,
		});

		return c.json({
			ok: true,
			email_changed: true,
			user: publicUser(changed),
		});
	}

	const updated = await c.env.DB.prepare(
		`UPDATE users
		    SET email_verified_at = COALESCE(email_verified_at, datetime('now')),
		        status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
		        last_login_at = datetime('now'),
		        updated_at = datetime('now')
		  WHERE id = ?1 AND status IN ('pending', 'active')
		 RETURNING id, uid, account, email, email_verified_at, role, status, display_name,
		           avatar_url, bio, password_enc, password_updated_at, session_epoch,
		           last_login_at, created_at, updated_at`,
	)
		.bind(consumed.userId)
		.first<UserRow>();

	if (!updated) {
		return c.json({ error: "account_disabled", message: "账号已被停用" }, 403);
	}

	await completeLogin(c, secrets, updated, false, ip);
	await writeAudit(c.env.DB, {
		actorUid: updated.uid,
		action: "auth.verify_email",
		target: updated.account,
		ipHash: ip,
	});

	return c.json({ ok: true, user: publicUser(updated) });
});

auth.post(
	"/resend-verification",
	sameOriginGuard,
	requireJsonBody,
	async (c) => {
		const secrets = readSecrets(c);
		if (!secrets) return misconfigured(c);

		const body = await readJson(c);
		const email = normalizeEmail(body?.email);
		// 恒 202：不管有没有这个邮箱，响应都一样
		if (!email) return c.json({ ok: true }, 202);

		const emailKey = await subjectHash(secrets.pepper, email);
		const quota = await consumeRate(
			c.env.DB,
			"verify:resend",
			emailKey,
			1,
			600,
			nowSeconds(),
		);
		if (!quota.allowed)
			return rateLimited(c, quota.retryAfter, "verify:resend");

		const user = await findByEmail(c.env.DB, email);
		if (user?.status !== "pending") return c.json({ ok: true }, 202);

		await revokeTokens(c.env.DB, "email_verification_tokens", user.id);
		const token = await issueEmailToken(c.env.DB, user.id, user.email);
		const link = `${siteOrigin(c)}/verify/?token=${token}`;
		await sendVerifyMail(c.env, user.email, link, user.account);
		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "auth.resend_verification",
			target: user.account,
		});

		return c.json({ ok: true, ...debugLink(c, link) }, 202);
	},
);

/* ---------------------------- 更换邮箱 ---------------------------- */

/**
 * 换邮箱第一步：给**新**地址发确认信。
 *
 * 旧地址在确认前一直是账号邮箱，所以这里不改库；点完链接才算数
 * （见 /verify-email 的分流）。本地密码账号要再输一次当前密码——
 * 邮箱是找回密码的入口，能被一个没关的页面顺手改掉就失去意义了。
 */
auth.post(
	"/change-email",
	requireAuth,
	sameOriginGuard,
	requireJsonBody,
	async (c) => {
		const secrets = readSecrets(c);
		if (!secrets) return misconfigured(c);

		const current = c.get("user");
		if (!current) {
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);
		}

		const body = await readJson(c);
		const email = normalizeEmail(body?.email);
		if (!email) {
			return c.json(
				{ error: "invalid_email", message: "邮箱格式不正确", field: "email" },
				400,
			);
		}
		if (email === current.email) {
			return c.json(
				{ error: "same_email", message: "新邮箱和现在的邮箱一样" },
				400,
			);
		}

		// 邮箱唯一索引只能靠人话解释：不说清楚，用户只会以为按钮坏了
		const owner = await findByEmail(c.env.DB, email);
		if (owner && owner.uid !== current.uid) {
			return c.json(
				{
					error: "email_taken",
					message: "这个邮箱已经被别的账号用了",
					field: "email",
				},
				409,
			);
		}

		const ip = await ipHash(c, secrets.pepper);
		const quota = await consumeRate(
			c.env.DB,
			"email:change",
			String(current.uid),
			3,
			3600,
			nowSeconds(),
		);
		if (!quota.allowed) return rateLimited(c, quota.retryAfter, "email:change");

		const row = await findByUid(c.env.DB, current.uid);
		if (!row) {
			return c.json(
				{ error: "user_not_found", message: "账号状态异常，重新登录再试" },
				404,
			);
		}

		if (row.password_enc) {
			const password = typeof body?.password === "string" ? body.password : "";
			if (!password) {
				return c.json(
					{
						error: "password_required",
						message: "换邮箱要确认当前密码",
						field: "password",
					},
					400,
				);
			}
			const verdict = await verifyPassword(
				passwordKeys(secrets),
				row.uid,
				row.password_enc,
				password,
			);
			if (verdict === "mismatch") {
				return c.json(
					{
						error: "wrong_password",
						message: "当前密码不对",
						field: "password",
					},
					401,
				);
			}
		}

		// 一封新确认信就作废旧的那封，避免同时存在多个可用入口
		await revokeTokens(c.env.DB, "email_verification_tokens", row.id);
		const token = await issueEmailToken(c.env.DB, row.id, email);
		const link = `${siteOrigin(c)}/verify/?token=${token}`;
		const mail = await sendEmailChangeMail(
			c.env,
			email,
			link,
			row.account,
			row.email,
		);

		await writeAudit(c.env.DB, {
			actorUid: row.uid,
			action: "user.email.request",
			target: row.account,
			detail: { to: email, ok: mail.sent },
			ipHash: ip,
		});

		return c.json(
			{
				ok: true,
				pending_email: email,
				mail_sent: mail.sent,
				...debugLink(c, link),
			},
			202,
		);
	},
);

/* ---------------------------- 找回密码 ---------------------------- */

auth.post("/forgot-password", sameOriginGuard, requireJsonBody, async (c) => {
	const secrets = readSecrets(c);
	if (!secrets) return misconfigured(c);

	const body = await readJson(c);
	const email = normalizeEmail(body?.email);
	if (!email) return c.json({ ok: true }, 202);

	const emailKey = await subjectHash(secrets.pepper, email);
	const ip = await ipHash(c, secrets.pepper);
	const emailQuota = await consumeRate(
		c.env.DB,
		"reset:email",
		emailKey,
		3,
		3600,
		nowSeconds(),
	);
	if (!emailQuota.allowed)
		return rateLimited(c, emailQuota.retryAfter, "reset:email");
	const ipQuota = await consumeRate(
		c.env.DB,
		"reset:ip",
		ip,
		10,
		3600,
		nowSeconds(),
	);
	if (!ipQuota.allowed) return rateLimited(c, ipQuota.retryAfter, "reset:ip");

	const user = await findByEmail(c.env.DB, email);
	if (!user?.password_enc) return c.json({ ok: true }, 202);

	// 发新链接时作废旧链接，避免同时存在多个可用重置入口
	await revokeTokens(c.env.DB, "password_reset_tokens", user.id);
	const token = await issueResetToken(c.env.DB, user.id, user.email, ip);
	const link = `${siteOrigin(c)}/reset-password/?token=${token}`;
	await sendResetMail(c.env, user.email, link);
	await writeAudit(c.env.DB, {
		actorUid: user.uid,
		action: "auth.password_forgot",
		target: user.account,
		ipHash: ip,
	});

	return c.json({ ok: true, ...debugLink(c, link) }, 202);
});

auth.post("/reset-password", sameOriginGuard, requireJsonBody, async (c) => {
	const secrets = readSecrets(c);
	if (!secrets) return misconfigured(c);

	const body = await readJson(c);
	const token = typeof body?.token === "string" ? body.token.trim() : "";
	const policy = checkPasswordPolicy(body?.password);
	if (!token) {
		return c.json({ error: "token_invalid", message: "链接无效或已过期" }, 400);
	}
	if (!policy.ok || !policy.value) {
		return c.json(
			{
				error: "weak_password",
				message: policy.message ?? "密码不符合要求",
				field: "password",
			},
			400,
		);
	}

	const ip = await ipHash(c, secrets.pepper);
	const quota = await consumeRate(
		c.env.DB,
		"reset:token",
		ip,
		10,
		3600,
		nowSeconds(),
	);
	if (!quota.allowed) return rateLimited(c, quota.retryAfter, "reset:token");

	const consumed = await consumeResetToken(c.env.DB, token);
	if (!consumed) {
		return c.json({ error: "token_invalid", message: "链接无效或已过期" }, 400);
	}

	const user = await c.env.DB.prepare(
		"SELECT id, uid, account, email FROM users WHERE id = ?1",
	)
		.bind(consumed.userId)
		.first<{ id: number; uid: number; account: string; email: string }>();
	if (!user) {
		return c.json({ error: "token_invalid", message: "链接无效或已过期" }, 400);
	}

	const enc = await encryptPassword(
		secrets.passwordKey,
		user.uid,
		policy.value,
	);
	if (!enc) return misconfigured(c);

	// 改密同时补上邮箱验证、解除 pending，并踢掉所有旧会话
	await c.env.DB.prepare(
		`UPDATE users
		    SET password_enc = ?1,
		        password_updated_at = datetime('now'),
		        email_verified_at = COALESCE(email_verified_at, datetime('now')),
		        status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
		        session_epoch = session_epoch + 1,
		        updated_at = datetime('now')
		  WHERE uid = ?2`,
	)
		.bind(enc, user.uid)
		.run();

	await writeAudit(c.env.DB, {
		actorUid: user.uid,
		action: "auth.password_reset",
		target: user.account,
		ipHash: ip,
	});

	return c.json({ ok: true });
});

/* ---------------------------- GitHub OAuth ---------------------------- */

/**
 * OAuth 的 Client ID / Secret：管理端「集成」里填过就用数据库里的，
 * 没填才回落到环境变量。Client ID 不是秘密，但和 Secret 放一起少一处配置地方。
 */
async function githubOAuthConfig(
	c: Context<AppEnv>,
): Promise<{ clientId: string; clientSecret: string }> {
	const rootKey = c.env.PASSWORD_ENC_KEY ?? "";
	let clientId = "";
	let clientSecret = "";
	if (rootKey) {
		clientId = (await readSecret(c.env.DB, rootKey, "github_client_id")) ?? "";
		clientSecret =
			(await readSecret(c.env.DB, rootKey, "github_client_secret")) ?? "";
	}
	return {
		clientId: clientId || c.env.GITHUB_CLIENT_ID || "",
		clientSecret: clientSecret || c.env.GITHUB_CLIENT_SECRET || "",
	};
}

auth.get("/github/start", async (c) => {
	const { clientId } = await githubOAuthConfig(c);
	const pepper = c.env.AUTH_PEPPER;
	if (!clientId || !pepper) {
		// 这个地址是从登录页的按钮点进来的，回一个裸 JSON 会把人挂在半页；
		// 带上 error 参数跳回登录页，那边会把「尚未配置」显示成正常提示
		return c.redirect(
			`${siteOrigin(c)}/login/?error=${encodeURIComponent("github_not_configured")}`,
			302,
		);
	}

	const origin = siteOrigin(c);
	const state = await buildState(pepper, sanitizeNext(c.req.query("next")));
	setCookie(c, OAUTH_STATE_COOKIE, state, {
		httpOnly: true,
		secure: isHttpsUrl(c.req.url),
		sameSite: "Lax",
		path: "/",
		maxAge: OAUTH_STATE_TTL_SECONDS,
	});
	return c.redirect(
		buildAuthorizeUrl(clientId, `${origin}/api/auth/github/callback`, state),
		302,
	);
});

auth.get("/github/callback", async (c) => {
	const secrets = readSecrets(c);
	const origin = siteOrigin(c);
	const stateCookieOptions = {
		path: "/",
		httpOnly: true,
		sameSite: "Lax" as const,
		secure: isHttpsUrl(c.req.url),
	};
	const fail = (reason: string): Response => {
		deleteCookie(c, OAUTH_STATE_COOKIE, stateCookieOptions);
		return c.redirect(
			`${origin}/login/?error=${encodeURIComponent(reason)}`,
			302,
		);
	};

	if (!secrets) return fail("server_misconfigured");

	const { clientId, clientSecret } = await githubOAuthConfig(c);
	if (!clientId || !clientSecret) return fail("github_not_configured");

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

	const payload = await verifyState(
		secrets.pepper,
		state,
		OAUTH_STATE_TTL_SECONDS,
	);
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
		`SELECT u.id, u.uid, u.account, u.email, u.email_verified_at, u.role, u.status,
		        u.display_name, u.avatar_url, u.bio, u.password_enc, u.password_updated_at,
		        u.session_epoch, u.last_login_at, u.created_at, u.updated_at
		   FROM oauth_accounts o
		   JOIN users u ON u.id = o.user_id
		  WHERE o.provider = 'github' AND o.provider_uid = ?1`,
	)
		.bind(providerUid)
		.first<UserRow>();

	if (bound && bound.status === "disabled") return fail("account_disabled");
	if (bound && bound.status === "deleted") return fail("account_disabled");

	const ip = await ipHash(c, secrets.pepper);
	let user: UserRow | null = bound;

	if (!bound) {
		const verifiedEmail = normalizeEmail(await fetchVerifiedEmail(accessToken));
		// users.email 是 NOT NULL 且要能用找回密码，不拿占位邮箱凑数
		if (!verifiedEmail) return fail("email_unverified");

		const byEmail = await findByEmail(c.env.DB, verifiedEmail);
		if (
			byEmail &&
			(byEmail.status === "disabled" || byEmail.status === "deleted")
		) {
			return fail("account_disabled");
		}

		// 三级匹配的第三级：新建。邮箱已被占用时并到那个账号上（ON CONFLICT 兜住 UNIQUE）
		const displayName = byEmail?.display_name ?? pickDisplayName(profile);
		const uid = byEmail?.uid ?? randomUid();
		const inserted = await c.env.DB.prepare(
			`INSERT INTO users (uid, account, email, email_verified_at, status, display_name, avatar_url, last_login_at)
			 VALUES (?1, ?2, ?3, datetime('now'), 'active', ?4, ?5, datetime('now'))
			 ON CONFLICT(email) DO UPDATE SET
			   email_verified_at = COALESCE(users.email_verified_at, datetime('now')),
			   status = CASE WHEN users.status = 'pending' THEN 'active' ELSE users.status END,
			   last_login_at = datetime('now'),
			   updated_at = datetime('now'),
			   avatar_url = COALESCE(users.avatar_url, excluded.avatar_url)
			 RETURNING id, uid, account, email, email_verified_at, role, status, display_name,
			           avatar_url, bio, password_enc, password_updated_at, session_epoch,
			           last_login_at, created_at, updated_at`,
		)
			.bind(
				uid,
				byEmail?.account ?? `gh_${providerUid}`.slice(0, 20),
				verifiedEmail,
				displayName,
				profile.avatar_url ?? null,
			)
			.first<UserRow>();

		if (!inserted) return fail("profile_failed");
		user = inserted;

		await c.env.DB.prepare(
			`INSERT INTO oauth_accounts (provider, provider_uid, user_id)
			 SELECT 'github', ?1, id FROM users WHERE email = ?2
			 ON CONFLICT DO NOTHING`,
		)
			.bind(providerUid, verifiedEmail)
			.run();
	}

	if (!user) return fail("profile_failed");
	if (user.status === "pending") {
		const activated = await c.env.DB.prepare(
			`UPDATE users
			    SET status = 'active',
			        email_verified_at = COALESCE(email_verified_at, datetime('now')),
			        last_login_at = datetime('now'),
			        updated_at = datetime('now')
			  WHERE uid = ?1
			 RETURNING id, uid, account, email, email_verified_at, role, status, display_name,
			           avatar_url, bio, password_enc, password_updated_at, session_epoch,
			           last_login_at, created_at, updated_at`,
		)
			.bind(user.uid)
			.first<UserRow>();
		if (activated) user = activated;
	}

	deleteCookie(c, OAUTH_STATE_COOKIE, stateCookieOptions);
	await completeLogin(c, secrets, user, true, ip);
	return c.redirect(`${origin}${sanitizeNext(payload.next)}`, 302);
});

/* ------------------------ 个人资料里的改密 ------------------------ */

auth.post(
	"/password",
	requireAuth,
	sameOriginGuard,
	requireJsonBody,
	async (c) => {
		const secrets = readSecrets(c);
		if (!secrets) return misconfigured(c);

		const current = c.get("user");
		if (!current) return c.json({ error: "unauthorized" }, 401);

		const body = await readJson(c);
		const oldPassword =
			typeof body?.current_password === "string" ? body.current_password : "";
		const policy = checkPasswordPolicy(body?.password);
		if (!policy.ok || !policy.value) {
			return c.json(
				{
					error: "weak_password",
					message: policy.message ?? "密码不符合要求",
					field: "password",
				},
				400,
			);
		}

		const row = await findByUid(c.env.DB, current.uid);
		if (!row) return c.json({ error: "unauthorized" }, 401);

		if (row.password_enc) {
			const verdict = await verifyPassword(
				passwordKeys(secrets),
				row.uid,
				row.password_enc,
				oldPassword,
			);
			if (verdict === "mismatch") {
				return c.json(
					{ error: "invalid_credentials", message: "当前密码不正确" },
					400,
				);
			}
		}

		const enc = await encryptPassword(
			secrets.passwordKey,
			row.uid,
			policy.value,
		);
		if (!enc) return misconfigured(c);

		// 改密踢掉所有旧会话；当前请求重新签一张票，避免自己也被踢
		const epoch = row.session_epoch + 1;
		await c.env.DB.prepare(
			`UPDATE users
		    SET password_enc = ?1, password_updated_at = datetime('now'),
		        email_verified_at = COALESCE(email_verified_at, datetime('now')),
		        status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
		        session_epoch = ?2, updated_at = datetime('now')
		  WHERE uid = ?3`,
		)
			.bind(enc, epoch, row.uid)
			.run();

		const token = await issueSession(
			secrets.session,
			row.uid,
			epoch,
			SESSION_TTL_SECONDS,
			nowSeconds(),
		);
		setSessionCookie(c, c.req.url, token, SESSION_TTL_SECONDS, false);

		await writeAudit(c.env.DB, {
			actorUid: row.uid,
			action: "auth.password_change",
			target: row.account,
		});

		return c.json({ ok: true });
	},
);
