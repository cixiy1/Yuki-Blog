/**
 * frontmatter 的行级读写。
 *
 * 不引 YAML 库：文章 frontmatter 结构简单，行级替换能原样保留不认识的字段
 * （password、licenseUrl、provenance…）和它们的书写顺序，保存后的 diff 才干净。
 * 代价是只支持 `key: 值`、`key:` + `- 项` 这两种写法，够本站用了。
 */

export interface SplitResult {
	/** 去掉 --- 分隔行之后的内容 */
	frontmatter: string;
	/** frontmatter 之后的正文，原样保留 */
	body: string;
}

export function splitMarkdown(text: string): SplitResult {
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
	if (!match) return { frontmatter: "", body: text };
	return { frontmatter: match[1], body: text.slice(match[0].length) };
}

export function joinMarkdown(frontmatter: string, body: string): string {
	const head = frontmatter.replace(/\s+$/, "");
	const tail = body.replace(/^\n+/, "");
	return `---\n${head}\n---\n\n${tail}`;
}

/**
 * YAML 字符串：只在必要的时候加引号。
 *
 * 无脑加引号会让每次保存都把整个 frontmatter 重写一遍（`title: "你好"`），
 * diff 里全是噪声。这里按 YAML 的裸字符串规则判断：会被误读成注释、
 * 映射、列表、布尔或数字的值才引起来。
 */
export function yamlString(value: string): string {
	const text = value.trim();
	if (text.length === 0) return '""';
	const risky =
		text !== value ||
		/[:#{}[\],&*!|>'"%@`]/.test(text) ||
		/^[-?]/.test(text) ||
		/^(true|false|null|yes|no|on|off|~)$/i.test(text) ||
		/^-?[0-9]/.test(text);
	return risky ? JSON.stringify(value) : value;
}

function unquote(raw: string): string {
	const text = raw.trim();
	if (!text) return "";
	if (text.startsWith('"') && text.endsWith('"')) {
		try {
			return JSON.parse(text) as string;
		} catch {
			return text.slice(1, -1);
		}
	}
	if (text.startsWith("'") && text.endsWith("'")) {
		return text.slice(1, -1).replace(/''/g, "'");
	}
	return text;
}

export function readScalar(frontmatter: string, key: string): string {
	const lines = frontmatter.split(/\r?\n/);
	const re = new RegExp(`^${key}:[ \\t]*(.*)$`);
	for (const line of lines) {
		const match = re.exec(line);
		if (match) return unquote(match[1]);
	}
	return "";
}

export function readList(frontmatter: string, key: string): string[] {
	const lines = frontmatter.split(/\r?\n/);
	const startRe = new RegExp(`^${key}:[ \\t]*(.*)$`);
	for (let i = 0; i < lines.length; i += 1) {
		const match = startRe.exec(lines[i]);
		if (!match) continue;

		const inline = match[1].trim();
		if (inline.startsWith("[")) {
			const inner = inline.replace(/^\[/, "").replace(/\]$/, "");
			return inner
				.split(",")
				.map((part) => unquote(part))
				.filter((part) => part.length > 0);
		}

		const items: string[] = [];
		for (let j = i + 1; j < lines.length; j += 1) {
			const itemMatch = /^[ \t]+-[ \t]*(.*)$/.exec(lines[j]);
			if (!itemMatch) break;
			items.push(unquote(itemMatch[1]));
		}
		return items;
	}
	return [];
}

/**
 * 替换一个键：连它下面的列表项一起换掉；`replacement` 为 null 表示删除这个键。
 * 位置保持原样，新键追加到末尾——这样改动只落在真正动过的字段上。
 */
function writeField(
	frontmatter: string,
	key: string,
	replacement: string | null,
): string {
	const lines = frontmatter.length > 0 ? frontmatter.split(/\r?\n/) : [];
	const startRe = new RegExp(`^${key}:[ \\t]*`);
	const out: string[] = [];
	let replaced = false;

	for (let i = 0; i < lines.length; i += 1) {
		if (!replaced && startRe.test(lines[i])) {
			replaced = true;
			let j = i + 1;
			// 键下面挂着的缩进行都算它的：列表项 `- x` 与嵌套映射 `k: v` 都要一起删，
			// 只跳过列表会留下孤立的 `  kind: ...`，整份 frontmatter 直接解析失败
			while (
				j < lines.length &&
				(/^[ \t]+-/.test(lines[j]) ||
					/^[ \t]+[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[j]))
			) {
				j += 1;
			}
			if (replacement !== null) out.push(replacement);
			i = j - 1;
			continue;
		}
		out.push(lines[i]);
	}

	if (!replaced && replacement !== null) out.push(replacement);
	return out.join("\n");
}

export function setScalar(
	frontmatter: string,
	key: string,
	value: string | null,
): string {
	if (value === null || value === "") return writeField(frontmatter, key, null);
	return writeField(frontmatter, key, `${key}: ${yamlString(value)}`);
}

/** 日期这类不该加引号的值 */
export function setRawScalar(
	frontmatter: string,
	key: string,
	value: string | null,
): string {
	if (value === null || value === "") return writeField(frontmatter, key, null);
	return writeField(frontmatter, key, `${key}: ${value}`);
}

export function setList(
	frontmatter: string,
	key: string,
	values: string[],
): string {
	if (values.length === 0) return writeField(frontmatter, key, null);
	const block = [`${key}:`, ...values.map((item) => `  - ${yamlString(item)}`)];
	return writeField(frontmatter, key, block.join("\n"));
}

/* ---------- 通用字段：管理端表单要能读写任意 frontmatter 键 ---------- */

export type FieldValue =
	| string
	| number
	| boolean
	| string[]
	| Record<string, string>;

/** 日期写成裸值，加引号会变成字符串，Astro 的 z.date() 还得再 coerce 一次 */
const RAW_KEYS = new Set(["published", "updated"]);

/** 合法键名：字母下划线开头，允许数字与连字符 */
export const KEY_RE: RegExp = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * 整份 frontmatter 读成键值表。
 *
 * 支持三种写法：`key: 值`（标量）、`key:` + `  - 项`（列表）、
 * `key:` + `  k: v`（一层嵌套，provenance 用的就是这个）。
 * 认不出的写法原样跳过——保存时那些行不会被碰，diff 才干净。
 */
export function readAll(frontmatter: string): Record<string, FieldValue> {
	const out: Record<string, FieldValue> = {};
	const lines = frontmatter.split(/\r?\n/);

	for (let i = 0; i < lines.length; i += 1) {
		const match = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(lines[i]);
		if (!match) continue;
		const key = match[1];
		const inline = match[2].trim();

		if (inline.length > 0) {
			if (inline.startsWith("[") && inline.endsWith("]")) {
				out[key] = inline
					.slice(1, -1)
					.split(",")
					.map((part) => unquote(part))
					.filter((part) => part.length > 0);
			} else {
				out[key] = unquote(inline);
			}
			continue;
		}

		// 值是块：往下收集缩进行，列表与映射二选一
		const block: string[] = [];
		let j = i + 1;
		while (j < lines.length && /^[ \t]+\S/.test(lines[j])) {
			block.push(lines[j].replace(/^[ \t]+/, ""));
			j += 1;
		}
		if (block.length === 0) {
			out[key] = "";
			continue;
		}

		if (block.every((line) => line.startsWith("-"))) {
			out[key] = block.map((line) => unquote(line.slice(1)));
		} else {
			const obj: Record<string, string> = {};
			for (const line of block) {
				const nested = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
				if (nested) obj[nested[1]] = unquote(nested[2]);
			}
			out[key] = obj;
		}
		i = j - 1;
	}

	return out;
}

function isEmptyValue(value: FieldValue): boolean {
	if (typeof value === "string") return value.trim().length === 0;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "object") {
		return Object.values(value).every((item) => item.trim().length === 0);
	}
	return false;
}

