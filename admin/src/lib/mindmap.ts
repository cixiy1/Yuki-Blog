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
	/** 围栏前的缩进：块放在列表、引用里时不能丢，否则改完就掉出层级 */
	indent?: string;
	/** 原围栏字符：三个以上反引号或波浪号，回写时照抄 */
	fence?: string;
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
	let text = raw.trim();

	// 尾部修饰（`:::class`、`::icon()`）只在形状之后追加，形状里的同名文本不能剥
	if (!/[\])}]$/.test(text)) {
		text = text
			.replace(/\s*:::[A-Za-z0-9_-]+\s*$/, "")
			.replace(/\s*::icon\([^)]*\)\s*$/, "")
			.trim();
	}

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

/** 正文里所有 mermaid 块，按出现顺序；kind 区分是不是思维导图 */
export interface MermaidBlock extends MindBlock {
	kind: "mindmap" | "other";
}

export function findMermaidBlocks(markdown: string): MermaidBlock[] {
	const blocks: MermaidBlock[] = [];
	// 围栏可能是三个及以上反引号或波浪号，也可能整体缩进（放进列表、引用里）
	const re =
		/^([ \t]*)(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm;
	let match: RegExpExecArray | null = re.exec(markdown);
	while (match) {
		const source = match[3].replace(/\s+$/, "");
		blocks.push({
			start: match.index,
			end: match.index + match[0].length,
			source,
			indent: match[1],
			fence: match[2],
			kind: /^\s*mindmap\s*$/m.test(source) ? "mindmap" : "other",
		});
		match = re.exec(markdown);
	}
	return blocks;
}

/** 正文里所有 mermaid mindmap 块，按出现顺序 */
export function findMindmapBlocks(markdown: string): MindBlock[] {
	return findMermaidBlocks(markdown).filter(
		(block) => block.kind === "mindmap",
	);
}

/**
 * 用新内容替换掉某一块。围栏字符和缩进照原样写回，
 * 否则放在列表里的块改一次就掉出列表。
 */
export function replaceBlock(
	markdown: string,
	block: MindBlock,
	source: string,
): string {
	const indent = block.indent ?? "";
	const fence = block.fence ?? "```";
	const body = source
		.split("\n")
		.map((line) => (line ? `${indent}${line}` : line))
		.join("\n");
	return `${markdown.slice(0, block.start)}${indent}${fence}mermaid\n${body}\n${indent}${fence}${markdown.slice(block.end)}`;
}
