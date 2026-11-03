import { getSortedPosts } from "@/utils/content-utils";

/**
 * 仓库里已有文章的元数据索引，给管理端「我的文章」用。
 *
 * 这些文章是在用户系统之前写的，从来没进过 D1（草稿 → 审核 → 发布那条链）。
 * Worker 读不到 git，所以构建期把 frontmatter 压成一份静态 JSON，
 * 由 `/api/me/posts` 读出来合并进列表，否则管理端只能看到自己新建的草稿。
 */
export async function GET(): Promise<Response> {
	const posts = await getSortedPosts();

	const data = posts
		.filter((post) => !post.data.draft)
		.map((post) => ({
			slug: post.id,
			title: post.data.title,
			description: post.data.description,
			published: post.data.published.getTime(),
			updated: post.data.updated?.getTime() ?? null,
			tags: post.data.tags,
			category: post.data.category ?? "",
			series: post.data.series,
			cover: post.data.image,
			sourceLink: post.data.sourceLink,
			author: post.data.author,
			repoPath: post.filePath ?? "",
		}));

	return new Response(JSON.stringify(data), {
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
