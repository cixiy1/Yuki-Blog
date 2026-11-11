/**
 * 媒体库：仓库里的图片资源。
 *
 * 数据来源有两条：
 *  - 构建期快照 `/api/media-index.json`（快、不带令牌、但只反映上次构建）
 *  - GitHub tree 接口现拉（准、要多一次请求，「刷新索引」和上传去重时用）
 *
 * 写操作只有上传与删除，都合并成一次 commit（`putRepoFiles`），
 * 避免一张图一次构建。
 */
import { sha256HexBytes } from "./crypto";
import {
	listRepoTree,
	putRepoFiles,
	type RepoFileChange,
	readRepoFile,
	safeRepoPath,
} from "./github-contents";
import { readSecret } from "./site-config";

const ASSETS_KEY = "https://assets.local/api/media-index.json";
const TTL_MS = 60_000;

export const MEDIA_REPO = "cixiy1/Yuki-blog";
export const MEDIA_BRANCH = "main";

/**
 * 只扫这几个目录。`public/pio`（live2d 贴图）、`public/admin`（构建产物）、
 * `public/favicon` 扫进来全是噪音。
 * 与 `src/pages/api/media-index.json.ts` 的 ROOTS 保持一致——那边是构建期扫盘，
 * 这边是运行时解析远端路径，两边都得认得同一批目录。
 */
export const MEDIA_ROOTS = [
	"public/assets/",
	"public/gallery/",
	"public/files/",
	"src/content/posts/images/",
] as const;

export const MEDIA_EXT: Set<string> = new Set([
	"png",
	"jpg",
	"jpeg",
	"webp",
	"gif",
	"avif",
	"svg",
	"ico",
]);

/** 上传落点：`public/assets/uploads/<yyyy>/<mm>/` */
export const UPLOAD_PREFIX = "public/assets/uploads/";

export interface MediaEntry {
	path: string;
	url: string;
	ref: string;
	origin: "public" | "content";
	name: string;
	bytes: number;
	ext: string;
	at: number;
}

export interface MediaIndex {
	generated: number;
	files: MediaEntry[];
	refs: Record<string, string[]>;
}

let cached: { at: number; data: MediaIndex } | null = null;

export async function readMediaIndex(
	assets: AssetsFetcher,
): Promise<MediaIndex> {
	if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

	try {
		const res = await assets.fetch(new URL(ASSETS_KEY));
		if (!res.ok) return cached?.data ?? { generated: 0, files: [], refs: {} };
		const data = (await res.json()) as MediaIndex;
		cached = { at: Date.now(), data };
		return data;
	} catch {
		// 构建产物缺失（本地还没 build）时给空索引，别让页面整个挂掉
		return cached?.data ?? { generated: 0, files: [], refs: {} };
	}
}

export function resetMediaCache(): void {
	cached = null;
}

export async function resolveGithubToken(env: Env): Promise<string | null> {
	return readSecret(env.DB, env.PASSWORD_ENC_KEY ?? "", "github_token");
}

/** 仓库路径 → 预览地址、可插入引用、来源；不认识的路径返回 null */
export function describePath(repoPath: string): MediaEntry | null {
	const ext = repoPath.slice(repoPath.lastIndexOf(".") + 1).toLowerCase();
	if (!MEDIA_EXT.has(ext)) return null;
	const root = MEDIA_ROOTS.find((prefix) => repoPath.startsWith(prefix));
	if (!root) return null;

	const isPublic = root.startsWith("public/");
	return {
		path: repoPath,
		url: isPublic
			? `/${repoPath.replace(/^public\//, "")}`
			: `https://raw.githubusercontent.com/${MEDIA_REPO}/${MEDIA_BRANCH}/${repoPath}`,
		ref: isPublic
			? `/${repoPath.replace(/^public\//, "")}`
			: `./${repoPath.replace(/^src\/content\/posts\//, "")}`,
		origin: isPublic ? "public" : "content",
		name: repoPath.slice(repoPath.lastIndexOf("/") + 1),
		bytes: 0,
		ext,
		at: 0,
	};
}

