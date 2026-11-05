import type { MiddlewareHandler } from "hono";

/** 认证相关的响应一律不缓存；媒体直出与站点配置自检例外，它们按内容寻址或允许短缓存 */
export const noStore: MiddlewareHandler = async (c, next) => {
	await next();
	if (c.req.method === "GET" && c.req.path.startsWith("/api/media/")) return;
	if (c.req.method === "GET" && c.req.path === "/api/site-config") return;
	c.header("Cache-Control", "no-store");
};

/**
 * 写操作只收 JSON。
 * 用 `-d` 但没带 content-type 的请求会被判成表单，直接 415，
 * 比让 Hono 把 body 解析成空对象、再报一个莫名其妙的校验错要好定位。
 */
export const requireJsonBody: MiddlewareHandler = async (c, next) => {
	const contentType = c.req.header("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return c.json(
			{
				error: "unsupported_media_type",
				message: "请求体必须是 application/json",
			},
			415,
		);
	}
	await next();
};

/**
 * CSRF 防护。
 *
 * 不用 Hono 自带的 csrf()：它只拦表单类 content-type，JSON 请求直接放过，
 * 而本站的写接口全是 JSON。
 *
 * 规则：请求带 Origin 就必须同源；不带则放行。
 * 浏览器发起的跨站 POST 一定会带 Origin，curl / 服务端调用不带，
 * 这样既挡住跨站表单与 fetch，又不影响命令行验收。
 */
/**
 * 本地工作台（知流）的源。
 *
 * 工作台把管理端嵌在 iframe 里，顶层是 http://127.0.0.1:<port> / http://localhost:<port>，
 * 从那儿发起的请求对本站是跨站：`Sec-Fetch-Site: cross-site`，`Origin` 是回环地址。
 * 不认这个源，登录接口自己就先被这张守门规则挡成 403 —— 改 cookie 也没用。
 *
 * 只认回环地址：外部站点伪造不出这个 Origin（Origin 由浏览器写死，页面脚本改不了）；
 * 能在用户自己机器上跑起页面的人，权限已经高过 CSRF 能拿到的东西。
 */
function isLocalWorkbench(origin: string | undefined): boolean {
	if (!origin) return false;
	try {
		const url = new URL(origin);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		return (
			url.hostname === "127.0.0.1" ||
			url.hostname === "localhost" ||
			url.hostname === "[::1]"
		);
	} catch {
		return false;
	}
}

export const sameOriginGuard: MiddlewareHandler = async (c, next) => {
	const origin = c.req.header("origin");
	const self = new URL(c.req.url).origin;
	const trusted =
		origin !== undefined && (origin === self || isLocalWorkbench(origin));

	// 现代浏览器会给跨站请求带上这个头，比 Origin 更难伪造（页面脚本改不了）。
	// 本地工作台是唯一例外：它嵌 iframe，天生就是 cross-site
	if (!trusted && c.req.header("sec-fetch-site") === "cross-site") {
		return c.json(
			{ error: "cross_origin_blocked", message: "跨站请求被拒绝" },
			403,
		);
	}

	if (origin !== undefined && !trusted) {
		return c.json(
			{ error: "cross_origin_blocked", message: "跨站请求被拒绝" },
			403,
		);
	}
	await next();
};
