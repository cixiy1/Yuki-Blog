import {
	fromBase64Url,
	hmacSha256Hex,
	randomToken,
	timingSafeEqualHex,
	toBase64Url,
} from "./crypto";
import { unixSeconds } from "./time";

export const OAUTH_STATE_COOKIE: string = "yb_oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 600;

export interface GithubStatePayload {
	n: string;
	t: number;
	next: string;
}

export interface GithubProfile {
	id: number;
	login: string;
	name: string | null;
	avatar_url: string | null;
}

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";

function commonHeaders(accessToken?: string): Record<string, string> {
	const headers: Record<string, string> = {
		accept: "application/vnd.github+json",
		"user-agent": "yuki-blog",
	};
	if (accessToken) headers.authorization = `Bearer ${accessToken}`;
	return headers;
}

/**
 * state = base64url(payload) + "." + HMAC(payload)。
 * 不带服务端存储，靠三件事防伪：HMAC 完整性、时间戳 600 秒窗口、
 * 以及同时下发到 cookie 的同一份值（防登录 CSRF / 账号嫁接）。
 */
export async function buildState(
	pepper: string,
	next: string,
): Promise<string> {
	const payload: GithubStatePayload = {
		n: randomToken(8),
		t: unixSeconds(),
		next,
	};
	const encoded = toBase64Url(JSON.stringify(payload));
	const signature = await hmacSha256Hex(pepper, encoded);
	return `${encoded}.${signature}`;
}

export async function verifyState(
	pepper: string,
	state: string,
	maxAgeSeconds: number,
): Promise<GithubStatePayload | null> {
	const dotIndex = state.lastIndexOf(".");
	if (dotIndex <= 0) return null;
	const encoded = state.slice(0, dotIndex);
	const signature = state.slice(dotIndex + 1);
	const expected = await hmacSha256Hex(pepper, encoded);
	if (!timingSafeEqualHex(expected, signature)) return null;

	let payload: GithubStatePayload;
	try {
		payload = JSON.parse(fromBase64Url(encoded)) as GithubStatePayload;
	} catch {
		return null;
	}
	if (typeof payload?.t !== "number" || typeof payload?.next !== "string")
		return null;
	if (Math.abs(unixSeconds() - payload.t) > maxAgeSeconds) return null;
	return payload;
}

export function buildAuthorizeUrl(
	clientId: string,
	redirectUri: string,
	state: string,
): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: "read:user user:email",
		state,
		allow_signup: "true",
	});
	return `${GITHUB_AUTHORIZE}?${params.toString()}`;
}

export async function exchangeCode(
	clientId: string,
	clientSecret: string,
	code: string,
	redirectUri: string,
): Promise<string | null> {
	try {
		const response = await fetch(GITHUB_TOKEN, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				client_id: clientId,
				client_secret: clientSecret,
				code,
				redirect_uri: redirectUri,
			}),
			signal: AbortSignal.timeout(8000),
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { access_token?: unknown };
		return typeof data.access_token === "string" && data.access_token.length > 0
			? data.access_token
			: null;
	} catch (error) {
		console.error("[github] 换取 token 失败", error);
		return null;
	}
}

export async function fetchGithubProfile(
	accessToken: string,
): Promise<GithubProfile | null> {
	try {
		const response = await fetch(`${GITHUB_API}/user`, {
			headers: commonHeaders(accessToken),
			signal: AbortSignal.timeout(8000),
		});
		if (!response.ok) return null;
		const data = (await response.json()) as Partial<GithubProfile>;
		if (typeof data.id !== "number" || typeof data.login !== "string")
			return null;
		return {
			id: data.id,
			login: data.login,
			name: typeof data.name === "string" ? data.name : null,
			avatar_url: typeof data.avatar_url === "string" ? data.avatar_url : null,
		};
	} catch (error) {
		console.error("[github] 拉取用户信息失败", error);
		return null;
	}
}

/**
 * 只认 GitHub 侧已核验的邮箱。未核验的邮箱可以被任意填写，
 * 拿它建号或绑定等于允许别人接管同邮箱的站内账号。
 */
export async function fetchVerifiedEmail(
	accessToken: string,
): Promise<string | null> {
	try {
		const response = await fetch(`${GITHUB_API}/user/emails`, {
			headers: commonHeaders(accessToken),
			signal: AbortSignal.timeout(8000),
		});
		if (!response.ok) return null;
		const list = (await response.json()) as Array<{
			email?: unknown;
			primary?: unknown;
			verified?: unknown;
		}>;
		if (!Array.isArray(list)) return null;
		const verified = list.filter(
			(item) => item.verified === true && typeof item.email === "string",
		);
		const primary = verified.find((item) => item.primary === true);
		const chosen = primary ?? verified[0];
		return typeof chosen?.email === "string" ? chosen.email : null;
	} catch (error) {
		console.error("[github] 拉取邮箱失败", error);
		return null;
	}
}

/** GitHub 的 name 可能为空，按 name → login → GitHub-<id> 依次兜底 */
export function pickDisplayName(profile: GithubProfile): string {
	const candidates = [profile.name?.trim(), profile.login.trim()];
	for (const candidate of candidates) {
		if (candidate && candidate.length > 0) return candidate.slice(0, 40);
	}
	return `GitHub-${profile.id}`.slice(0, 40);
}
