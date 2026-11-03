/**
 * 所有请求都带 cookie（同站，不需要 CORS），失败统一抛 ApiError。
 * 服务端错误体固定是 { error, message }，见 server/routes 各路由。
 */
export interface SessionUser {
	uid: number;
	account: string;
	email: string;
	role: string;
	status: string;
	email_verified: number;
	display_name: string;
	avatar_url: string | null;
}

export class ApiError extends Error {
	status: number;
	code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
	}
}

interface RequestOptions {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: unknown;
	signal?: AbortSignal;
}

async function request<T>(
	path: string,
	options: RequestOptions = {},
): Promise<T> {
	const init: RequestInit = {
		method: options.method ?? "GET",
		credentials: "include",
		headers: { accept: "application/json" },
	};
	if (options.body !== undefined) {
		init.headers = {
			...(init.headers as Record<string, string>),
			"content-type": "application/json",
		};
		init.body = JSON.stringify(options.body);
	}
	if (options.signal) init.signal = options.signal;

	const response = await fetch(path, init);
	const text = await response.text();
	let payload: unknown = null;
	if (text.length > 0) {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = null;
		}
	}

	if (!response.ok) {
		// 会话过期别让人对着「请先登录」发呆：直接回登录页，登完跳回来。
		// /api/auth/* 自己处理登录态，排除掉避免来回弹
		if (response.status === 401 && !path.startsWith("/api/auth/")) {
			const back = `${location.pathname}${location.hash}`;
			if (!location.pathname.startsWith("/login")) {
				location.replace(`/login/?next=${encodeURIComponent(back)}`);
			}
		}
		const body = (payload ?? {}) as { error?: unknown; message?: unknown };
		const code = typeof body.error === "string" ? body.error : "http_error";
		const message =
			typeof body.message === "string"
				? body.message
				: `请求失败（${response.status}）`;
		throw new ApiError(response.status, code, message);
	}

	return payload as T;
}

export const api = {
	get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
		request<T>(path, { signal }),
	post: <T>(path: string, body?: unknown): Promise<T> =>
		request<T>(path, { method: "POST", body }),
	put: <T>(path: string, body?: unknown): Promise<T> =>
		request<T>(path, { method: "PUT", body }),
	patch: <T>(path: string, body?: unknown): Promise<T> =>
		request<T>(path, { method: "PATCH", body }),
	delete: <T>(path: string): Promise<T> =>
		request<T>(path, { method: "DELETE" }),
};
