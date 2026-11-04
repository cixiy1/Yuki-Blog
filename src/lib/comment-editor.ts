/**
 * 评论输入框：复用管理端那套 Vditor。
 *
 * 不从 npm 引：Vditor 只是 admin 的依赖，根项目里没有；而且 300 KB 脚本
 * 加 3.7 MB 的 Markdown 内核不该跟着每篇文章一起下发。
 * 这里从 /admin/vditor/dist 按需拉，点开输入框才加载，拉不到就退回纯文本框。
 */

interface VditorInstance {
	getValue(): string;
	setValue(value: string): void;
	focus(): void;
	destroy(): void;
	setTheme(theme: "classic" | "dark", contentTheme?: "light" | "dark"): void;
}

type VditorCtor = new (
	element: HTMLElement,
	options: Record<string, unknown>,
) => VditorInstance;

export interface CommentEditorOptions {
	/** 内容变化时回调，用来刷字数统计 */
	onInput: (value: string) => void;
}

export interface CommentEditor {
	read(): string;
	clear(): void;
	focus(): void;
	/** 容器是否还在文档里：站内跳转换掉评论容器后，旧实例要销毁 */
	alive(): boolean;
	destroy(): void;
}

const BASE = "/admin/vditor";
const SCRIPT_SRC = `${BASE}/dist/index.min.js`;
const STYLE_HREF = `${BASE}/dist/index.css`;
/** 3.7 MB 的内核在慢网下要等很久，超过这个时间就当加载失败，退回文本框 */
const LOAD_TIMEOUT = 12_000;

/** 评论只要这些按钮：标题、表格、上传都不该出现在留言里 */
const TOOLBAR: string[] = [
	"emoji",
	"bold",
	"italic",
	"strike",
	"|",
	"list",
	"ordered-list",
	"quote",
	"|",
	"inline-code",
	"link",
	"|",
	"undo",
	"redo",
];

/** 手机上工具栏会折三行，砍掉撤销与表情，压到两行 */
const COMPACT_TOOLBAR: string[] = [
	"bold",
	"italic",
	"strike",
	"|",
	"list",
	"ordered-list",
	"quote",
	"|",
	"inline-code",
	"link",
];

function pickToolbar(): string[] {
	return window.matchMedia("(max-width: 640px)").matches
		? COMPACT_TOOLBAR
		: TOOLBAR;
}

let assetPromise: Promise<VditorCtor> | null = null;

function isDark(): boolean {
	return document.documentElement.classList.contains("dark");
}

function injectStyle(): void {
	if (document.querySelector("link[data-yb-vditor]")) return;
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = STYLE_HREF;
	link.dataset.ybVditor = "1";
	document.head.append(link);
}

function injectScript(): Promise<VditorCtor> {
	const global = window as unknown as { Vditor?: VditorCtor };
	if (global.Vditor) return Promise.resolve(global.Vditor);

	return new Promise<VditorCtor>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = SCRIPT_SRC;
		script.async = true;
		script.dataset.ybVditor = "1";
		script.addEventListener("load", () => {
			if (global.Vditor) resolve(global.Vditor);
			else reject(new Error("Vditor 没挂到 window 上"));
		});
		script.addEventListener("error", () => reject(new Error("脚本加载失败")));
		document.head.append(script);
	});
}

/** 加载失败要把缓存清掉，否则一个网络抖动会让本页之后再也不能加载 */
export function loadVditor(): Promise<VditorCtor> {
	if (assetPromise) return assetPromise;

	injectStyle();
	let timer = 0;
	const timeout = new Promise<never>((_, reject) => {
		timer = window.setTimeout(
			() => reject(new Error("加载超时")),
			LOAD_TIMEOUT,
		);
	});

	assetPromise = Promise.race([injectScript(), timeout])
		.then((ctor) => {
			window.clearTimeout(timer);
			return ctor;
		})
		.catch((error: unknown) => {
			window.clearTimeout(timer);
			assetPromise = null;
			throw error;
		});
	return assetPromise;
}

/**
 * 在 host 里挂一个即时渲染编辑器。
 * 失败（脚本拉不到、初始化抛错）会 reject，调用方负责退化成 textarea。
 */
export async function createCommentEditor(
	host: HTMLElement,
	options: CommentEditorOptions,
): Promise<CommentEditor> {
	const Vditor = await loadVditor();

	return new Promise<CommentEditor>((resolve, reject) => {
		// 脚本到位不代表内核能起来：解析器卡住时 after 永远不回调，
		// 不兜这一下，界面会一直停在「编辑器加载中」
		const guard = window.setTimeout(
			() => reject(new Error("内核初始化超时")),
			LOAD_TIMEOUT,
		);
		try {
			const instance: VditorInstance = new Vditor(host, {
				cdn: BASE,
				mode: "ir",
				lang: "zh_CN",
				height: 190,
				resize: { enable: false },
				theme: isDark() ? "dark" : "classic",
				cache: { enable: false },
				toolbar: pickToolbar(),
				counter: { enable: false },
				placeholder: "说点什么…",
				preview: {
					theme: { current: isDark() ? "dark" : "light" },
					hljs: { style: isDark() ? "monokai" : "github", lineNumber: false },
					math: { engine: "KaTeX" },
				},
				input: (value: string) => options.onInput(value),
				after: () => {
					window.clearTimeout(guard);
					// 站点允许在评论框旁边切深色，编辑器要跟着换
					const observer = new MutationObserver(() => {
						instance.setTheme(
							isDark() ? "dark" : "classic",
							isDark() ? "dark" : "light",
						);
					});
					observer.observe(document.documentElement, {
						attributes: true,
						attributeFilter: ["class"],
					});

					resolve({
						read: () => instance.getValue(),
						clear: () => instance.setValue(""),
						focus: () => instance.focus(),
						alive: () => host.isConnected,
						destroy: () => {
							observer.disconnect();
							instance.destroy();
						},
					});
				},
			});
		} catch (error) {
			window.clearTimeout(guard);
			reject(error instanceof Error ? error : new Error("编辑器初始化失败"));
		}
	});
}
