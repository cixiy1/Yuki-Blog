/**
 * 仓库里已有文章的索引。
 *
 * 构建期由 `src/pages/api/post-index.json.ts` 产出，随静态资源发布。
 * Worker 读不到 git，只能读这份快照——所以它反映的是「上次构建时」的仓库状态，
 * 管理端改完文章走 P4 的发布链路，构建完成后刷新即可看到最新。
 */

export interface RepoPost {
	slug: string;
	title: string;
	description: string;
	published: number;
	updated: number | null;
	tags: string[];
	category: string;
	series: string;
	cover: string;
	sourceLink: string;
	author: string;
	repoPath: string;
}

/** 同一实例内缓存 60 秒：文章列表点开就看，没必要每次读一遍静态资源 */
const TTL_MS = 60_000;

let cached: { at: number; data: RepoPost[] } | null = null;

export async function readRepoPosts(assets: AssetsFetcher): Promise<RepoPost[]> {
	if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

	try {
		const res = await assets.fetch(new URL("https://assets.local/api/post-index.json"));
		if (!res.ok) return cached?.data ?? [];
		const data = (await res.json()) as RepoPost[];
		cached = { at: Date.now(), data };
		return data;
	} catch {
		// 构建产物缺失（比如本地还没 build）时当作没有仓库文章，不要让列表整个 500
		return cached?.data ?? [];
	}
}

/** 测试用：清掉缓存 */
export function resetRepoPostCache(): void {
	cached = null;
}