/**
 * 写一个字段，类型按值推断：字符串走 yamlString、数字与布尔写裸值、
 * 数组写列表块、对象写一层嵌套。传 null 或空值即删除这个键。
 */
export function setField(
	frontmatter: string,
	key: string,
	value: FieldValue | null,
): string {
	if (!KEY_RE.test(key)) return frontmatter;
	if (value === null || isEmptyValue(value)) {
		return writeField(frontmatter, key, null);
	}

	if (typeof value === "string") {
		// 值没变就一个字都不动：否则 `comment: true` 会被重新写成 `comment: "true"`，
		// 语义一样、diff 全是噪声
		if (readScalar(frontmatter, key) === value.trim()) return frontmatter;
		if (RAW_KEYS.has(key))
			return writeField(frontmatter, key, `${key}: ${value.trim()}`);
		return writeField(frontmatter, key, `${key}: ${yamlString(value)}`);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		if (readScalar(frontmatter, key) === String(value)) return frontmatter;
		return writeField(frontmatter, key, `${key}: ${String(value)}`);
	}
	if (Array.isArray(value)) {
		return setList(frontmatter, key, value);
	}

	const block = [`${key}:`];
	for (const [childKey, childValue] of Object.entries(value)) {
		if (!KEY_RE.test(childKey) || childValue.trim().length === 0) continue;
		block.push(`  ${childKey}: ${yamlString(childValue)}`);
	}
	// 子项全空就是 delete 的分支，这里只剩键名本身，直接当空处理
	if (block.length === 1) return writeField(frontmatter, key, null);
	return writeField(frontmatter, key, block.join("\n"));
}
