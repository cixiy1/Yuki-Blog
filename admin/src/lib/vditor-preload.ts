/**
 * Vditor 的渲染器（lute）有 3.7 MB，第一次打开要等十几秒。
 * 审核员从队列点进正文之前，正好有一段看标题的时间，这段时间把渲染器先拉下来，
 * 点开就只用等本地解析。缓存命中后重复打开是几十毫秒。
 *
 * 只预热这两个文件：lute 是 Markdown 解析内核，zh_CN 是界面文案。
 * 代码高亮样式与字体由 Vditor 自己在渲染时按需加载，体积小，不预拉。
 */
const ASSETS = [
	"/admin/vditor/dist/js/lute/lute.min.js",
	"/admin/vditor/dist/js/i18n/zh_CN.js",
];

let started = false;

export function preloadVditorCore(): void {
	if (started) return;
	started = true;
	for (const href of ASSETS) {
		const link = document.createElement("link");
		link.rel = "preload";
		link.as = "script";
		link.href = href;
		document.head.append(link);
	}
}
