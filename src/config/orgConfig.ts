import raw from "../../config/orgs.json";

/**
 * 组织的公开信息。
 *
 * 组织本体存在 D1（成员、邀请、状态），但 `/orgs/` 是构建期渲染的静态页，
 * 构建时读不到数据库。所以管理端每次改组织都会把 name / description / cover
 * 这三个「页面上要看得到的东西」同步进这份文件（见 server/lib/org-store.ts），
 * 构建期从这里取。
 *
 * 键是组织 slug，与文章 frontmatter 的 `org` 字段精确匹配；改名不会影响文章，
 * 只有改 slug 才会。
 */
export interface OrgMeta {
	slug: string;
	name: string;
	description: string;
	/** 站内路径或 http(s)；空串表示没配 */
	cover: string;
}

function toText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

const doc = raw as { orgs?: Record<string, unknown> };

/** 配置里的全部组织，按名字排序：名单很短，顺序稳定比「创建先后」更好找 */
export const orgList: OrgMeta[] = Object.entries(doc.orgs ?? {})
	.flatMap(([slug, value]) => {
		const key = slug.trim();
		if (!key || !value || typeof value !== "object" || Array.isArray(value)) {
			return [];
		}
		const entry = value as Record<string, unknown>;
		const name = toText(entry.name) || key;
		return [
			{
				slug: key,
				name,
				description: toText(entry.description),
				cover: toText(entry.cover),
			},
		];
	})
	.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

/** 按 slug 取组织；查不到返回 null（文章写了不存在的组织时就是这种） */
export function orgMetaFor(slug: string): OrgMeta | null {
	const key = slug.trim();
	if (!key) return null;
	return orgList.find((org) => org.slug === key) ?? null;
}

/** 文章要显示的组织名：配置里没有就退回 slug，总比什么都不显示强 */
export function orgNameOf(slug: string): string {
	return orgMetaFor(slug)?.name ?? slug.trim();
}
