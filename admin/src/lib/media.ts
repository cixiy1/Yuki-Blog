import { api } from "./api";
import { prepareImage } from "./image";

/**
 * 媒体库：图存在仓库里（`public/assets/uploads/...`），不再是 D1 blob。
 *
 * 为什么不走 D1：草稿阶段存 blob 只在 Worker 里活着，导出、迁移、换部署全废；
 * 而仓库里的文件构建完就是站内静态资源，CDN 直出、能被 git 管、能用图片优化。
 */
export interface MediaFile {
	/** 仓库路径，删除时用它 */
	path: string;
	/** 预览/直出地址：站内静态路径，或文章内嵌图的 raw 地址 */
	url: string;
	/** 写进正文或 frontmatter 的引用 */
	ref: string;
	origin: "public" | "content";
	name: string;
	bytes: number;
	ext: string;
	at: number;
	/**
	 * 刚提交进仓库、站点还没重新构建：直出地址此刻是 404。
	 * 只在本次会话内为真，刷新页面后就是普通文件了。
	 */
	pending?: boolean;
}

export interface MediaIndex {
	files: MediaFile[];
	/** 文件名 → 引用它的文章 slug */
	refs: Record<string, string[]>;
	generated: number;
	live: boolean;
}

export async function listMedia(refresh = false): Promise<MediaIndex> {
	const path = refresh ? "/api/media/library?refresh=1" : "/api/media/library";
	const data = await api.get<MediaIndex>(path);
	return {
		files: data.files ?? [],
		refs: data.refs ?? {},
		generated: data.generated ?? 0,
		live: data.live === true,
	};
}

interface UploadResponse {
	created?: MediaFile[];
	reused?: MediaFile[];
	commit?: string | null;
}

/**
 * 选中的文件先在浏览器里压一道再上传；一批合并成一次提交（一次构建）。
 * 服务端按内容摘要命名，同一张图重复传会直接复用。
 */
export async function uploadMediaFiles(files: File[]): Promise<{
	created: MediaFile[];
	reused: MediaFile[];
	commit: string | null;
}> {
	const prepared: Array<{ name: string; mime: string; data: string }> = [];
	for (const file of files) {
		const image = await prepareImage(file);
		prepared.push({
			name: file.name || `image-${Date.now()}`,
			mime: guessMime(file, image.mime),
			data: image.data,
		});
	}
	const data = await api.post<UploadResponse>("/api/media/upload", {
		files: prepared,
	});
	return {
		// 新提交的文件要等这次构建完才能打开，标出来让网格显示「构建中」而不是「读不到」
		created: (data.created ?? []).map((file) => ({ ...file, pending: true })),
		reused: data.reused ?? [],
		commit: data.commit ?? null,
	};
}

/** 小文件原样上传时 File.type 可能是空的，按扩展名兜一下，别白丢一次请求 */
function guessMime(file: File, mime: string): string {
	if (mime.startsWith("image/")) return mime;
	const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
	const map: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		webp: "image/webp",
		gif: "image/gif",
		avif: "image/avif",
		svg: "image/svg+xml",
	};
	return map[ext] ?? mime;
}

export async function deleteMediaFile(path: string): Promise<void> {
	await api.delete<{ ok: boolean }>("/api/media/library", { path });
}

/**
 * 编辑器插图：单张上传，返回可直接写进 markdown 的地址。
 * 打包成一批是常态，单张只是它的简化用法。
 */
export async function uploadImage(file: File): Promise<{
	url: string;
	path: string;
	name: string;
	bytes: number;
}> {
	const result = await uploadMediaFiles([file]);
	const file0 = result.created[0] ?? result.reused[0];
	if (!file0) throw new Error("上传没有返回文件信息");
	return {
		url: file0.ref,
		path: file0.path,
		name: file0.name,
		bytes: file0.bytes,
	};
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
