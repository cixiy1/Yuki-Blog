/**
 * 站点对外地址只有一个来源，别在每个路由里各推一遍。
 *
 * 踩过的坑：访客从 http://yiyu14.top 进来（没有强制跳转、旧链接、
 * 手敲域名都可能），`new URL(request.url).origin` 会拼出
 * `http://yiyu14.top/api/auth/github/callback`，而 GitHub 只登记了 https 那条，
 * 于是报 redirect_uri is not associated with this application——
 * 页面上的回调地址看着明明是对的，所以特别难查。
 *
 * 规则：env.SITE_ORIGIN 优先；否则按请求推导，非本地主机一律按 https 算。
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

function isLocalHost(hostname: string): boolean {
	return LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

/** 只有本地开发允许 http，其余一律按 https 算 */
function schemeIsHttps(request: Request): boolean {
	const url = new URL(request.url);
	if (url.protocol === "https:") return true;
	return !isLocalHost(url.hostname);
}

/** 对外地址，不带结尾斜杠，形如 https://yiyu14.top */
export function publicOrigin(request: Request, configured?: string): string {
	if (configured?.startsWith("http")) return configured.replace(/\/$/, "");
	const host = new URL(request.url).host;
	return `${schemeIsHttps(request) ? "https:" : "http:"}//${host}`;
}

/** 只拿到链接、拿不到请求时用（发信、审计日志里的地址） */
export function normalizeOrigin(
	link: string,
	fallback = "https://yiyu14.top",
): string {
	try {
		const url = new URL(link);
		const scheme = isLocalHost(url.hostname) ? url.protocol : "https:";
		return `${scheme}//${url.host}`;
	} catch {
		return fallback;
	}
}
