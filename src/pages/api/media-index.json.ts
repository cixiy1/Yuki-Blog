import fs from "node:fs";
import path from "node:path";

/**
 * 仓库里图片资源的索引，给管理端「媒体库」和统一选择器用。
 *
 * Worker 读不到 git，所以和 `post-index.json` 一样：构建期把目录扫一遍压成静态
 * JSON，Worker 只读这份快照。上传新图之后快照是旧的，管理端可以点「刷新索引」
 * 走 GitHub 的 tree 接口现拉一份。
 *
 * 只扫有内容的目录：`public/pio`（live2d 贴图）、`public/admin`（构建产物）、
 * `public/favicon` 这些扫进来全是噪音，还会把选择器撑爆。
 */
const ROOTS: Array<{ dir: string; origin: "public" | "content" }> = [
	{ dir: "public/assets", origin: "public" },
	{ dir: "public/gallery", origin: "public" },
	{ dir: "public/files", origin: "public" },
	{ dir: "src/content/posts/images", origin: "content" },
];

const IMAGE_EXT = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".avif",
	".svg",
	".ico",
]);

const POSTS_DIR = "src/content/posts";
const REPO = "cixiy1/Yuki-blog";
const BRANCH = "main";

export interface MediaEntry {
	/** 仓库内路径，删除与提交都用它 */
	path: string;
	/** 预览地址：public 走站内静态路径，content 走 GitHub raw */
	url: string;
	/** 可直接写进正文或 frontmatter 的引用 */
	ref: string;
	origin: "public" | "content";
	name: string;
	bytes: number;
	ext: string;
	/** 文件修改时间（毫秒），列表按它倒序 */
	at: number;
}

export interface MediaIndex {
	generated: number;
	files: MediaEntry[];
	/** 文件名 → 引用它的文章 slug，删除前用它拦一下 */
	refs: Record<string, string[]>;
}

function walk(dir: string, out: string[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		// 目录不存在（比如还没人传过图）就跳过
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, out);
			continue;
		}
		if (entry.isFile()) out.push(full);
	}
}

function toEntry(
	full: string,
	origin: "public" | "content",
): MediaEntry | null {
	const ext = path.extname(full).toLowerCase();
	if (!IMAGE_EXT.has(ext)) return null;

	const repoPath = full.split(path.sep).join("/");
	let stat: fs.Stats;
	try {
		stat = fs.statSync(full);
	} catch {
		return null;
	}

	const isPublic = origin === "public";
	return {
		path: repoPath,
		url: isPublic
			? `/${repoPath.replace(/^public\//, "")}`
			: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${repoPath}`,
		// 文章里的相对路径按文章所在目录解析，posts 目录下就是 ./images/...
		ref: isPublic
			? `/${repoPath.replace(/^public\//, "")}`
			: `./${repoPath.replace(/^src\/content\/posts\//, "")}`,
		origin,
		name: path.basename(full),
		bytes: stat.size,
		ext: ext.slice(1),
		at: Math.round(stat.mtimeMs),
	};
}

/** 文章 slug：frontmatter 里写了就用它，否则用文件名（glob loader 的默认行为） */
function postSlug(file: string, source: string): string {
	const match = source.match(/^slug:\s*["']?([^"'\n]+)["']?\s*$/m);
	if (match?.[1]?.trim()) return match[1].trim();
	return path.basename(file).replace(/\.mdx?$/, "");
}

function collectRefs(files: MediaEntry[]): Record<string, string[]> {
	const posts: string[] = [];
	walk(POSTS_DIR, posts);

	const names = files.map((file) => file.name);
	const refs: Record<string, string[]> = {};

	for (const post of posts) {
		if (!/\.mdx?$/.test(post)) continue;
		let source: string;
		try {
			source = fs.readFileSync(post, "utf8");
		} catch {
			continue;
		}
		const slug = postSlug(post, source);
		for (const name of names) {
			// 按文件名匹配：封面 `./images/x.avif` 和正文插图都只是路径里的最后一段
			if (!source.includes(name)) continue;
			const list = refs[name];
			if (!list) refs[name] = [slug];
			else if (!list.includes(slug)) list.push(slug);
		}
	}
	return refs;
}

export async function GET(): Promise<Response> {
	const files: MediaEntry[] = [];
	for (const root of ROOTS) {
		const found: string[] = [];
		walk(root.dir, found);
		for (const full of found) {
			const entry = toEntry(full, root.origin);
			if (entry) files.push(entry);
		}
	}
	files.sort((a, b) => b.at - a.at);

	const data: MediaIndex = {
		generated: Date.now(),
		files,
		refs: collectRefs(files),
	};

	return new Response(JSON.stringify(data), {
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
