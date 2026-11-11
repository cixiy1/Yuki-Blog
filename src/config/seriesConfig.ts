import raw from "../../config/series.json";

/**
 * 系列封面的覆盖层。
 *
 * 系列本身不是独立内容集合：`/series/` 由文章 frontmatter 的 `series` 字段
 * 现分组得到，所以封面、简介、卡片形态没地方写。这份文件补的就是这块——
 * 管理端「系列管理」保存时整份覆盖它，构建期在这里铺到分组结果上。
 *
 * 键必须与 `series` 字段完全一致（字符串精确匹配，多一个空格就是另一个系列）。
 */
export type SeriesLayout = "banner" | "icon" | "none";

export interface SeriesMeta {
	/** 站内路径或 http(s) 地址；空字符串表示没配 */
	cover: string;
	/** 卡片上一句话说明，空字符串表示不显示 */
	description: string;
	/** 卡片封面形态：顶部横幅 / 圆形小图 / 完全不显示封面 */
	layout: SeriesLayout;
}

const LAYOUTS: readonly SeriesLayout[] = ["banner", "icon", "none"];

function toLayout(value: unknown, fallback: SeriesLayout): SeriesLayout {
	return LAYOUTS.includes(value as SeriesLayout)
		? (value as SeriesLayout)
		: fallback;
}

function toText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

const doc = raw as {
	defaultLayout?: unknown;
	series?: Record<string, unknown>;
};

/** 新系列没单独选形态时用的默认值 */
export const seriesDefaultLayout: SeriesLayout = toLayout(
	doc.defaultLayout,
	"icon",
);

/** 所有系列的覆盖数据；管理端保存时也要用它回显 */
export const seriesOverrides: Record<string, SeriesMeta> = Object.fromEntries(
	Object.entries(doc.series ?? {}).flatMap(([name, value]) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return [];
		const entry = value as Record<string, unknown>;
		const meta: SeriesMeta = {
			cover: toText(entry.cover),
			description: toText(entry.description),
			layout: toLayout(entry.layout, seriesDefaultLayout),
		};
		// 三项都空（没封面、没简介、跟着默认形态）就当没配过，别在页面上留空壳
		if (!meta.cover && !meta.description && entry.layout == null) {
			return [];
		}
		return [[name.trim(), meta] as const];
	}),
);

export function seriesMetaFor(name: string): SeriesMeta {
	return (
		seriesOverrides[name] ?? {
			cover: "",
			description: "",
			layout: seriesDefaultLayout,
		}
	);
}
