import { getImage } from "astro:assets";
import { getSortedPosts } from "@/utils/content-utils";
import { processCoverImageSync } from "@/utils/image-utils";
import { loadLocalImage } from "@/utils/schema-image";
import { getFileDirFromPath, url } from "@/utils/url-utils";

/** 列表卡片上的缩略图不用原图：文章封面常见 1600px 以上，一屏十几张会拖慢 */
const COVER_THUMB_WIDTH = 480;

/**
 * 把 frontmatter 的 image 解析成管理端能直接放进 <img> 的地址。
 *
 * 三种写法都要管：
 * - `./images/x.avif`：Astro 资产引用，原路径在站点上根本不存在，构建期换成真实产物地址
 * - `/assets/x.jpg`：public 下的固定路径，加 BASE_URL 即可
 * - `https://...`：外链原样返回
 *
 * `image: api` 是「随机封面」的约定，交给 processCoverImageSync 换成一个接口地址；
 * 接口挂了由前端 onerror 兜底，这里不做探测。
 */
async function coverThumb(raw: string, filePath: string): Promise<string> {
	const src = processCoverImageSync(raw, filePath);
	if (!src) return "";
	if (/^(?:https?:)?\/\//i.test(src) || src.startsWith("data:")) return src;
	if (src.startsWith("/")) return url(src);

	const image = await loadLocalImage(src, getFileDirFromPath(filePath || ""));
	if (!image) return "";
	const optimized = await getImage({ src: image, width: COVER_THUMB_WIDTH });
	return optimized.src;
}

/**
 * 仓库里已有文章的元数据索引，给管理端「我的文章」用。
 *
 * 这些文章是在用户系统之前写的，从来没进过 D1（草稿 → 审核 → 发布那条链）。
 * Worker 读不到 git，所以构建期把 frontmatter 压成一份静态 JSON，
 * 由 `/api/me/posts` 读出来合并进列表，否则管理端只能看到自己新建的草稿。
 */
export async function GET(): Promise<Response> {
	const posts = await getSortedPosts();

	const data = await Promise.all(
		posts
			.filter((post) => !post.data.draft)
			.map(async (post) => ({
				slug: post.id,
				title: post.data.title,
				description: post.data.description,
				published: post.data.published.getTime(),
				updated: post.data.updated?.getTime() ?? null,
				tags: post.data.tags,
				category: post.data.category ?? "",
				series: post.data.series,
				// 编辑页选系列时要看同系列里哪些序号已被占用
				seriesOrder: post.data.seriesOrder ?? null,
				cover: await coverThumb(post.data.image, post.filePath ?? ""),
				sourceLink: post.data.sourceLink,
				author: post.data.author,
				repoPath: post.filePath ?? "",
			})),
	);

	return new Response(JSON.stringify(data), {
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
