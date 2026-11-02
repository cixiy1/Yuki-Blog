/**
 * 认证页共用的浏览器端小工具。
 *
 * ⚠️ ACCOUNT_RE / 密码策略与 server/lib/validate.ts 是两份实现，
 * 改规则时两边都要改（这里只做即时提示，服务端才是权威）。
 * 不要把 server/ 的东西 import 进来，那会把服务端代码打进浏览器包。
 */
export const ACCOUNT_RE: RegExp = /^[a-z0-9][a-z0-9_]{2,19}$/;
export const PASSWORD_MIN: number = 8;

export interface ApiResult<T> {
	ok: boolean;
	status: number;
	data: T;
	/** 请求根本没到服务端：断网、进程没起、被拦 */
	unreachable?: boolean;
	/** 到了服务端但拿不到 JSON：404 页面、网关 501/502 */
	malformed?: boolean;
}

export async function request<T>(
	path: string,
	init: RequestInit = {},
): Promise<ApiResult<T>> {
	let res: Response;
	try {
		res = await fetch(path, { credentials: "same-origin", ...init });
	} catch {
		// 连接被拒 / DNS 失败 / 断网，均在 fetch 这一层抛出
		return { ok: false, status: 0, data: {} as T, unreachable: true };
	}

	let data = {} as T;
	let malformed = false;
	try {
		data = (await res.json()) as T;
	} catch {
		// 成功响应允许没有 body（例如 204），只有失败时才算异常
		malformed = !res.ok;
	}
	return { ok: res.ok, status: res.status, data, malformed };
}

export function postJson<T>(
	path: string,
	body: unknown,
): Promise<ApiResult<T>> {
	return request<T>(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/**
 * 把「后端根本没响应」和「账号密码不对」分开。
 * 否则服务没起时页面会显示「账号或密码不正确」，把人往错误的方向带。
 *
 * 本地还会多给一句指路的：静态服务器（python http.server、纯 dist 预览）
 * 上根本没有 /api，这类 5xx 与「密码错了」是两回事。
 */
export function failureText(
	r: Pick<ApiResult<unknown>, "status" | "unreachable" | "malformed">,
): string {
	const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
	if (r.unreachable) {
		return isLocal
			? "连不上本地接口：先跑 pnpm worker:dev，再用 8787 打开"
			: "连不上服务器，请检查网络后重试";
	}
	if (isLocal) {
		return `本地接口返回 ${r.status}：这个端口没有 /api，改用 8787`;
	}
	return `服务返回异常（HTTP ${r.status}），请稍后重试`;
}

/** 只放行站内绝对路径，与服务端 sanitizeNext 的口径一致 */
export function readNext(): string | null {
	const next = new URLSearchParams(location.search).get("next");
	if (!next || !/^\/(?!\/)/.test(next)) return null;
	return next;
}

/** 只读 token，不动地址栏（重置密码页刷新后还能接着填） */
export function readToken(): string {
	return new URLSearchParams(location.search).get("token") ?? "";
}

/** 从 query 取 token 并立刻从地址栏抹掉，避免留在历史记录与 referrer 里 */
export function readTokenAndClean(): string {
	const params = new URLSearchParams(location.search);
	const token = params.get("token") ?? "";
	if (token) {
		params.delete("token");
		const query = params.toString();
		const clean = location.pathname + (query ? `?${query}` : "");
		history.replaceState(null, "", clean);
	}
	return token;
}

/**
 * 写反馈条。空文本即隐藏——不靠固定高度占位，卡片不会有那条永远空着的行。
 */
export function say(
	el: HTMLElement | null,
	text: string,
	state: "" | "ok" | "error",
): void {
	if (!el) return;
	el.textContent = text;
	if (state) el.dataset.state = state;
	else delete el.dataset.state;
	el.hidden = text.trim() === "";
}

/**
 * 按钮忙碌态：转圈 + 换文案 + 禁用，复位时原样还回去。
 * 文案存在 dataset 里，重复调用不会把「登录中…」当成原始文案存下来。
 */
export function setBusy(
	btn: HTMLButtonElement | null,
	busy: boolean,
	label = "处理中…",
): void {
	if (!btn) return;
	if (busy) {
		if (!btn.dataset.idleLabel) {
			btn.dataset.idleLabel = btn.textContent?.trim() ?? "";
		}
		btn.dataset.busy = "1";
		btn.disabled = true;
		btn.classList.add("auth-busy");
		btn.textContent = label;
		return;
	}
	delete btn.dataset.busy;
	btn.disabled = false;
	btn.classList.remove("auth-busy");
	const idle = btn.dataset.idleLabel;
	if (idle !== undefined) {
		btn.textContent = idle;
		delete btn.dataset.idleLabel;
	}
}

export function passwordHint(password: string): string | null {
	if (password.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
	if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
		return "密码要同时含字母和数字";
	}
	return null;
}