/** 现拉一份远端索引；失败时返回错误信息而不是空列表，免得被当成「仓库空了」 */
export async function fetchLiveMedia(token: string): Promise<{
	ok: boolean;
	status: number;
	message?: string;
	entries: MediaEntry[];
}> {
	const tree = await listRepoTree({
		repo: MEDIA_REPO,
		branch: MEDIA_BRANCH,
		token,
	});
	if (!tree.ok) {
		return {
			ok: false,
			status: tree.status,
			message: tree.message ?? "读取仓库目录失败",
			entries: [],
		};
	}

	const entries: MediaEntry[] = [];
	for (const item of tree.entries) {
		const entry = describePath(item.path);
		if (!entry) continue;
		entries.push({ ...entry, bytes: item.bytes });
	}
	return { ok: true, status: 200, entries };
}

/* ------------------------------- 上传 ------------------------------- */

export interface IncomingFile {
	/** 原始文件名，只用来取个可读的词干 */
	name: string;
	mime: string;
	bytes: Uint8Array;
}

const MIME_EXT: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/avif": "avif",
	"image/svg+xml": "svg",
};

export const MAX_UPLOAD_FILES: number = 20;
export const MAX_UPLOAD_BYTES: number = 5 * 1024 * 1024;

/** 扩展名只认 mime，不信客户端给的文件名 */
export function extForMime(mime: string): string | null {
	return MIME_EXT[mime.toLowerCase()] ?? null;
}

function headAscii(bytes: Uint8Array, start: number, end: number): string {
	let out = "";
	for (let i = start; i < Math.min(end, bytes.byteLength); i += 1) {
		out += String.fromCharCode(bytes[i] as number);
	}
	return out;
}

/**
 * 按魔数认图片格式。
 *
 * 客户端的 mime 会说谎：Safari 的 canvas 编不出 webp，`toBlob(…, "image/webp")`
 * 直接退回 PNG，前端拿到的 blob 类型也照旧写着 webp。按 mime 取扩展名就会写出
 * 一个 `.webp` 的 PNG——手机相册、图片优化、部分浏览器都按声明格式解，解不出来。
 * 所以以实际字节为准，mime 只做兜底。
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
	if (
		bytes.byteLength >= 8 &&
		bytes[0] === 0x89 &&
		headAscii(bytes, 1, 4) === "PNG"
	) {
		return "image/png";
	}
	if (
		bytes.byteLength >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "image/jpeg";
	}
	if (bytes.byteLength >= 4 && headAscii(bytes, 0, 4) === "GIF8")
		return "image/gif";
	if (
		bytes.byteLength >= 12 &&
		headAscii(bytes, 0, 4) === "RIFF" &&
		headAscii(bytes, 8, 12) === "WEBP"
	) {
		return "image/webp";
	}
	if (bytes.byteLength >= 12 && headAscii(bytes, 4, 8) === "ftyp") {
		const brand = headAscii(bytes, 8, 12);
		if (brand === "avif" || brand === "avis") return "image/avif";
	}
	// SVG 是文本，没有魔数：跳过空白后以 `<` 开头、前 512 字节里出现 `<svg` 就算
	const probe = headAscii(bytes, 0, 512).trimStart();
	if (probe.startsWith("<") && probe.includes("<svg")) return "image/svg+xml";
	return null;
}

/**
 * 词干只留 ASCII：仓库里已有路径全是英文，中文文件名会把 git 路径、
 * CDN 缓存、各种工具链都带进不必要的麻烦里。
 */
export function slugStem(name: string): string {
	const base = name.replace(/\.[^.]+$/, "");
	const ascii = base
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
	return ascii || "image";
}

function uploadDir(now: Date): string {
	const yyyy = String(now.getUTCFullYear());
	const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
	return `${UPLOAD_PREFIX}${yyyy}/${mm}/`;
}

