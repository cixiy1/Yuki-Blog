import { putRepoFile, readRepoFile } from "./github-contents";

/**
 * 组织在站点上的那一半：`config/orgs.json`。
 *
 * 为什么要往仓库里再写一份：`/orgs/` 与 `/orgs/<slug>/` 是构建期渲染的静态页，
 * 构建时读不到 D1。组织本体（成员、邀请、状态）留在 D1——那些是运行时判断；
 * 名字、简介、封面这三个「页面上要看得到的东西」由 D1 同步到这份文件。
 *
 * 同步方向只有一个：D1 → 仓库。管理端改完组织就顺手写一次，失败不回滚 D1
 * （组织本身照常可用，只是站点页面等下一次构建才更新），把结果回给前端说明白。
 */
const REPO = "cixiy1/Yuki-blog";
const BRANCH = "main";
const CONFIG_PATH = "config/orgs.json";

export interface OrgPublic {
	name: string;
	description: string;
	cover: string;
}

export interface OrgPublicConfig {
	orgs: Record<string, OrgPublic>;
}

/** 写出固定的字段顺序：不然每次同步都是一次「内容没变」的假 diff */
function serialize(config: OrgPublicConfig): string {
	const orgs: Record<string, OrgPublic> = {};
	for (const slug of Object.keys(config.orgs).sort()) {
		const item = config.orgs[slug];
		orgs[slug] = {
			name: item.name,
			description: item.description,
			cover: item.cover,
		};
	}
	return `${JSON.stringify(
		{
			_comment:
				"管理端「组织」页保存时自动整份重写本文件，手改会被覆盖。key 是组织 slug，必须与文章 frontmatter 的 org 字段一致；visibleTo 里写 org:<slug> 表示「这个组织的成员可读」。cover 用站内路径（/assets/…）或 http(s) 地址。",
			orgs,
		},
		null,
		"\t",
	)}\n`;
}

export interface SyncResult {
	ok: boolean;
	/** 内容没变时跳过提交 */
	skipped?: boolean;
	commit?: string;
	message?: string;
}

/**
 * 把 D1 里所有 active 组织的公开信息同步进仓库文件。
 *
 * 一次组织变更 = 一次提交 = 一次构建，所以先比内容：只改了成员、没改名字时
 * 不该再推一次空提交。
 */
export async function syncOrgSnapshot(
	token: string,
	db: D1Database,
): Promise<SyncResult> {
	const rows = await db
		.prepare(
			"SELECT slug, name, description, cover FROM orgs WHERE status = 'active' ORDER BY slug ASC",
		)
		.all<{
			slug: string;
			name: string;
			description: string | null;
			cover: string | null;
		}>();

	const config: OrgPublicConfig = { orgs: {} };
	for (const row of rows.results ?? []) {
		config.orgs[row.slug] = {
			name: row.name,
			description: row.description ?? "",
			cover: row.cover ?? "",
		};
	}

	const body = serialize(config);
	const current = await readRepoFile({
		repo: REPO,
		path: CONFIG_PATH,
		branch: BRANCH,
		token,
	});
	if (!current.ok) {
		return { ok: false, message: current.message ?? "读取组织配置失败" };
	}
	if (current.content !== null && current.content.trim() === body.trim()) {
		return { ok: true, skipped: true };
	}

	const written = await putRepoFile({
		repo: REPO,
		path: CONFIG_PATH,
		branch: BRANCH,
		content: body,
		message: "chore(orgs): 同步组织信息",
		token,
	});
	if (!written.ok) {
		return { ok: false, message: written.message ?? "写入组织配置失败" };
	}
	return { ok: true, commit: written.sha };
}
