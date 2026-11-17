/**
 * 受限文章的访问名单。
 *
 * 构建期由 `src/pages/api/protected-posts.json.ts` 产出，随静态资源发布。
 * 清单里只有非 public 的文章，公开文章不占体积——这一步很重要：绝大多数请求
 * 命中不到 key，Worker 直接转发给静态资源，不用查库。
 *
 * 这份文件本身不能公开可读（里面是受限文章的 slug 与允许名单），
 * 所以 `/api/protected-posts.json` 没进 `run_worker_first` 的取反白名单，
 * 任何外部请求都会被 Worker 挡成 404。
 */

export interface ProtectedPost {
	visibility: "login" | "users";
	accounts: string[];
	uids: number[];
	/** 允许的组织 slug；成员关系在 D1，判定时再查一次 */
	orgs?: string[];
}

interface Payload {
	generated: number;
	posts: Record<string, ProtectedPost>;
}

/** 同一实例内缓存 60 秒：重新部署后最多一分钟生效 */
const TTL_MS = 60_000;

let cached: { at: number; data: Map<string, ProtectedPost> } | null = null;

/** 清单很小，转成 Map 比每次遍历对象快，也让调用方少判空 */
export async function readProtectedPosts(
	assets: AssetsFetcher,
): Promise<Map<string, ProtectedPost>> {
	if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

	try {
		const res = await assets.fetch(
			new URL("https://assets.local/api/protected-posts.json"),
		);
		if (!res.ok) return cached?.data ?? new Map();
		const payload = (await res.json()) as Payload;
		const data = new Map(Object.entries(payload.posts ?? {}));
		cached = { at: Date.now(), data };
		return data;
	} catch {
		// 构建产物缺失（本地还没 build）时当作没有受限文章。
		// 这里选择「放行」而不是「全挡」：否则本地开发时所有文章都 404，没法调试。
		// 生产环境这个文件一定存在，因为它由同一次构建产出。
		return cached?.data ?? new Map();
	}
}

export interface Reader {
	uid: number;
	account: string;
	role: string;
	status: string;
}

/**
 * 这个人能不能读这篇受限文章。
 *
 * 管理员始终可读：站主要能检查自己设的名单对不对，被封在外面很荒谬。
 * 账号状态不是 active 的一律不放行，跟 API 的口径保持一致——否则「停用」
 * 只挡得住后台，挡不住文章。
 */
export function canReadPost(
	user: Reader | null,
	guard: ProtectedPost,
): boolean {
	if (!user) return false;
	if (user.status !== "active") return false;
	if (user.role === "admin") return true;
	if (guard.visibility === "login") return true;

	if (guard.uids.includes(user.uid)) return true;
	const account = user.account.toLowerCase();
	return guard.accounts.some((item) => item.toLowerCase() === account);
}

/**
 * 组织成员能不能读。
 *
 * 单独一个函数、按需调用：绝大多数受限文章只写账号，`guard.orgs` 是空的，
 * 这条路径一次 D1 都不打。写成 `canReadPost` 里的 await 会让每次读受限文章
 * 都多一次查询，而组织名单其实是少数情况。
 *
 * 一次查全（IN 多个 slug），不是逐组判断：一篇文章可能同时共享给几个组。
 */
export async function isMemberOfAnyOrg(
	db: D1Database,
	user: Reader | null,
	orgs: string[] | undefined,
): Promise<boolean> {
	if (!user || !orgs || orgs.length === 0) return false;
	if (user.status !== "active") return false;

	const holes = orgs.map((_, index) => `?${index + 2}`).join(", ");
	const row = await db
		.prepare(
			`SELECT 1 AS ok
			   FROM org_members m
			   JOIN orgs o ON o.id = m.org_id
			  WHERE m.uid = ?1 AND o.status = 'active' AND o.slug IN (${holes})
			  LIMIT 1`,
		)
		.bind(user.uid, ...orgs)
		.first<{ ok: number }>();
	return row !== null;
}
