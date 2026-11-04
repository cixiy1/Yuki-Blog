import { api } from "./api";

/**
 * 批量拉文章阅读量。
 *
 * 数据来自外部计数服务（abacus），Worker 侧做了边缘缓存；这里再兜一层：
 * 拿不到就返回空表，卡片上不显示数字。阅读量是装饰性指标，不值得让整个列表报错。
 */
export async function loadPostViews(
	slugs: string[],
	signal?: AbortSignal,
): Promise<Record<string, number>> {
	if (slugs.length === 0) return {};
	try {
		const data = await api.get<{ views?: Record<string, number> }>(
			`/api/admin/post-views?slugs=${encodeURIComponent(slugs.join(","))}`,
			signal,
		);
		return data.views ?? {};
	} catch {
		return {};
	}
}
