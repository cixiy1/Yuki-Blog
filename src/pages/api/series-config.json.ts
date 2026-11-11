import { seriesDefaultLayout, seriesOverrides } from "@/config/seriesConfig";

/**
 * 系列封面配置的构建期快照，给管理端「系列管理」读。
 *
 * 配置真身是仓库里的 `config/series.json`，Worker 运行时读不到文件系统，
 * 所以这里在构建时导出一份。管理端保存时直接改仓库文件、触发构建，
 * 新值要等这次构建完才会出现在这里——保存成功的响应会带回新配置，页面先用它。
 */
export async function GET(): Promise<Response> {
	return new Response(
		JSON.stringify({
			defaultLayout: seriesDefaultLayout,
			series: seriesOverrides,
			generated: Date.now(),
		}),
		{
			headers: {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "public, max-age=60",
			},
		},
	);
}
