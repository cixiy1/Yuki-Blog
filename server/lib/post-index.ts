import { canReadPost, readProtectedPosts } from "./protected-posts";
import type { SessionUser } from "./users";

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
	/** 同系列内的排序号；老文章可能没写 */
	seriesOrder: number | null;
	cover: string;
	sourceLink: string;
	author: string;
	repoPath: string;
	/** 只有受限文章的快照带这个字段；公开那份里一律是 undefined，按 public 处理 */
	visibility?: string;
}

/** 同一实例内缓存 60 秒：文章列表点开就看，没必要每次读一遍静态资源 */
const TTL_MS = 60_000;

let cached: { at: number; data: RepoPost[] } | null = null;

export async function readRepoPosts(
	assets: AssetsFetcher,
): Promise<RepoPost[]> {
	if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

	try {
		const res = await assets.fetch(
			new URL("https://assets.local/api/post-index.json"),
		);
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
	hidden = null;
}

/**
 * 受限文章的元数据（visibility 不是 public）。
 *
 * 单独一份快照：公开的 `/api/post-index.json` 里没有它们（谁都能下载那份文件），
 * 而作者还得能在后台找到并编辑。缓存策略与上面一致。
 */
let hidden: { at: number; data: RepoPost[] } | null = null;

async function readHiddenRepoPosts(assets: AssetsFetcher): Promise<RepoPost[]> {
	if (hidden && Date.now() - hidden.at < TTL_MS) return hidden.data;

	try {
		const res = await assets.fetch(
			new URL("https://assets.local/api/protected-post-meta.json"),
		);
		if (!res.ok) return hidden?.data ?? [];
		const data = (await res.json()) as RepoPost[];
		hidden = { at: Date.now(), data };
		return data;
	} catch {
		return hidden?.data ?? [];
	}
}

/**
 * 管理端看到的那份仓库文章清单 = 公开全部 + 这个人有权读的受限文章。
 *
 * 不合并的话，受限文章在「我的文章」里直接消失：作者既点不进去也改不了，
 * 只能去仓库手改 frontmatter。判定用的规则跟文章页完全一致（canReadPost），
 * 避免出现「列表里看得到、点进去 404」。
 */
export async function readRepoPostsFor(
	assets: AssetsFetcher,
	user: SessionUser | null,
): Promise<RepoPost[]> {
	const base = await readRepoPosts(assets);
	if (!user) return base;

	const [guards, extra] = await Promise.all([
		readProtectedPosts(assets),
		readHiddenRepoPosts(assets),
	]);
	if (guards.size === 0 || extra.length === 0) return base;

	const readable = extra.filter((post) => {
		const guard = guards.get(post.slug);
		return guard ? canReadPost(user, guard) : true;
	});
	return readable.length > 0 ? [...base, ...readable] : base;
}
