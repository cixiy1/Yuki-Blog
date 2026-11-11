import { getImage } from "astro:assets";
import { processCoverImageSync } from "@/utils/image-utils";
import { loadLocalImage } from "@/utils/schema-image";
import { getFileDirFromPath, url } from "@/utils/url-utils";

/** 列表卡片上的缩略图不用原图：文章封面常见 1600px 以上，一屏十几张会拖慢 */
export const COVER_THUMB_WIDTH = 480;

/**
 * 把 frontmatter 的 image 解析成管理端能直接放进 `<img>` 的地址。
 *
 * 三种写法都要管：
 * - `./images/x.avif`：Astro 资产引用，原路径在站点上根本不存在，构建期换成真实产物地址
 * - `/assets/x.jpg`：public 下的固定路径，加 BASE_URL 即可
 * - `https://...`：外链原样返回
 *
 * `image: api` 是「随机封面」的约定，交给 processCoverImageSync 换成一个接口地址；
 * 接口挂了由前端 onerror 兜底，这里不做探测。
 */
export async function coverThumb(
	raw: string,
	filePath: string,
): Promise<string> {
	const src = processCoverImageSync(raw, filePath);
	if (!src) return "";
	if (/^(?:https?:)?\/\//i.test(src) || src.startsWith("data:")) return src;
	if (src.startsWith("/")) return url(src);

	const image = await loadLocalImage(src, getFileDirFromPath(filePath || ""));
	if (!image) return "";
	const optimized = await getImage({ src: image, width: COVER_THUMB_WIDTH });
	return optimized.src;
}
