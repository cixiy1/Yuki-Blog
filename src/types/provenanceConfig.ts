// 文字来源标注（谁写了这段文字）的类型定义
// 目标：每篇文章 / 每条动态都能标出「本人手写 / 代笔（模型-代理）/ 代笔后本人二次写作」

/** 标注色调，决定徽标配色 */
export type ProvenanceTone = "neutral" | "primary" | "muted";

/** 标注种类样式（可在 provenanceConfig.kinds 里自由增删） */
export interface ProvenanceKindStyle {
	/** 显示文案，例如「代笔」 */
	label: string;
	/** 图标名（astro-icon / Iconify 名称），留空则不显示图标 */
	icon?: string;
	/** 悬浮提示里的解释，说明这一类的含义 */
	hint?: string;
	/** 配色：neutral=常规底色，primary=主题色，muted=淡化 */
	tone?: ProvenanceTone;
}

/** 未标注时的兜底样式 */
export interface ProvenanceUntaggedStyle {
	label: string;
	icon?: string;
	hint?: string;
	tone?: ProvenanceTone;
}

/** frontmatter 里 provenance 的对象写法 */
export interface ProvenanceDetail {
	/** 种类键名，对应 provenanceConfig.kinds；留空但填了 model/agent 时按代笔处理 */
	kind?: string;
	/** 哪个模型 */
	model?: string;
	/** 哪个 agent / 工具 */
	agent?: string;
	/** 自由备注，例如「大纲模型给，正文我重写」 */
	note?: string;
}

/** frontmatter 里 provenance 的取值：字符串简写或对象写法 */
export type ProvenanceInput = string | ProvenanceDetail | null | undefined;

export interface ProvenanceConfig {
	/** 总开关，false 时全站不显示任何标注 */
	enable: boolean;
	/** 文章正文页（标题下方的元信息栏） */
	showInPost: boolean;
	/** 文章封面横幅上的元信息栏 */
	showInBanner: boolean;
	/** 首页 / 归档 / 搜索结果的卡片列表 */
	showInCard: boolean;
	/** 动态（说说）列表 */
	showInDynamic: boolean;
	/** frontmatter 未写 provenance 时是否显示「未标注」 */
	showUntagged: boolean;
	/** 未标注的兜底样式 */
	untagged: ProvenanceUntaggedStyle;
	/** 是否显示模型名（如 DeepSeek-V4.1-Flash） */
	showModel: boolean;
	/** 是否显示代理名（如 WorkBuddy） */
	showAgent: boolean;
	/** 是否把 note 备注拼进悬浮提示 */
	showNote: boolean;
	/** 模型与代理之间的分隔符 */
	separator: string;
	/** 种类定义：键名即 frontmatter 里 `provenance: <键名>` 的取值 */
	kinds: Record<string, ProvenanceKindStyle>;
}
