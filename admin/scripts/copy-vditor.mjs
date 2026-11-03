/**
 * Vditor 默认从 CDN 拉运行时资源（lute wasm、图标、i18n、代码高亮、内容主题）。
 * 国内网络拉 unpkg 不可靠，所以自托管到 public/admin/vditor。
 *
 * ⚠️ 目录结构必须保留一层 dist/：Vditor 内部拼的是 `${cdn}/dist/js/...` 与
 * `${cdn}/dist/css/content-theme`，所以 cdn 传 /admin/vditor，文件放在 vditor/dist/ 下。
 *
 * 只拷用得到的部分：diagram 类渲染器（mermaid、echarts、mathjax 等）合计 20MB 以上。
 * 这里只留 mermaid —— 站内文章的图表全是 ```mermaid，编辑器不渲染就得等构建才知道画成什么样。
 * 其余（echarts、graphviz、plantuml、mathjax…）不拷。lute、icons、i18n、highlight.js、katex、css 必须留。
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../node_modules/vditor/dist");
const root = join(here, "../../public/admin/vditor");
const target = join(root, "dist");

const FILES = ["index.min.js", "index.css"];
const DIRS = [
	"images",
	"css",
	"js/lute",
	"js/icons",
	"js/highlight.js",
	"js/katex",
	"js/mermaid",
];
const SINGLE_JS = ["js/i18n/zh_CN.js"];

await rm(root, { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const file of FILES) {
	await cp(join(source, file), join(target, file));
}
for (const dir of DIRS) {
	await cp(join(source, dir), join(target, dir), { recursive: true });
}
for (const file of SINGLE_JS) {
	await mkdir(dirname(join(target, file)), { recursive: true });
	await cp(join(source, file), join(target, file));
}

console.log("[admin] Vditor 资源已拷到 public/admin/vditor/dist");
