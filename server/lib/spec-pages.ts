/**
 * 站点单页：`src/content/spec` 下的关于我、友链、留言板。
 *
 * 这些内容没有 D1 记录，也不出现在文章列表里，只能绕过草稿链路直接改仓库文件。
 * 保存一次就是一次 commit，Cloudflare 构建完即上线，没有预览环境。
 */
import {
	joinMarkdown,
	readScalar,
	setField,
	splitMarkdown,
} from "./frontmatter";
import { putRepoFile } from "./github-contents";

const API = "https://api.github.com";
const REPO = "cixiy1/Yuki-blog";
const BRANCH = "main";
const DIR = "src/content/spec";

/** 只允许这一层的 .md / .mdx，挡住目录穿越和任意路径 */
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|mdx)$/;

export function isSpecFile(file: string): boolean {
	return FILE_RE.test(file) && !file.includes("..");
}

export interface SpecPageSummary {
	file: string;
	title: string;
}

export interface SpecPageDetail extends SpecPageSummary {
	description: string;
	/** 原来有没有 frontmatter：有才回写 title/description，没有就别凭空加一段 */
	hasFrontmatter: boolean;
	body: string;
}

export type SpecResult<T> =
	| { ok: true; value: T }
	| { ok: false; status: number; message: string };

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

/** 正文里的第一个一级标题，about.md 这种没有 frontmatter 的文件靠它取标题 */
function firstHeading(body: string): string {
	const match = /^#\s+(.+)$/m.exec(body);
	return match ? match[1].trim() : "";
}

function describe(file: string, content: string): SpecPageDetail {
	const { frontmatter, body } = splitMarkdown(content);
	const title =
		readScalar(frontmatter, "title") ||
		firstHeading(body) ||
		file.replace(/\.mdx?$/i, "");
	return {
		file,
		title,
		description: readScalar(frontmatter, "description"),
		hasFrontmatter: frontmatter.length > 0,
		body,
	};
}

async function readSpecFile(
	file: string,
	token: string,
): Promise<SpecResult<{ content: string; sha: string }>> {
	if (!isSpecFile(file)) {
		return { ok: false, status: 400, message: "文件名不合法" };
	}
	const res = await fetch(
		`${API}/repos/${REPO}/contents/${DIR}/${file}?ref=${encodeURIComponent(BRANCH)}`,
		{ headers: headers(token) },
	);
	if (!res.ok) {
		return { ok: false, status: res.status, message: explain(res.status) };
	}
	const data = (await res.json()) as { content?: string; sha?: string };
	return {
		ok: true,
		value: {
			content: data.content ? fromBase64(data.content) : "",
			sha: data.sha ?? "",
		},
	};
}

export async function listSpecPages(
	token: string,
): Promise<SpecResult<SpecPageSummary[]>> {
	const res = await fetch(
		`${API}/repos/${REPO}/contents/${DIR}?ref=${encodeURIComponent(BRANCH)}`,
		{ headers: headers(token) },
	);
	if (!res.ok) {
		return { ok: false, status: res.status, message: explain(res.status) };
	}

	const list = (await res.json()) as unknown;
	if (!Array.isArray(list)) {
		return {
			ok: false,
			status: 502,
			message: "读取目录失败：GitHub 返回了非预期内容",
		};
	}
	const files = (list as Array<{ name?: string; type?: string }>)
		.filter(
			(item) => item.type === "file" && item.name && isSpecFile(item.name),
		)
		.map((item) => item.name as string);

	// 标题得看内容：并发读一遍，目录里目前只有三份文件
	const pages = await Promise.all(
		files.map(async (file) => {
			const read = await readSpecFile(file, token);
			const title = read.ok
				? describe(file, read.value.content).title
				: file.replace(/\.mdx?$/i, "");
			return { file, title };
		}),
	);
	return { ok: true, value: pages };
}

export async function readSpecPage(
	file: string,
	token: string,
): Promise<SpecResult<SpecPageDetail>> {
	const read = await readSpecFile(file, token);
	if (!read.ok) return read;
	return { ok: true, value: describe(file, read.value.content) };
}

export async function saveSpecPage(input: {
	file: string;
	title: string;
	description: string;
	body: string;
	token: string;
}): Promise<SpecResult<{ sha: string }>> {
	const current = await readSpecFile(input.file, input.token);
	if (!current.ok) return current;

	const { frontmatter, body: oldBody } = splitMarkdown(current.value.content);
	let next = frontmatter;
	if (next) {
		// 只有原本就带 frontmatter 的文件才回写标题与描述
		if (input.title) next = setField(next, "title", input.title);
		next = setField(next, "description", input.description || null);
	}

	const body = input.body || oldBody;
	const content = next ? joinMarkdown(next, body) : body;
	const written = await putRepoFile({
		repo: REPO,
		path: `${DIR}/${input.file}`,
		branch: BRANCH,
		content,
		message: `chore(spec): 更新《${input.title || input.file}》`,
		token: input.token,
	});
	if (!written.ok) {
		return {
			ok: false,
			status: written.status === 409 ? 409 : 502,
			message: written.message ?? "写入失败",
		};
	}
	return { ok: true, value: { sha: written.sha ?? "" } };
}
