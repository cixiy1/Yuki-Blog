import { visit } from "unist-util-visit";

/**
 * Obsidian 风格的 `==高亮==` 转成 `<mark>`。
 *
 * 编辑器里点「文字高亮」写的是 `<mark>`，手写 `==` 的稿子也得能正常渲染，
 * 两种写法收到同一个结果。代码块与行内代码里的 `==` 不动——那里是源码。
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
]);

const PATTERN = /==([^=\n]+?)==/g;

export default function rehypeMark() {
	return (tree) => {
		visit(tree, "text", (node, index, parent) => {
			if (!parent || typeof index !== "number") return;
			if (parent.tagName && SKIP.has(parent.tagName)) return;

			const value = node.value;
			if (!value.includes("==")) return;

			const parts = [];
			let last = 0;
			PATTERN.lastIndex = 0;

			for (;;) {
				const match = PATTERN.exec(value);
				if (!match) break;
				const text = match[1];
				// 全是空格的不算高亮，免得 "a == b" 这种被误伤
				if (!text.trim()) continue;
				if (match.index > last) {
					parts.push({ type: "text", value: value.slice(last, match.index) });
				}
				parts.push({
					type: "element",
					tagName: "mark",
					properties: {},
					children: [{ type: "text", value: text }],
				});
				last = match.index + match[0].length;
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
