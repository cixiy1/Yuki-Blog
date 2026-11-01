// 文字来源标注的解析：把 frontmatter 的 provenance 归一成可直接渲染的结构
// 字符串简写与对象写法都收，未知键名按原样显示，不会因为配置里没定义就丢信息。

import { provenanceConfig } from "@/config/provenanceConfig";
import type {
	ProvenanceInput,
	ProvenanceKindStyle,
	ProvenanceTone,
} from "@/types/provenanceConfig";

export interface ResolvedProvenance {
	/** 归一后的种类键名，空字符串表示未标注 */
	kind: string;
	/** 徽标上显示的文字 */
	text: string;
	/** 图标名，空字符串表示不显示图标 */
	icon: string;
	/** 配色 */
	tone: ProvenanceTone;
	/** 悬浮提示（含种类说明、模型、代理、备注） */
	tooltip: string;
	/** 是否来自 frontmatter（false 即「未标注」兜底） */
	tagged: boolean;
}

const FALLBACK_KIND_STYLE: ProvenanceKindStyle = {
	label: "",
	icon: "material-symbols:label-outline-rounded",
	hint: "",
	tone: "neutral",
};

function tidy(value: string | undefined): string {
	return (value ?? "").trim();
}

/**
 * 解析一条 provenance。
 * @param raw frontmatter 里的原始值
 * @param show 该位置是否显示（对应 config 里的 showInPost 等开关）
 */
export function resolveProvenance(
	raw: ProvenanceInput,
	show = true,
): ResolvedProvenance | null {
	if (!provenanceConfig.enable || !show) return null;

	const isObject = typeof raw === "object" && raw !== null;
	let kind = isObject ? tidy(raw.kind) : tidy(raw as string | undefined);
	const model = isObject ? tidy(raw.model) : "";
	const agent = isObject ? tidy(raw.agent) : "";
	const note = isObject ? tidy(raw.note) : "";

	// 只写了模型 / 代理，没写种类：按代笔处理
	if (!kind && (model || agent)) kind = "ghostwritten";

	if (!kind) {
		if (!provenanceConfig.showUntagged) return null;
		const untagged = provenanceConfig.untagged;
		return {
			kind: "",
			text: untagged.label,
			icon: untagged.icon ?? "",
			tone: untagged.tone ?? "muted",
			tooltip: untagged.hint ?? "",
			tagged: false,
		};
	}

	const style =
		provenanceConfig.kinds[kind] ??
		({ ...FALLBACK_KIND_STYLE, label: kind } as ProvenanceKindStyle);

	// 徽标文字：种类 + 模型 / 代理
	const detail = [
		provenanceConfig.showModel ? model : "",
		provenanceConfig.showAgent ? agent : "",
	]
		.filter(Boolean)
		.join(provenanceConfig.separator);
	const text = detail
		? `${style.label}${provenanceConfig.separator}${detail}`
		: style.label;

	// 悬浮提示：种类说明 + 完整模型/代理 + 备注
	const tooltip = [
		style.hint ?? "",
		model ? `模型：${model}` : "",
		agent ? `代理：${agent}` : "",
		provenanceConfig.showNote ? note : "",
	]
		.filter(Boolean)
		.join("\n");

	return {
		kind,
		text,
		icon: style.icon ?? "",
		tone: style.tone ?? "neutral",
		tooltip,
		tagged: true,
	};
}
