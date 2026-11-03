/**
 * 直接读写仓库里的文章文件（GitHub Contents API）。
 *
 * 管理端的草稿链路是「D1 → 审核 → 写仓库」，而仓库里已有的文章从来没有 D1 记录。
 * 要让它们也能在管理端编辑，只能绕过 D1 直接改文件：读出来给编辑器，
 * 保存时整份写回去。写成功即触发 Cloudflare 构建，所以这条路径没有「草稿」概念，
 * 点保存就是上线。
 */
import { putRepoFile } from "./github-contents";

const API = "https://api.github.com";
const REPO = "cixiy1/Yuki-blog";
const BRANCH = "main";
const POSTS_PREFIX = "src/content/posts/";

/** 只允许改文章目录下的文件，挡住 `..` 和任意路径 */
export function isPostPath(path: string): boolean {
	return path.startsWith(POSTS_PREFIX) && !path.includes("..");
}

/**
 * 文章里 `./images/a.webp` 这类相对路径是 Astro 的资产引用，构建时会被换成
 * `/_astro/xxx.hash.webp`，原路径在站点上根本不存在。编辑器要做预览只能用仓库的
 * 原始文件，这里给出它所在目录的 raw 前缀。
 */
export function repoRawBase(filePath: string): string {
	const dir = filePath.slice(0, filePath.lastIndexOf("/") + 1);
	return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${dir}`;
}

export interface RepoFile {
	ok: boolean;
	status: number;
	content?: string;
	sha?: string;
	message?: string;
}

function headers(token: string): Record<string, string> {
	return {
		accept: "application/vnd.github+json",
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
		"user-agent": "yuki-blog-admin",
		"x-github-api-version": "2022-11-28",
	};
}

function explain(status: number): string {
	if (status === 401) return "GitHub 令牌无效或已过期";
	if (status === 403) return "令牌没有 Contents 写权限";
	if (status === 404) return "仓库里找不到这个文件，或令牌看不到该仓库";
	return `GitHub 返回 ${status}`;
}

function fromBase64(text: string): string {
	const binary = atob(text.replace(/\s/g, ""));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

export async function readRepoFile(
	path: string,
	token: string,
): Promise<RepoFile> {
	if (!isPostPath(path)) return { ok: false, status: 400, message: "路径不合法" };

	const res = await fetch(
		`${API}/repos/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`,
		{ headers: headers(token) },
	);
	if (!res.ok) {
		return { ok: false, status: res.status, message: explain(res.status) };
	}

	const data = (await res.json()) as { content?: string; sha?: string };
	return {
		ok: true,
		status: 200,
		content: data.content ? fromBase64(data.content) : "",
		sha: data.sha,
	};
}

export async function writeRepoFile(
	path: string,
	content: string,
	token: string,
	message: string,
): Promise<RepoFile> {
	if (!isPostPath(path)) return { ok: false, status: 400, message: "路径不合法" };
	const result = await putRepoFile({
		repo: REPO,
		path,
		branch: BRANCH,
		content,
		message,
		token,
	});
	return {
		ok: result.ok,
		status: result.status,
		sha: result.sha,
		message: result.message,
	};
}

export async function deleteRepoFile(	path: string,
	token: string,
	sha: string,
	message: string,
): Promise<RepoFile> {
	if (!isPostPath(path)) return { ok: false, status: 400, message: "路径不合法" };

	const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
		method: "DELETE",
		headers: headers(token),
		body: JSON.stringify({ message, sha, branch: BRANCH }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		const detail = text.slice(0, 200);
		return {
			ok: false,
			status: res.status,
			message: detail ? `${explain(res.status)}：${detail}` : explain(res.status),
		};
	}
	const data = (await res.json()) as { commit?: { sha?: string } };
	return { ok: true, status: 200, sha: data.commit?.sha };
}
