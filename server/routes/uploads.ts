import { Hono } from "hono";
import { MEDIA_BRANCH, MEDIA_REPO } from "../lib/media-store";
import type { AppEnv } from "../types";

/**
 * 刚上传的图先兜一层。
 *
 * 上传是往仓库里提交，静态资源要等那次构建（1–2 分钟）才出现在 `dist/`。
 * 这段时间里站内地址是 404：正文插图、媒体库缩略图、封面预览全是裂图，
 * 用户以为「上传没成功」。所以这里在静态资源缺失时回源到 GitHub raw，
 * 构建完成后 `ASSETS` 命中，这段代码自然不再执行。
 *
 * 代价：`/assets/uploads/*` 要走一次 Worker（`wrangler.jsonc` 的
 * `run_worker_first`）。只覆盖上传目录，正文里其它静态资源不受影响。
 */
export const uploads: Hono<AppEnv> = new Hono<AppEnv>();

const EXT_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	avif: "image/avif",
	svg: "image/svg+xml",
	ico: "image/x-icon",
};

/** 只认上传目录下的普通文件路径，挡住 `..` 和奇怪字符 */
function repoPathOf(pathname: string): string | null {
	if (!pathname.startsWith("/assets/uploads/")) return null;
	const rest = pathname.slice("/assets/uploads/".length);
	if (rest.length === 0 || rest.includes("..")) return null;
	if (!/^[A-Za-z0-9._/-]+$/.test(rest)) return null;
	return `public/assets/uploads/${rest}`;
}

uploads.on(["GET", "HEAD"], "/assets/uploads/*", async (c) => {
	const served = await c.env.ASSETS.fetch(c.req.raw);
	if (served.status !== 404) return served;

	const repoPath = repoPathOf(new URL(c.req.url).pathname);
	if (!repoPath) return served;

	const raw = await fetch(
		`https://raw.githubusercontent.com/${MEDIA_REPO}/${MEDIA_BRANCH}/${repoPath}`,
		{ method: c.req.method === "HEAD" ? "HEAD" : "GET" },
	);
	if (!raw.ok) return served;

	const ext = repoPath.slice(repoPath.lastIndexOf(".") + 1).toLowerCase();
	const headers = new Headers();
	headers.set("content-type", EXT_MIME[ext] ?? "application/octet-stream");
	// 短缓存：构建完成后浏览器很快会再拿到真正的静态文件
	headers.set("cache-control", "public, max-age=15");
	headers.set("x-yb-fallback", "raw");
	const length = raw.headers.get("content-length");
	if (length) headers.set("content-length", length);

	return new Response(c.req.method === "HEAD" ? null : raw.body, {
		status: 200,
		headers,
	});
});
