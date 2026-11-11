/**
 * 系列封面配置的读写。
 *
 * 真身是仓库里的 `config/series.json`：构建期被 `src/config/seriesConfig.ts`
 * 读进去铺到系列分组上，所以只有 commit 之后才会出现在线上页面。
 * Worker 读不到文件系统，读走 GitHub Contents API，写也走它。
 *
 * 为什么不放 D1：这份配置是构建期输入，放 D1 就要在构建时回连数据库，
 * 与 `config/site.json` 那条链也不一致。放仓库文件的好处是改完能进 git 历史。
 */
import { putRepoFile, readRepoFile } from "./github-contents";

const REPO = "cixiy1/Yuki-blog";
const BRANCH = "main";
const CONFIG_PATH = "config/series.json";

/** 构建期导出的文章索引，用来聚合出「有哪些系列、各几篇」 */
const POST_INDEX_KEY = "https://assets.local/api/post-index.json";

export type SeriesLayout = "banner" | "icon" | "none";

const LAYOUTS: readonly SeriesLayout[] = ["banner", "icon", "none"];

export interface SeriesSetting {
	/** 站内路径（/assets/...）或 http(s) 地址；空字符串表示没配 */
	cover: string;
	/** 卡片上的一句话说明 */
	description: string;
	/** null 表示跟随 sites 的 defaultLayout，改默认值时一起变 */
	layout: SeriesLayout | null;
}

export interface SeriesConfig {
	defaultLayout: SeriesLayout;
	series: Record<string, SeriesSetting>;
}

/** 管理端列表要的：系列名、篇数、最近更新，以及给个顺序参考 */
export interface SeriesRow {
	name: string;
	count: number;
	latest: number;
	posts: Array<{ slug: string; title: string; published: number }>;
}

export const EMPTY_CONFIG: SeriesConfig = {
	defaultLayout: "icon",
	series: {},
};

function toLayout(value: unknown, fallback: SeriesLayout): SeriesLayout {
	return LAYOUTS.includes(value as SeriesLayout)
		? (value as SeriesLayout)
		: fallback;
}

function toText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** 文件名（站内绝对路径）或 http(s) 外链；其它写法一律拒掉，防止写出坏路径 */
function isValidCover(value: string): boolean {
	if (!value) return true;
	if (value.length > 300) return false;
	if (value.startsWith("/")) return !value.startsWith("//");
	return /^https?:\/\//i.test(value);
}

/** 把任意来源的配置归一化成可用结构；坏值丢掉，别让一个错字段拖垮整页 */
export function normalizeConfig(raw: unknown): SeriesConfig {
	const doc =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	const defaultLayout = toLayout(doc.defaultLayout, "banner");
	const seriesRaw =
		doc.series && typeof doc.series === "object" && !Array.isArray(doc.series)
			? (doc.series as Record<string, unknown>)
			: {};

	const series: Record<string, SeriesSetting> = {};
	for (const [key, value] of Object.entries(seriesRaw)) {
		const name = key.trim();
		if (!name || !value || typeof value !== "object" || Array.isArray(value)) {
			continue;
		}
		const entry = value as Record<string, unknown>;
		const cover = toText(entry.cover);
		series[name] = {
			cover: isValidCover(cover) ? cover : "",
			description: toText(entry.description).slice(0, 120),
			layout:
				entry.layout === null || entry.layout === undefined
					? null
					: toLayout(entry.layout, defaultLayout),
		};
	}

	return { defaultLayout, series };
}

/** 解析仓库里的配置文件；文件不存在时给空配置（首次保存就是这种情况） */
export async function readSeriesConfig(token: string): Promise<{
	ok: boolean;
	status: number;
	message?: string;
	config: SeriesConfig;
}> {
	const file = await readRepoFile({
		repo: REPO,
		path: CONFIG_PATH,
		branch: BRANCH,
		token,
	});
	if (!file.ok) {
		return {
			ok: false,
			status: file.status,
			message: file.message,
			config: EMPTY_CONFIG,
		};
	}
	if (file.content === null) {
		return { ok: true, status: 200, config: EMPTY_CONFIG };
	}

	let parsed: unknown = null;
	try {
		parsed = JSON.parse(file.content);
	} catch {
		// 文件被手改坏了：退回空配置，保存时会整份重写
		return { ok: true, status: 200, config: EMPTY_CONFIG };
	}
	return { ok: true, status: 200, config: normalizeConfig(parsed) };
}

