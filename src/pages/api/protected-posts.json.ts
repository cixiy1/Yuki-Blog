import { getPostsForPaths } from "@/utils/content-utils";
import { removeFileExtension } from "@/utils/url-utils";

/**
 * 受访问控制保护的文章清单，给 Worker 在请求时判定权限用。
 *
 * 为什么构建期生成而不是查 D1：文章的可见性写在 frontmatter 里，是仓库的一部分；
 * 构建时已经扫过一遍，顺手压成这份 JSON 比让 Worker 每次去读 git 便宜得多。
 *
 * 这个文件本身不能公开可读——里面是受限文章的 slug 和允许名单。`/api/*` 都在
 * `run_worker_first` 里，Worker 会把非管理员的请求挡成 404（见 server/routes/pages.ts）。
 */
export interface ProtectedPost {
	/** 谁能看：登录即可，还是只有名单里的人 */
	visibility: "login" | "users";
	/** 允许的账号名，小写 */
	accounts: string[];
	/** 允许的 uid */
	uids: number[];
}

export interface ProtectedPostsPayload {
	generated: number;
	posts: Record<string, ProtectedPost>;
}

export async function GET(): Promise<Response> {
	const posts = await getPostsForPaths();
	const map: Record<string, ProtectedPost> = {};

	for (const post of posts) {
		if (post.data.visibility === "public") continue;

		const accounts: string[] = [];
		const uids: number[] = [];
		for (const raw of post.data.visibleTo) {
			const text = raw.trim();
			if (!text) continue;
			// 写成 `uid:945642` 或纯数字都当 uid，其余当账号名
			const uidText = text.startsWith("uid:") ? text.slice(4) : text;
			if (/^\d+$/.test(uidText)) {
				uids.push(Number(uidText));
				continue;
			}
			accounts.push(text.toLowerCase());
		}

		// 文章的 entry.id 就是 frontmatter 的 slug（glob loader 拿它当 id），
		// 而站内地址是 /posts/<slug>/，Worker 按同一套 key 匹配
		map[removeFileExtension(post.id)] = {
			visibility: post.data.visibility === "login" ? "login" : "users",
			accounts,
			uids,
		};
	}

	const payload: ProtectedPostsPayload = {
		generated: Date.now(),
		posts: map,
	};

	return new Response(JSON.stringify(payload), {
		headers: {
			"content-type": "application/json; charset=utf-8",
			// 构建产物每次部署都会换文件，但同名路径会被 CDN 缓存，给个短缓存
			"cache-control": "public, max-age=60",
		},
	});
}
