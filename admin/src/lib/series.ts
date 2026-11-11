import { api } from "./api";

/**
 * 系列封面、简介、卡片形态。
 *
 * 配置存在仓库的 `config/series.json`，保存即 commit 触发构建；
 * 系列清单来自构建期文章索引，所以刚建的新系列要等这次构建完才出现。
 */
export type SeriesLayout = "banner" | "icon" | "none";

export interface SeriesSetting {
	/** 站内路径或 http(s) 地址，空字符串表示没配 */
	cover: string;
	description: string;
	/** null 表示跟随站点默认形态 */
	layout: SeriesLayout | null;
}

export interface SeriesRow {
	name: string;
	count: number;
	latest: number;
	posts: Array<{ slug: string; title: string; published: number }>;
}

export interface SeriesData {
	defaultLayout: SeriesLayout;
	series: Record<string, SeriesSetting>;
	rows: SeriesRow[];
	warning?: string;
}

/** 没配过的系列：无封面、无简介、跟随默认形态 */
export function emptySetting(): SeriesSetting {
	return { cover: "", description: "", layout: null };
}

export async function listSeries(): Promise<SeriesData> {
	const data = await api.get<SeriesData>("/api/admin/series");
	return {
		defaultLayout: data.defaultLayout ?? "icon",
		series: data.series ?? {},
		rows: data.rows ?? [],
		warning: data.warning,
	};
}

export interface SavedSeriesConfig {
	defaultLayout: SeriesLayout;
	series: Record<string, SeriesSetting>;
	commit: string | null;
}

/** 保存单个系列的配置；`null` 表示把它清掉，回到「没配过」 */
export async function saveSeriesSetting(
	name: string,
	setting: SeriesSetting | null,
): Promise<SavedSeriesConfig> {
	const data = await api.put<SavedSeriesConfig>("/api/admin/series", {
		series: { [name]: setting },
	});
	return {
		defaultLayout: data.defaultLayout,
		series: data.series ?? {},
		commit: data.commit ?? null,
	};
}

export async function saveSeriesDefaultLayout(
	defaultLayout: SeriesLayout,
): Promise<SavedSeriesConfig> {
	const data = await api.put<SavedSeriesConfig>("/api/admin/series", {
		defaultLayout,
	});
	return {
		defaultLayout: data.defaultLayout,
		series: data.series ?? {},
		commit: data.commit ?? null,
	};
}
