/**
 * 每篇文章的阅读量。
 *
 * 数据在 abacus（免费计数器服务，前台文章页写、`/stats` 页读），它只提供
 * `/get/<namespace>/<key>` 这种单键读取，没有批量接口，所以 Worker 这边一次要发
 * N 个请求。为此做了三件事：
 *   1. 并发分批（一次 6 个），别把 N 个请求一股脑甩出去；
 *   2. 边缘缓存 10 分钟（caches.default，跨 isolate 共享）——列表页刷新不该每次都打外部服务；
 *   3. 半数以上失败就不写缓存，避免一次抖动被缓存成「全是 0」。
 *
 * ⚠️ key 的算法必须和 `src/utils/stats-utils.ts` 的 getStatsId 逐字一致，
 *    差一个字符读到的就是另一个计数器（表现为管理端显示 0、前台有数字）。
 */

/** 与 statsConfig 同源：构建期由 /api/stats-config.json 导出，别在这里再抄一份 */
interface StatsConfigFile {
	enable: boolean;
	apiBase: string;
	namespace: string;
}

const CONFIG_TTL_MS = 60 * 60 * 1000;
let configCache: { at: number; value: StatsConfigFile | null } | null = null;

/** 卡片上的数字，10 分钟粒度足够；刷新太勤会被计数服务限流（30 次 / 10 秒 / IP） */
const VIEWS_TTL_SECONDS = 600;
const FETCH_TIMEOUT_MS = 6000;
const CONCURRENCY = 6;

async function readStatsConfig(
	assets: AssetsFetcher,
): Promise<StatsConfigFile | null> {
	if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) {
		return configCache.value;
	}
	try {
		const res = await assets.fetch(
			new URL("https://assets.local/api/stats-config.json"),
		);
		if (!res.ok) return configCache?.value ?? null;
		const value = (await res.json()) as StatsConfigFile;
		configCache = { at: Date.now(), value };
		return value;
	} catch {
		// 构建产物缺失（本地没 build）时别让接口 500，前端拿不到数字会自己降级
		return configCache?.value ?? null;
	}
}

/** 同 src/utils/stats-utils.ts：FNV-1a 32 位后转 36 进制，前缀 p 保证长度 ≥ 3 */
export function statsId(slug: string): string {
	const source = String(slug || "").replace(/\.(md|mdx|markdown)$/i, "");
	let hash = 0x811c9dc5;
	for (let i = 0; i < source.length; i++) {
		hash ^= source.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `p${hash.toString(36)}`;
}

/**
 * 计数器键。
 *
 * 容易差一层：前台 site-stats.js 的 `K.post()` 是 `sanitizeKey("p_" + id)`，
 * 而 stats id 本身已经带了一个 p，所以真实键是 `p_p<hash>`。少写这个前缀不会报错，
 * 只会一直读到「Key not found」——表现为整页阅读量都是 0。
 */
export function statsKey(slug: string): string {
	return `p_${statsId(slug)}`;
}

/** 计数服务返回 {"value":N}，没这个计数器时是 {"error":"Key not found"} */
function readValue(raw: unknown): number | null {
	if (!raw || typeof raw !== "object") return null;
	const value = Number((raw as { value?: unknown }).value);
	return Number.isFinite(value) ? value : null;
}

async function fetchOne(apiBase: string, namespace: string, key: string) {
	const url = `${apiBase.replace(/\/+$/, "")}/get/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal });
		// 计数器是「第一次有人打开文章」时才创建的，没有这个 key 等于 0 次阅读，
		// 不是错误。别把这情况算进失败，否则新站整页都拿不到数字。
		if (res.status === 404) return 0;
		if (!res.ok) return null;
		const value = readValue(await res.json());
		return value ?? 0;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export interface PostViewsResult {
	/** slug → 阅读量；没统计到的 slug 不在表里 */
	views: Record<string, number>;
	error?: string;
}

/**
 * 批量读阅读量。列表一次 20-30 篇，最坏情况 30 个外部请求，
 * 边缘缓存命中时是 0 个。
 */
export async function readPostViews(
	assets: AssetsFetcher,
	slugs: string[],
): Promise<PostViewsResult> {
	const uniq = [...new Set(slugs.map((s) => String(s || "").trim()))].filter(
		Boolean,
	);
	if (uniq.length === 0) return { views: {} };

	const config = await readStatsConfig(assets);
	if (!config?.enable || !config.apiBase) {
		return { views: {}, error: "stats_disabled" };
	}

	// Cache API 的 key 只认 URL，把参数按 slug 排序，别让同一批文章的两种顺序各存一份
	const cacheKey = new Request(
		`https://post-views.internal/${encodeURIComponent(config.namespace)}?slugs=${[...uniq].sort().map(encodeURIComponent).join(",")}`,
	);
	// tsconfig 的 lib 里 CacheStorage 是浏览器的（只有 caches.open），Workers 多出
	// caches.default 这个默认命名空间，得绕一下类型
	const cache = (caches as unknown as { default: Cache }).default;
	const hit = await cache.match(cacheKey);
	if (hit) {
		return { views: (await hit.json()) as Record<string, number> };
	}

	const views: Record<string, number> = {};
	let failed = 0;

	for (let i = 0; i < uniq.length; i += CONCURRENCY) {
		const batch = uniq.slice(i, i + CONCURRENCY);
		const values = await Promise.all(
			batch.map((slug) =>
				fetchOne(config.apiBase, config.namespace, statsKey(slug)),
			),
		);
		batch.forEach((slug, index) => {
			const value = values[index];
			// 0 是合法值（新文章没被读过），null 才是「没取到」
			if (value === null) failed += 1;
			else views[slug] = value;
		});
	}

	const result: PostViewsResult = { views };
	// 全部失败说明计数服务这会儿不可达，别把这一片 0 缓存 10 分钟；
	// 部分失败可以缓存——取到的那几篇是准的，缺的下次刷新再补。
	if (failed === uniq.length) {
		result.error = "stats_unreachable";
	} else {
		await cache.put(
			cacheKey,
			new Response(JSON.stringify(views), {
				headers: {
					"content-type": "application/json; charset=utf-8",
					"cache-control": `public, max-age=${VIEWS_TTL_SECONDS}`,
				},
			}),
		);
	}

	return result;
}
