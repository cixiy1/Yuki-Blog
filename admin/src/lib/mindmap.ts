/**
 * 思维导图与 mermaid mindmap 文本的互转。
 *
 * 画布上画完不存图片：导图落地成 ```mermaid 文本，站点构建时渲染成静态 SVG，
 * 深浅色各一套，十几 KB 的正文比几 MB 的 PNG 好维护——能 diff、能搜、能改。
 */

export interface MindNode {
	topic: string;
	children: MindNode[];
}

export interface MindBlock {
	/** 整个 ```mermaid 块（含围栏）在正文里的起止位置 */
	start: number;
	end: number;
	/** 围栏内的源码 */
	source: string;
}

/** 这些字符会让 mermaid 把文本当成节点语法，得套一层带引号的形状 */
const NEEDS_SHAPE = /[[\](){}"|]/;

function tidy(topic: string): string {
	return topic.replace(/\s+/g, " ").trim();
}

function quote(text: string): string {
	return text.replace(/"/g, "'");
}

/**
 * 树 → mermaid mindmap 文本。
 * 层级靠缩进，根节点画成圆（含括号时退回方框，否则括号会和形状语法打架）。
 */
export function toMermaid(root: MindNode): string {
	const lines: string[] = ["mindmap"];
	let seq = 0;

	const walk = (node: MindNode, depth: number): void => {
		const text = tidy(node.topic) || "未命名";
		// mermaid 的惯例是 mindmap 下面再缩一层，根也缩，这样和手写的导图长得一样
		const pad = "  ".repeat(depth + 1);
		if (depth === 0) {
			lines.push(
				NEEDS_SHAPE.test(text)
					? `${pad}root["${quote(text)}"]`
					: `${pad}root((${text}))`,
			);
		} else if (NEEDS_SHAPE.test(text)) {
			seq += 1;
			lines.push(`${pad}n${seq}["${quote(text)}"]`);
		} else {
			lines.push(`${pad}${text}`);
		}
		for (const child of node.children) walk(child, depth + 1);
	};

	walk(root, 0);
	return lines.join("\n");
}

/** `root((文字))` / `n1["文字"]` / `A(文字)` / `A{{文字}}` 取花括号里的文字 */
function nodeText(raw: string): string {
	let text = raw
		.replace(/::icon\([^)]*\)\s*$/, "")
		.replace(/:{3}[^\s]+.*$/, "")
		.trim();

	const pairs: [RegExp, RegExp][] = [
		[/^[A-Za-z0-9_.-]+\(\(/, /\)\)$/],
		[/^[A-Za-z0-9_.-]+\{\{/, /\}\}$/],
		[/^[A-Za-z0-9_.-]+\[/, /\]$/],
		[/^[A-Za-z0-9_.-]+\(/, /\)$/],
	];
	for (const [open, close] of pairs) {
		if (open.test(text) && close.test(text)) {
			text = text
				.replace(open, "")
				.replace(close, "")
				.trim()
				.replace(/^"(.*)"$/, "$1");
			break;
		}
	}
	return text;
}

/**
 * mermaid mindmap 文本 → 树。层级按每层缩进换算，
 * 解析不出来（没有 mindmap 头、或根本没节点）时返回 null。
 */
export function parseMermaid(source: string): MindNode | null {
	const lines = source.replace(/\r\n/g, "\n").split("\n");
	const head = lines.findIndex((line) => /^\s*mindmap\s*$/.test(line));
	if (head < 0) return null;

	const items: { indent: number; topic: string }[] = [];

	for (let i = head + 1; i < lines.length; i += 1) {
		const raw = lines[i];
		if (!raw.trim()) continue;
		if (/^\s*%%/.test(raw)) continue;
		const indent = (raw.match(/^[\t ]*/)?.[0] ?? "").replace(
			/\t/g,
			"  ",
		).length;
		const topic = nodeText(raw.trim());
		if (!topic) continue;
		items.push({ indent, topic });
	}
	if (items.length === 0) return null;

	// 根节点可能缩进（mermaid 文档的写法）也可能顶格（不少人生成出来的样子），
	// 两种都要认：层级单位取「根与第一层子节点之间的缩进差」
	const rootIndent = items[0].indent;
	const childIndent = items.find((item) => item.indent > rootIndent)?.indent;
	const unit =
		childIndent === undefined ? 2 : Math.max(1, childIndent - rootIndent);
	const depthOf = (indent: number): number =>
		Math.max(1, Math.round((indent - rootIndent) / unit) + 1);

	const root: MindNode = { topic: items[0].topic, children: [] };
	const stack: { depth: number; node: MindNode }[] = [{ depth: 1, node: root }];
	for (const item of items.slice(1)) {
		const depth = depthOf(item.indent);
		while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
			stack.pop();
		}
		const parent = stack[stack.length - 1].node;
		const node: MindNode = { topic: item.topic, children: [] };
		parent.children.push(node);
		stack.push({ depth, node });
	}
	return root;
}

/** 正文里所有 mermaid mindmap 块，按出现顺序 */
export function findMindmapBlocks(markdown: string): MindBlock[] {
	const blocks: MindBlock[] = [];
	const re = /```mermaid[^\n]*\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null = re.exec(markdown);
	while (match) {
		const source = match[1].replace(/\s+$/, "");
		if (/^\s*mindmap\s*$/m.test(source)) {
			blocks.push({
				start: match.index,
				end: match.index + match[0].length,
				source,
			});
		}
		match = re.exec(markdown);
	}
	return blocks;
}

/** 用新画好的导图替换掉某一块 */
export function replaceBlock(
	markdown: string,
	block: MindBlock,
	source: string,
): string {
	return `${markdown.slice(0, block.start)}\`\`\`mermaid\n${source}\n\`\`\`${markdown.slice(block.end)}`;
}
