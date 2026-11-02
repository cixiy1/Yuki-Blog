import type { SiteConfig } from "@/types/siteConfig";
import { mergeConfig } from "@/utils/deep-merge";
import raw from "../../config/site.json";

/**
 * 管理端「站点设置」的覆盖层。
 *
 * 数据流：管理端编辑 → D1 草稿 → 发布时整份写进 `config/site.json` →
 * 构建时由这里读入，铺在各模块的默认值之上。
 * 所以线上生效的值 = 代码默认值 + 本文件。
 *
 * 文件按**配置文件**分命名空间（见下面 NAMESPACES），一个命名空间对应一个
 * config 模块，各取各的，互不干扰：
 *
 *   site         → src/config/siteConfig.ts
 *   profile      → src/config/profileConfig.ts
 *   music        → src/config/musicConfig.ts
 *   friends      → src/config/friendsConfig.ts（page 与 links 两段）
 *   banner       → src/config/backgroundWallpaper.ts
 *   announcement → src/config/announcementConfig.ts
 *
 * 几个约定：
 *  - 文件始终存在（默认只有 `_comment`），不做条件导入，构建不会因文件缺失而挂
 *  - `_comment` 是给人看的，各模块取值时已被过滤掉
 *  - 导航、侧栏这类结构项没有纳入：它们改的是路由与组件清单，
 *    在 JSON 里表达不清楚，真要动还是改代码
 */
const doc = raw as Record<string, unknown>;

/** 覆盖层的命名空间，与服务端 CONFIG_SPEC 的键保持一致 */
export type ConfigNamespace =
	| "site"
	| "profile"
	| "music"
	| "friends"
	| "banner"
	| "announcement";

/** 某个命名空间的原始覆盖内容；不存在时返回空对象 */
export function overrideFor<T>(ns: ConfigNamespace): Partial<T> {
	const section = doc[ns];
	if (!section || typeof section !== "object" || Array.isArray(section)) {
		return {};
	}
	return section as Partial<T>;
}

/** 把覆盖层铺到某个模块的默认值上 */
export function applyNamespace<T>(ns: ConfigNamespace, base: T): T {
	return mergeConfig(base, overrideFor<T>(ns));
}

/** `site` 分区的覆盖，单独导出给 siteConfig 用（那里只需要一层 apply） */
export const siteOverrides: Partial<SiteConfig> =
	overrideFor<SiteConfig>("site");

/** 把覆盖层铺到默认值上。导出让 siteConfig.ts 只做一件事：声明默认值。 */
export function applySiteOverrides(base: SiteConfig): SiteConfig {
	return mergeConfig(base, siteOverrides);
}
