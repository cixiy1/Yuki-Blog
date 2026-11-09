import { api } from "./api";

/** 站点单页（src/content/spec）：关于、友链、留言板 */
export interface SpecPageSummary {
	file: string;
	title: string;
}

export interface SpecPageDetail extends SpecPageSummary {
	description: string;
	/** 原来带不带 frontmatter：带的话标题、描述可以在这里改 */
	hasFrontmatter: boolean;
	body: string;
}

export async function listSpecPages(): Promise<SpecPageSummary[]> {
	const data = await api.get<{ pages: SpecPageSummary[] }>(
		"/api/me/spec-pages",
	);
	return data.pages ?? [];
}

export async function getSpecPage(
	file: string,
): Promise<SpecPageDetail | null> {
	const data = await api.get<{ page: SpecPageDetail }>(
		`/api/me/spec-page?file=${encodeURIComponent(file)}`,
	);
	return data.page ?? null;
}

/** 保存即写仓库并触发构建，没有草稿这一步 */
export async function saveSpecPage(input: {
	file: string;
	title: string;
	description: string;
	body: string;
}): Promise<{ sha: string; building: boolean }> {
	return api.put<{ sha: string; building: boolean }>(
		"/api/me/spec-page",
		input,
	);
}

/** 页面对应的线上地址，关于页在 /about/ */
export function specPageUrl(file: string): string {
	const name = file.replace(/\.mdx?$/i, "");
	return name === "about" ? "/about/" : `/${name}/`;
}