export interface UploadResult {
	ok: boolean;
	status: number;
	message?: string;
	commit?: string;
	/** 本次真正写进提交的条目 */
	created: MediaEntry[];
	/** 内容相同、已经存在的条目（按内容寻址，文件名一样就是同一张图） */
	reused: MediaEntry[];
}

/**
 * 上传：文件名带内容摘要（`<词干>-<sha8>.<ext>`），同一张图重复上传会落到
 * 同一个路径，直接复用，仓库不会越长越胖。
 */
export async function uploadMedia(input: {
	token: string;
	files: IncomingFile[];
	actorUid: number;
}): Promise<UploadResult> {
	const { token, files } = input;
	if (files.length === 0) {
		return {
			ok: false,
			status: 400,
			message: "没有收到文件",
			created: [],
			reused: [],
		};
	}
	if (files.length > MAX_UPLOAD_FILES) {
		return {
			ok: false,
			status: 413,
			message: `一次最多传 ${MAX_UPLOAD_FILES} 张`,
			created: [],
			reused: [],
		};
	}

	// 先算路径：内容摘要决定文件名，所以不用问 GitHub 就知道会不会重名
	const dir = uploadDir(new Date());
	const planned: Array<{ entry: MediaEntry; bytes: Uint8Array }> = [];
	for (const file of files) {
		// 实际字节优先，客户端声明的 mime 只当兜底
		const mime = sniffImageMime(file.bytes) ?? file.mime;
		const ext = extForMime(mime);
		if (!ext) {
			return {
				ok: false,
				status: 415,
				message: `不支持的图片格式：${mime || "未知"}`,
				created: [],
				reused: [],
			};
		}
		if (file.bytes.byteLength === 0) {
			return {
				ok: false,
				status: 400,
				message: "文件是空的",
				created: [],
				reused: [],
			};
		}
		if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
			return {
				ok: false,
				status: 413,
				message: `${file.name} 超过 5 MB，先压缩再传`,
				created: [],
				reused: [],
			};
		}
		const digest = (await sha256HexBytes(file.bytes)).slice(0, 8);
		const path = `${dir}${slugStem(file.name)}-${digest}.${ext}`;
		const described = describePath(path);
		if (!described) {
			return {
				ok: false,
				status: 400,
				message: "生成的路径不合法",
				created: [],
				reused: [],
			};
		}
		planned.push({
			entry: { ...described, bytes: file.bytes.byteLength, at: Date.now() },
			bytes: file.bytes,
		});
	}

	// 远端已经有了就跳过（一次 tree 请求换掉「重复上传」和「路径撞车」两个问题）
	const live = await fetchLiveMedia(token);
	if (!live.ok) {
		return {
			ok: false,
			status: live.status || 502,
			message: live.message ?? "读取仓库目录失败",
			created: [],
			reused: [],
		};
	}
	const existing = new Map(live.entries.map((entry) => [entry.path, entry]));

	const created: MediaEntry[] = [];
	const reused: MediaEntry[] = [];
	const changes: RepoFileChange[] = [];
	const seen = new Set<string>();

	for (const item of planned) {
		if (seen.has(item.entry.path)) continue;
		seen.add(item.entry.path);
		const hit = existing.get(item.entry.path);
		if (hit) {
			reused.push(hit);
			continue;
		}
		created.push(item.entry);
		changes.push({ path: item.entry.path, bytes: item.bytes });
	}

	if (changes.length === 0) {
		return { ok: true, status: 200, created, reused };
	}

	const label =
		created.length === 1 ? created[0].name : `${created.length} 张图片`;
	const result = await putRepoFiles({
		repo: MEDIA_REPO,
		branch: MEDIA_BRANCH,
		files: changes,
		message: `chore(media): 上传 ${label}`,
		token,
	});
	if (!result.ok) {
		return {
			ok: false,
			status: result.status,
			message: result.message,
			created: [],
			reused,
		};
	}

	// 新鲜的文件立刻进内存索引，不用等下一次构建
	if (cached) {
		const merged = [...created, ...cached.data.files];
		merged.sort((a, b) => b.at - a.at);
		cached = { at: Date.now(), data: { ...cached.data, files: merged } };
	}

	return { ok: true, status: 201, commit: result.commit, created, reused };
}

