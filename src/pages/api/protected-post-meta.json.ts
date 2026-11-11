import { getPostsForPaths } from "@/utils/content-utils";
import { coverThumb } from "@/utils/cover-thumb";

/**
 * 受限文章（visibility 不是 public）的元数据快照，给管理端「我的文章」用。
 *
 * 为什么单独开一份：公开的 `/api/post-index.json` 必须把它们摘掉——那份文件是
 * 静态资源，谁都能读，带着标题出去就等于没保护。但作者还得能在后台找到、编辑
 * 它们，所以这里再产出一份，走 `/api/*`（Worker 在前），非管理员拿不到。
 *
 * 形状与 post-index.json 一致，前端不用分两套结构；多出来的 `visibility`
 * 只是给列表上的标签用。
 */
export async function GET(): Promise<Response> {
	const posts = await getPostsForPaths();

	const data = await Promise.all(
		posts
			.filter((post) => !post.data.draft && post.data.visibility !== "public")
			.map(async (post) => ({
				slug: post.id,
				title: post.data.title,
				description: post.data.description,
				published: post.data.published.getTime(),
				updated: post.data.updated?.getTime() ?? null,
				tags: post.data.tags,
				category: post.data.category ?? "",
				series: post.data.series,
				seriesOrder: post.data.seriesOrder ?? null,
				cover: await coverThumb(post.data.image, post.filePath ?? ""),
				sourceLink: post.data.sourceLink,
				author: post.data.author,
				repoPath: post.filePath ?? "",
				visibility: post.data.visibility,
			})),
	);

	return new Response(JSON.stringify(data), {
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
