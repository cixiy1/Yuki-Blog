import { statsConfig } from "@/config/statsConfig";

/**
 * 计数服务的接入信息，给 Worker 侧的浏览量代理用。
 *
 * 这些值写在 `src/config/statsConfig.ts` 里，Worker 读不到 src，所以构建期导出一份
 * 静态 JSON。⚠️ 别再在 Worker 里抄一份常量：换 namespace 等于换一套计数器，
 * 两处不一致会出现「管理端显示 0、前台有数字」这种最难查的错。
 */
export async function GET(): Promise<Response> {
	return new Response(
		JSON.stringify({
			enable: statsConfig.enable,
			apiBase: statsConfig.apiBase,
			namespace: statsConfig.namespace,
		}),
		{
			headers: {
				"content-type": "application/json; charset=utf-8",
				// 构建产物，跟着部署走即可
				"cache-control": "public, max-age=3600",
			},
		},
	);
}