/* ------------------------------- 删除 ------------------------------- */

export interface DeleteResult {
	ok: boolean;
	status: number;
	message?: string;
	commit?: string;
	/** 还在引用这张图的文章 */
	usedBy?: string[];
}

export async function deleteMedia(input: {
	env: Env;
	token: string;
	path: string;
}): Promise<DeleteResult> {
	const { env, token, path } = input;

	const safe = safeRepoPath(path);
	if (!safe || !MEDIA_ROOTS.some((prefix) => safe.startsWith(prefix))) {
		return { ok: false, status: 400, message: "这个路径不在媒体目录里" };
	}

	const index = await readMediaIndex(env.ASSETS);
	const name = safe.slice(safe.lastIndexOf("/") + 1);
	const usedBy = index.refs[name] ?? [];
	if (usedBy.length > 0) {
		return {
			ok: false,
			status: 409,
			message: `还有 ${usedBy.length} 篇文章在用它`,
			usedBy,
		};
	}

	const result = await putRepoFiles({
		repo: MEDIA_REPO,
		branch: MEDIA_BRANCH,
		files: [{ path: safe, remove: true }],
		message: `chore(media): 删除 ${name}`,
		token,
	});
	if (!result.ok) {
		return { ok: false, status: result.status, message: result.message };
	}

	if (cached) {
		cached = {
			at: cached.at,
			data: {
				...cached.data,
				files: cached.data.files.filter((entry) => entry.path !== safe),
			},
		};
	}

	return { ok: true, status: 200, commit: result.commit };
}

/* ------------------------------- 替换 ------------------------------- */

/** 构建期文章索引，给 slug → 仓库路径的映射用 */
const POST_INDEX_KEY = "https://assets.local/api/post-index.json";

/** 可能引用图片的配置文件；系列封面就写在里面 */
const CONFIG_FILES = ["config/site.json", "config/series.json"] as const;

/** 一次替换最多改多少个文件，防止异常情况下狂读仓库 */
const MAX_REF_FILES = 24;

export interface ReplaceResult {
	ok: boolean;
	status: number;
	message?: string;
	commit?: string;
	/** 换上去的新文件 */
	entry?: MediaEntry;
	/** 跟着改了引用的文件（仓库路径） */
	updated: string[];
	/** 在索引里但找不到对应文章文件、没法自动改的 slug */
	unresolved: string[];
}

async function readPostPaths(
	assets: AssetsFetcher,
): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	try {
		const res = await assets.fetch(new URL(POST_INDEX_KEY));
		if (!res.ok) return map;
		const data = (await res.json()) as Array<{
			slug?: string;
			repoPath?: string;
		}>;
		for (const post of data) {
			if (post.slug && post.repoPath) map.set(post.slug, post.repoPath);
		}
	} catch {
		// 索引缺失时只改配置文件，文章引用留着不动
	}
	return map;
}

/**
 * 替换一张图：新文件落在旧文件同目录，然后把所有引用改成新文件名，旧文件删掉。
 *
 * 为什么留在同目录：文章内嵌图写的是相对路径（`./images/x.webp`），
 * 换到别的目录后相对路径就错了；同目录只改文件名，引用形态不用动。
 * 为什么文件名里带内容摘要还能改：摘要只是文件名的一部分，引用按字符串替换，
 * 旧名字里的摘要换成新的就完事。
 *
 * 找不到对应文件的引用方（比如只存在于 D1 草稿里的引用）会列在 `unresolved` 里，
 * 页面上要提示一句，不然草稿里的图会静默断掉。
 */