export interface SaveResult {
	ok: boolean;
	status: number;
	message?: string;
	commit?: string;
	config: SeriesConfig;
}

/**
 * 保存：先读仓库当前内容，把提交上来的项合并进去再整份写回。
 *
 * 合并而不是整份覆盖的原因：管理端页面是几分钟前加载的，这中间可能有人手工
 * 往文件里加了系列；整份覆盖会把它抹掉。传 `null` 表示删掉该系列的配置。
 */
export async function saveSeriesConfig(input: {
	token: string;
	defaultLayout?: unknown;
	series?: Record<string, unknown>;
}): Promise<SaveResult> {
	const current = await readSeriesConfig(input.token);
	if (!current.ok) {
		return {
			ok: false,
			status: current.status,
			message: current.message,
			config: EMPTY_CONFIG,
		};
	}

	const next: SeriesConfig = {
		defaultLayout:
			input.defaultLayout === undefined
				? current.config.defaultLayout
				: toLayout(input.defaultLayout, current.config.defaultLayout),
		series: { ...current.config.series },
	};

	for (const [rawName, value] of Object.entries(input.series ?? {})) {
		const name = rawName.trim();
		if (!name) continue;
		if (value === null) {
			delete next.series[name];
			continue;
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const entry = value as Record<string, unknown>;
		const cover = toText(entry.cover);
		if (!isValidCover(cover)) {
			return {
				ok: false,
				status: 400,
				message: `「${name}」的封面地址只能用站内路径（/assets/…）或 http(s) 链接`,
				config: current.config,
			};
		}
		next.series[name] = {
			cover,
			description: toText(entry.description).slice(0, 120),
			layout:
				entry.layout === null || entry.layout === undefined
					? null
					: toLayout(entry.layout, next.defaultLayout),
		};
	}

	const body = `${JSON.stringify(
		{
			_comment:
				"管理端「系列管理」保存时整体覆盖本文件。key 必须与文章 frontmatter 的 series 完全一致（含空格）。layout 取值 banner / icon / none，留空则跟随 defaultLayout。封面写站内路径（/assets/...）或 http(s) 地址，留空时横幅形态用系列名首字兜底。",
			defaultLayout: next.defaultLayout,
			series: next.series,
		},
		null,
		"\t",
	)}\n`;

	const result = await putRepoFile({
		repo: REPO,
		path: CONFIG_PATH,
		branch: BRANCH,
		content: body,
		message: "chore(series): 更新系列封面配置",
		token: input.token,
	});
	if (!result.ok) {
		return {
			ok: false,
			status: result.status,
			message: result.message,
			config: next,
		};
	}

	return { ok: true, status: 200, commit: result.sha, config: next };
}

/**
 * 现有系列清单：从构建期文章索引聚合。
 *
 * 系列本身不是内容集合，没有「系列表」可查，只能扫文章。索引里已带
 * `series` 与 `published`，一次请求就够，不用逐篇读 frontmatter。
 */
export async function listSeriesRows(assets: AssetsFetcher): Promise<{
	ok: boolean;
	message?: string;
	rows: SeriesRow[];
}> {
	let data: Array<{
		slug?: string;
		title?: string;
		published?: number;
		series?: string;
	}>;
	try {
		const res = await assets.fetch(new URL(POST_INDEX_KEY));
		if (!res.ok) {
			return { ok: false, message: "读取文章索引失败", rows: [] };
		}
		data = (await res.json()) as typeof data;
	} catch {
		return { ok: false, message: "读取文章索引失败", rows: [] };
	}

	const map = new Map<string, SeriesRow>();
	for (const post of data) {
		const name = (post.series ?? "").trim();
		if (!name) continue;
		const row = map.get(name) ?? { name, count: 0, latest: 0, posts: [] };
		const published = typeof post.published === "number" ? post.published : 0;
		row.count += 1;
		row.latest = Math.max(row.latest, published);
		row.posts.push({
			slug: post.slug ?? "",
			title: post.title ?? "",
			published,
		});
		map.set(name, row);
	}

	const rows = [...map.values()];
	for (const row of rows) {
		row.posts.sort((a, b) => b.published - a.published);
	}
	rows.sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name));
	return { ok: true, rows };
}
