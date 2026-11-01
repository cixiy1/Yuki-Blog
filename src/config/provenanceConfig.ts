// 文字来源标注配置
// 用法：文章 frontmatter 写 provenance 字段，这里决定它长什么样。
//
//   provenance: handwritten                 # 本人手写
//   provenance: co-written                  # 代笔 + 本人改写
//   provenance:
//     kind: ghostwritten                    # 代笔
//     model: DeepSeek-V4.1-Flash            # 哪个模型
//     agent: WorkBuddy                      # 哪个 agent / 工具
//     note: 大纲由模型给出，正文按我的口径重写   # 可选备注，悬浮提示里显示
//
// 新增一种标注：在 kinds 里加一项即可，frontmatter 直接写这个键名。

import type { ProvenanceConfig } from "@/types/provenanceConfig";

export const provenanceConfig: ProvenanceConfig = {
	enable: true,

	// ── 显示位置 ─────────────────────────────────────
	showInPost: true, // 文章页标题下方
	showInBanner: true, // 封面横幅
	showInCard: false, // 首页 / 归档卡片
	showInDynamic: true, // 说说

	// frontmatter 没写 provenance 时：false=什么都不显示，true=显示下面的「未标注」
	showUntagged: false,
	untagged: {
		label: "来源未标注",
		icon: "material-symbols:help-outline-rounded",
		hint: "这篇文章没有标注作者与代笔情况",
		tone: "muted",
	},

	// ── 详情 ────────────────────────────────────────
	showModel: true, // 显示模型名
	showAgent: true, // 显示代理名
	showNote: true, // 备注拼进悬浮提示
	separator: " · ", // 模型与代理之间的分隔符

	// ── 种类 ────────────────────────────────────────
	kinds: {
		// 作者手写
		handwritten: {
			label: "本人手写",
			icon: "material-symbols:ink-pen-rounded",
			hint: "全文由作者本人撰写，未经模型代笔",
			tone: "neutral",
		},
		// 模型 / 代理代笔
		ghostwritten: {
			label: "代笔",
			icon: "material-symbols:smart-toy-rounded",
			hint: "由模型或代理产出，作者未逐句改写",
			tone: "primary",
		},
		// 代笔 + 作者二次写作
		"co-written": {
			label: "代笔 + 本人改写",
			icon: "material-symbols:edit-square-rounded",
			hint: "模型或代理起草，作者在此基础上二次写作",
			tone: "primary",
		},
	},
};
