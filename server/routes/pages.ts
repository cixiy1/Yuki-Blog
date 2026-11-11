import { Hono } from "hono";
import {
	canReadPost,
	readProtectedPosts,
} from "../lib/protected-posts";
import { resolveSessionUser } from "../middleware/auth";
import type { AppEnv } from "../types";

/**
 * 文章页的访问控制。
 *
 * 文章 HTML 是构建期产物，静态资源服务没法知道「谁在请求」。所以 `/posts/*`
 * 提到 `run_worker_first`，先过这里：命中受限清单才查会话，公开文章直接放行，
 * 一次 D1 都不打。
 *
 * 放行时返回真实页面，但必须带 `private, no-store`——同一份 HTML 对不同的人
 * 有不同的可读性，一旦被 CDN 或浏览器共享缓存存下来，权限就失效了。
 *
 * 拒绝时统一回站内 404：不区分「未登录」和「登录但不在名单里」，避免通过
 * 状态码差异确认某篇文章存在。
 */
export const pages: Hono<AppEnv> = new Hono<AppEnv>();

const POST_PREFIX = "/posts/";

/** 从 `/posts/<slug>/` 取出 slug；取不到就返回 null，交给静态资源处理 */
function slugOf(pathname: string): string | null {
	if (!pathname.startsWith(POST_PREFIX)) return null;

	let rest = pathname.slice(POST_PREFIX.length);
	if (rest.endsWith("/index.html")) rest = rest.slice(0, -"index.html".length);
	if (rest.endsWith("/")) rest = rest.slice(0, -1);
	if (!rest || rest.includes("..")) return null;

	try {
		return decodeURIComponent(rest);
	} catch {
		// 非法百分号编码：当作公开资源，静态服务自己会回 404
		return null;
	}
}

/**
 * 站内 404 页。
 *
 * 用构建产物里的 `404.html` 而不是现拼一段 HTML：导航、主题、页脚都跟着站点
 * 走，访客不会突然掉进一个白底黑字的孤岛。文件缺失时退化成一句话，至少状态
 * 码是对的。
 */
async function notFoundPage(env: Env): Promise<Response> {
	const headers = new Headers({
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
	});

	try {
		const res = await env.ASSETS.fetch(
			new URL("https://assets.local/404.html"),
		);
		if (res.ok) {
			return new Response(await res.text(), { status: 404, headers });
		}
	} catch {
		// 落到下面的兜底
	}

	return new Response("<!doctype html><title>404</title><h1>404</h1>", {
		status: 404,
		headers,
	});
}

pages.on(["GET", "HEAD"], "/posts/*", async (c) => {
	const slug = slugOf(new URL(c.req.url).pathname);
	if (!slug) return c.env.ASSETS.fetch(c.req.raw);

	const guards = await readProtectedPosts(c.env.ASSETS);
	const guard = guards.get(slug);

	// 公开文章占绝大多数：清单里没有就直接转发，不碰会话也不碰数据库
	if (!guard) return c.env.ASSETS.fetch(c.req.raw);

	const user = await resolveSessionUser(c);
	if (!canReadPost(user, guard)) return notFoundPage(c.env);

	const served = await c.env.ASSETS.fetch(c.req.raw);
	const headers = new Headers(served.headers);
	headers.set("cache-control", "private, no-store");
	headers.set("vary", "Cookie");
	return new Response(c.req.method === "HEAD" ? null : served.body, {
		status: served.status,
		headers,
	});
});