export async function replaceMedia(input: {
	env: Env;
	token: string;
	path: string;
	file: IncomingFile;
}): Promise<ReplaceResult> {
	const { env, token, file } = input;
	const empty = { updated: [] as string[], unresolved: [] as string[] };

	const safe = safeRepoPath(input.path);
	if (!safe || !MEDIA_ROOTS.some((prefix) => safe.startsWith(prefix))) {
		return {
			ok: false,
			status: 400,
			message: "这个路径不在媒体目录里",
			...empty,
		};
	}
	const oldEntry = describePath(safe);
	if (!oldEntry) {
		return {
			ok: false,
			status: 400,
			message: "这个路径不是图片",
			...empty,
		};
	}
	if (file.bytes.byteLength === 0) {
		return { ok: false, status: 400, message: "文件是空的", ...empty };
	}
	if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
		return {
			ok: false,
			status: 413,
			message: `${file.name} 超过 5 MB，先压缩再传`,
			...empty,
		};
	}

	const mime = sniffImageMime(file.bytes) ?? file.mime;
	const ext = extForMime(mime);
	if (!ext) {
		return {
			ok: false,
			status: 415,
			message: `不支持的图片格式：${mime || "未知"}`,
			...empty,
		};
	}

	const dir = safe.slice(0, safe.lastIndexOf("/") + 1);
	const digest = (await sha256HexBytes(file.bytes)).slice(0, 8);
	const nextPath = `${dir}${slugStem(file.name || oldEntry.name)}-${digest}.${ext}`;
	const nextEntry = describePath(nextPath);
	if (!nextEntry) {
		return { ok: false, status: 400, message: "生成的新路径不合法", ...empty };
	}

	// 同一张图重传一次：内容摘要一样，路径不变，什么都不用做
	if (nextPath === safe) {
		return {
			ok: true,
			status: 200,
			message: "内容和现在这张一样，没有改动",
			entry: oldEntry,
			...empty,
		};
	}

	const index = await readMediaIndex(env.ASSETS);
	const slugs = index.refs[oldEntry.name] ?? [];
	const postPaths = await readPostPaths(env.ASSETS);

	const targets = new Set<string>(CONFIG_FILES);
	const unresolved: string[] = [];
	for (const slug of slugs) {
		const repoPath = postPaths.get(slug);
		if (repoPath) targets.add(repoPath);
		else unresolved.push(slug);
	}

	// 长串在前：站内地址包含文件名，先换整条地址再换文件名，结果一致但更稳
	const pairs: Array<[string, string]> = [
		[safe, nextPath],
		[oldEntry.url, nextEntry.url],
	];
	if (oldEntry.name !== nextEntry.name) {
		pairs.push([oldEntry.name, nextEntry.name]);
	}

	const updated: string[] = [];
	const changes: RepoFileChange[] = [
		{ path: nextPath, bytes: file.bytes },
		{ path: safe, remove: true },
	];

	for (const target of [...targets].slice(0, MAX_REF_FILES)) {
		const read = await readRepoFile({
			repo: MEDIA_REPO,
			path: target,
			branch: MEDIA_BRANCH,
			token,
		});
		if (!read.ok || read.content === null) continue;

		let text = read.content;
		for (const [from, to] of pairs) {
			if (from && text.includes(from)) text = text.split(from).join(to);
		}
		if (text === read.content) continue;

		updated.push(target);
		changes.push({ path: target, bytes: new TextEncoder().encode(text) });
	}

	const result = await putRepoFiles({
		repo: MEDIA_REPO,
		branch: MEDIA_BRANCH,
		files: changes,
		message: `chore(media): 替换 ${oldEntry.name} → ${nextEntry.name}`,
		token,
	});
	if (!result.ok) {
		return {
			ok: false,
			status: result.status,
			message: result.message,
			updated,
			unresolved,
		};
	}

	// 新图与旧图同步进内存索引，不用等下一次构建
	if (cached) {
		cached = {
			at: Date.now(),
			data: {
				...cached.data,
				files: [
					{ ...nextEntry, bytes: file.bytes.byteLength, at: Date.now() },
					...cached.data.files.filter((entry) => entry.path !== safe),
				],
			},
		};
	}

	return {
		ok: true,
		status: 200,
		commit: result.commit,
		entry: nextEntry,
		updated,
		unresolved,
	};
}
