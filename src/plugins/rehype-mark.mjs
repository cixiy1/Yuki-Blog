import { visit } from "unist-util-visit";

/**
 * 行内标记转成对应标签：
 *   `==高亮==` → `<mark>`
 *   `^上标^`   → `<sup>`
 *   `~下标~`   → `<sub>`
 *
 * 这三种是 Lute 的扩展语法，编辑器的即时渲染开着这三项，正文里存的就是源码形态，
 * 站点构建到这一步得把它们变成真标签，否则页面上原样显示一串符号。
 * 代码块、行内代码、已有的同类标签内部一律不动——那里是源码或已经是结果。
 */

/** 这些标签内部的文本保持原样 */
const SKIP = new Set([
	"code",
	"pre",
	"script",
	"style",
	"mark",
	"kbd",
	"samp",
	"textarea",
	"sup",
	"sub",
]);

const RULES = [
	{ pattern: /==([^=\n]+?)==/g, tag: "mark" },
	{ pattern: /\^([^^\n]+?)\^/g, tag: "sup" },
];

export default function rehypeMark() {
	return (tree, file) => {
		/*
		 * GFM 把 `~文字~` 和 `~~文字~~` 都解析成 <del>，单靠节点分不出来。
		 * 但节点带着源码位置，按位置回查原始 Markdown：单波浪线的改判成下标。
		 * 这样既不用关掉 GFM 的删除线，也不会把「~19 个~」这种约数写成下标——
		 * 那种本来就该原样留着（现在被当成删除线才是错的）。
		 */
		const source = String(file?.value ?? "");
		visit(tree, "element", (node) => {
			if (node.tagName !== "del") return;
			const start = node.position?.start?.offset;
			const end = node.position?.end?.offset;
			if (typeof start !== "number" || typeof end !== "number") return;
			const raw = source.slice(start, end).trim();
			if (raw.startsWith("~~")) return;
			if (!raw.startsWith("~")) return;
			const inner = raw.slice(1, -1);
			// 带空格的按约数看待，别硬套下标
			if (!inner || /\s/.test(inner)) return;
			node.tagName = "sub";
		});

		visit(tree, "text", (node, index, parent) => {
			if (!parent || typeof index !== "number") return;
			if (parent.tagName && SKIP.has(parent.tagName)) return;

			const value = node.value;
			if (!/[=^~]/.test(value)) return;

			const hits = [];
			for (const rule of RULES) {
				rule.pattern.lastIndex = 0;
				for (;;) {
					const match = rule.pattern.exec(value);
					if (!match) break;
					// 全是空格的不算，免得 "a == b" 这种被误伤
					if (!match[1].trim()) continue;
					hits.push({
						start: match.index,
						end: match.index + match[0].length,
						text: match[1],
						tag: rule.tag,
					});
				}
			}
			if (hits.length === 0) return;

			// 靠前的先占位，长的优先；跟已选区间交叉的直接丢掉
			hits.sort((a, b) => a.start - b.start || b.end - a.end);
			const picked = [];
			let cursor = 0;
			for (const hit of hits) {
				if (hit.start < cursor) continue;
				picked.push(hit);
				cursor = hit.end;
			}

			const parts = [];
			let last = 0;
			for (const hit of picked) {
				if (hit.start > last) {
					parts.push({ type: "text", value: value.slice(last, hit.start) });
				}
				parts.push({
					type: "element",
					tagName: hit.tag,
					properties: {},
					children: [{ type: "text", value: hit.text }],
				});
				last = hit.end;
			}
			if (parts.length === 0) return;
			if (last < value.length) {
				parts.push({ type: "text", value: value.slice(last) });
			}

			parent.children.splice(index, 1, ...parts);
			return index + parts.length;
		});
	};
}
