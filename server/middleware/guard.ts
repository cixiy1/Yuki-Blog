import type { MiddlewareHandler } from "hono";

/** 认证相关的响应一律不缓存；媒体直出是例外，它按 id 内容寻址，可以长缓存 */
export const noStore: MiddlewareHandler = async (c, next) => {
	await next();
	if (c.req.method === "GET" && c.req.path.startsWith("/api/media/")) return;
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
export const sameOriginGuard: MiddlewareHandler = async (c, next) => {
	// 现代浏览器会给跨站请求带上这个头，比 Origin 更难伪造（页面脚本改不了）
	if (c.req.header("sec-fetch-site") === "cross-site") {
		return c.json(
			{ error: "cross_origin_blocked", message: "跨站请求被拒绝" },
			403,
		);
	}

	const origin = c.req.header("origin");
	if (origin !== undefined) {
		const self = new URL(c.req.url).origin;
		if (origin !== self) {
			return c.json(
				{ error: "cross_origin_blocked", message: "跨站请求被拒绝" },
				403,
			);
		}
	}
	await next();
};
