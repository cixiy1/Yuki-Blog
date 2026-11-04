<script setup lang="ts">
import Vditor from "vditor";
import "vditor/dist/index.css";
import {
	computed,
	defineAsyncComponent,
	nextTick,
	onBeforeUnmount,
	onMounted,
	reactive,
	ref,
	watch,
} from "vue";
import AppIcon from "../components/AppIcon.vue";
import LoadingState from "../components/LoadingState.vue";
import MediaPickerDialog from "../components/MediaPickerDialog.vue";
import PageHeader from "../components/PageHeader.vue";
import PagePreview from "../components/PagePreview.vue";
import SeriesPickerDialog from "../components/SeriesPickerDialog.vue";
import { ApiError } from "../lib/api";
import { isAdmin } from "../lib/auth";
import { uploadImage } from "../lib/media";
import {
	findMindmapBlocks,
	type MindBlock,
	parseMermaid,
	replaceBlock,
} from "../lib/mindmap";
import {
	bodyToPreview,
	bodyToStorage,
	deleteRepoPost,
	type FieldValue,
	formatTime,
	getPost,
	getPostNotes,
	getRepoPost,
	isEditable,
	listSeries,
	type PostDetail,
	publishPost,
	type RepoPostDetail,
	type ReviewNoteView,
	type SeriesItem,
	savePost,
	saveRepoPost,
	submitPost,
	withdrawPost,
} from "../lib/posts";
import { isDark } from "../lib/theme";
import { go, route } from "../router";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const postId = computed(() => route.value.id ?? 0);

/** 仓库模式：直接改 src/content/posts 下的文件，走 slug 而不是 D1 id */
const repoSlug = computed(() => route.value.repoSlug ?? "");
const isRepo = computed(() => repoSlug.value.length > 0);
/** 原始 slug：表单里可能被改，接口定位要用原来的 */
const loadedSlug = ref("");
/** 仓库文章所在目录的 raw 前缀，正文里的相对图片要靠它才能在编辑器里预览 */
const rawBase = ref("");
/** 仓库文章的路径，用来算相对图片路径要退几层 */
const repoPath = ref("");
/** 封面选择器：封面能选库里的图，也能直接传 */
const coverPicker = ref(false);
/** 正文插图：从媒体库挑一张，插在光标处 */
const bodyPicker = ref(false);
/**
 * .mdx 里有 import 与组件标签（<ClassSchedule />），IR 模式会把组件渲染成一个看不见的
 * 空元素，作者一眼看过去像被删了。这类文件一律用分屏源码模式打开。
 */
const isMdx = ref(false);

/* ---------- 字段定义：一份表驱动整块属性区 ---------- */

type Kind =
	| "text"
	| "textarea"
	| "date"
	| "number"
	| "bool"
	| "password"
	| "url"
	| "tags"
	| "image"
	| "series"
	| "provenance";

interface Def {
	key: string;
	label: string;
	kind: Kind;
	placeholder?: string;
	hint?: string;
	/** 不单独占一行：跟着别的字段一起渲染（系列序号并进系列那行） */
	merged?: boolean;
}

interface Group {
	title: string;
	note?: string;
	defs: Def[];
}

/**
 * 覆盖 src/content.config.ts 里 posts schema 的全部可配置项。
 * schema 改了这里要跟着改，剩下的键一律进「自定义属性」。
 */
const GROUPS: Group[] = [
	{
		title: "文章属性",
		defs: [
			{ key: "slug", label: "地址", kind: "text", placeholder: "my-post-slug" },
			{
				key: "description",
				label: "摘要",
				kind: "textarea",
				placeholder: "列表页显示的一两句话",
			},
			{
				key: "tags",
				label: "标签",
				kind: "tags",
				placeholder: "用逗号分隔，最多 10 个",
			},
			{
				key: "category",
				label: "分类",
				kind: "text",
				placeholder: "如：编码经验",
			},
			{
				key: "series",
				label: "系列",
				kind: "series",
				placeholder: "从列表里选，或新建一个",
			},
			{
				key: "seriesOrder",
				label: "系列序号",
				kind: "number",
				placeholder: "序号",
				// 和「系列」是同一件事，渲染进系列那一行，不单独占一行
				merged: true,
			},
			{
				key: "image",
				label: "封面图",
				kind: "image",
				placeholder: "站内路径或图片地址",
			},
		],
	},
	{
		title: "来源标注",
		note: "读者在标题下能看到；选了代笔才展开模型与代理",
		defs: [{ key: "provenance", label: "是否代笔", kind: "provenance" }],
	},
	{
		title: "发布",
		defs: [
			{
				key: "published",
				label: "发布日期",
				kind: "date",
				placeholder: "2026-11-01",
			},
			{
				key: "updated",
				label: "更新日期",
				kind: "date",
				placeholder: "留空表示没更新过",
			},
			{
				key: "draft",
				label: "存为草稿",
				kind: "bool",
				hint: "draft: true，站点上看不到",
			},
			{ key: "pinned", label: "置顶", kind: "bool" },
			{ key: "comment", label: "允许评论", kind: "bool" },
		],
	},
	{
		title: "署名与出处",
		defs: [
			{
				key: "author",
				label: "作者",
				kind: "text",
				placeholder: "留空表示站主",
			},
			{
				key: "sourceLink",
				label: "转载来源",
				kind: "url",
				placeholder: "留空表示原创",
			},
			{ key: "lang", label: "语言", kind: "text", placeholder: "zh-CN" },
			{
				key: "licenseName",
				label: "许可协议",
				kind: "text",
				placeholder: "如：CC BY-NC-SA 4.0",
			},
			{
				key: "licenseUrl",
				label: "协议链接",
				kind: "url",
				placeholder: "https://…",
			},
		],
	},
	{
		title: "访问控制",
		note: "设了密码，站点上的正文要输密码才能看",
		defs: [
			{ key: "password", label: "访问密码", kind: "password" },
			{
				key: "passwordHint",
				label: "密码提示",
				kind: "text",
				placeholder: "给读者的提示",
			},
		],
	},
];

const ALL_DEFS: Def[] = GROUPS.flatMap((group) => group.defs);

/** 属性栏里单独占一行的字段；merged 的并进所在行手写渲染 */
function rowDefs(group: Group): Def[] {
	return group.defs.filter((def) => !def.merged);
}
const KNOWN = new Set([
	...ALL_DEFS.map((def) => def.key),
	"title",
	"slug",
	// 站内自动算出来的上下篇，改了也会被覆盖
	"prevTitle",
	"prevSlug",
	"nextTitle",
	"nextSlug",
]);

/** 与 src/config/provenanceConfig.ts 的 kinds 对齐 */
const PROV_KINDS = [
	{ value: "", label: "不标注" },
	{ value: "handwritten", label: "全自写" },
	{ value: "ghostwritten", label: "代笔" },
	{ value: "co-written", label: "代笔 + 本人改写" },
];

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/* ---------- 表单状态 ---------- */

const form = reactive({ title: "", slug: "", body: "" });
/** 页面预览：MDX 里的组件在编辑器里渲染不出来，只能看线上真实页面 */
const previewOpen = ref(false);
const previewUrl = computed(() => {
	const slug = (form.slug || loadedSlug.value || "").trim();
	if (!slug) return "";
	// 站点部署在根路径，管理端在 /admin/，所以取 origin 再拼文章地址
	return `${window.location.origin}/posts/${encodeURIComponent(slug)}/`;
});
/** 非布尔字段统一按字符串存，保存时按 kind 转回类型。
    number 输入框的 v-model 会给回数字，取值一律走 textOf */
const vals = reactive<Record<string, string | number>>({});
/** 布尔字段（draft / pinned / comment） */
const flags = reactive<Record<string, boolean>>({});
const prov = reactive({ kind: "", model: "", agent: "", note: "" });

interface CustomRow {
	orig: string;
	key: string;
	value: string;
	/** 载入时的值：没改动就不写回，免得把 `toc: false` 改写成 `toc: "false"` */
	initial: string;
	/** 原值形态：列表按逗号还原，嵌套对象只读 */
	type: "scalar" | "list" | "object" | "bool" | "number";
}
const custom = ref<CustomRow[]>([]);

/** 文件里原本有哪些键：决定保存时写不写、删不删，避免无意义地重写整份 frontmatter */
let loadedKeys = new Set<string>();

const status = ref("draft");
const loading = ref(true);
const ready = ref(false);
const saveState = ref<SaveState>("idle");
const errorText = ref("");
/** 审核员的划词批注与总评，只在被退回/待审时可能有 */
const reviewNotes = ref<ReviewNoteView[]>([]);
const reviewVerdict = ref("");
/** 审核员改过的那一版正文（存在 D1，不碰仓库） */
const reviewBody = ref<string | null>(null);
const reviewBodyOpen = ref(false);
const reviewBodyEl = ref<HTMLDivElement | null>(null);
const lastSaved = ref<string | null>(null);

/* ---------- 正文里的批注高亮 ---------- */

interface NoteHit {
	note: ReviewNoteView;
	index: number;
	range: Range;
}

/** 下标与 reviewNotes 对齐：卡片里点第几条，就定位到哪一条高亮 */
const noteHits: NoteHit[] = [];
const notePopover = ref<{
	index: number;
	note: ReviewNoteView;
	top: number;
	left: number;
} | null>(null);
/** 真在正文里找到的高亮条数：一条都没找到时提示语要换个说法 */
const noteMatchCount = ref(0);
/** 还没扫过正文时不显示「找不到」的提示，免得闪一下 */
const noteScanned = ref(false);
const HIGHLIGHT_NAME = "yb-review-note";
let highlightTimer: number | null = null;
let renderObserver: MutationObserver | null = null;
/** 卡片点一条会自己触发滚动，别让滚动监听把刚弹出来的批注关掉 */
let ignoreScrollUntil = 0;

/* ---------- 思维导图画布 ---------- */

// 画布库有一百多 KB，只有点开时才下载，不拖慢编辑页本身
const MindMapDialog = defineAsyncComponent(
	() => import("../components/MindMapDialog.vue"),
);

const mmOpen = ref(false);
/** 打开画布那一刻正文里的 mindmap 块；改的就是这一块 */
const mmBlocks = ref<MindBlock[]>([]);
const mmIndex = ref(0);
/** 读不出来时的提示：宁可不覆盖，也不要拿空白画布把人家原来的图冲掉 */
const mmNotice = ref("");

const mmInitial = computed(() => {
	const block = mmBlocks.value[mmIndex.value];
	return block ? parseMermaid(block.source) : null;
});

const mmTargetLabel = computed(() => {
	if (mmBlocks.value.length === 0) return "插入正文";
	return mmBlocks.value.length > 1
		? `更新第 ${mmIndex.value + 1} 幅`
		: "更新正文";
});

function openMindMap(): void {
	if (!editable.value) return;
	const blocks = findMindmapBlocks(form.body);
	const last = blocks[blocks.length - 1];
	if (last && !parseMermaid(last.source)) {
		// 里面可能有 icon / class 这类画布表达不了的写法，整块覆盖会丢东西
		mmBlocks.value = [];
		mmIndex.value = 0;
		mmNotice.value =
			"正文里那幅导图用了画布不支持的写法，这次会新增一幅，不会覆盖原来那张。";
	} else {
		mmBlocks.value = blocks;
		// 一篇里有多幅时改最后画的那幅，新插入的永远在文末
		mmIndex.value = Math.max(0, blocks.length - 1);
		mmNotice.value = "";
	}
	mmOpen.value = true;
}

function applyMindMap(source: string): void {
	mmOpen.value = false;
	const block = mmBlocks.value[mmIndex.value];
	if (block) {
		const next = replaceBlock(form.body, block, source);
		form.body = next;
		vditor?.setValue(next, false);
		vditor?.focus();
	} else if (vditor) {
		vditor.focus();
		vditor.insertValue(`\n\`\`\`mermaid\n${source}\n\`\`\`\n`, true);
		form.body = vditor.getValue();
	} else {
		form.body = `${form.body.trimEnd()}\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
	}
	onFieldInput();
}

/* ---------- 系列选择 ---------- */

/*
 * 系列的归属完全靠名字精确匹配（见 content-utils 的 getSeriesPosts），
 * 手打一个「软件2615班务」就能把同一个系列拆成两堆，站点上分成两个系列页。
 * 所以这里不给自由输入：要么从列表里点，要么显式新建。
 */
const seriesList = ref<SeriesItem[]>([]);
const seriesLoading = ref(false);
const seriesOpen = ref(false);

/** 本篇的 slug：算「序号空位」时要排除自己，否则改自己的序号会撞自己 */
const selfSlug = computed(() => loadedSlug.value || form.slug);

const currentSeriesItem = computed(() => {
	const name = textOf("series").trim();
	if (!name) return null;
	return seriesList.value.find((item) => item.name === name) ?? null;
});

/** 同系列里被别的篇占用的序号 */
const takenOrders = computed<number[]>(() => {
	const item = currentSeriesItem.value;
	if (!item) return [];
	const set = new Set<number>();
	for (const post of item.posts) {
		if (post.slug === selfSlug.value) continue;
		if (typeof post.order === "number") set.add(post.order);
	}
	return [...set].sort((a, b) => a - b);
});

const nextFreeOrder = computed(() => {
	const used = new Set(takenOrders.value);
	let next = 1;
	while (used.has(next)) next += 1;
	return next;
});

const seriesOrderHint = computed(() => {
	if (!textOf("series").trim()) return "";
	if (seriesLoading.value) return "读取同系列篇目…";
	if (takenOrders.value.length === 0) return "同系列还没有别的篇";
	return `已被占用 ${takenOrders.value.join("、")}`;
});

/** 当前序号已经是下一个空位时就不推「填 N」，少一个碍眼的按钮 */
const canSuggestOrder = computed(() => {
	if (!textOf("series").trim()) return false;
	return textOf("seriesOrder").trim() !== String(nextFreeOrder.value);
});

async function loadSeries(): Promise<void> {
	if (seriesList.value.length > 0) return;
	seriesLoading.value = true;
	try {
		seriesList.value = await listSeries();
	} catch {
		// 读不到就当没有：选择窗口里照样能新建
	} finally {
		seriesLoading.value = false;
	}
}

function openSeries(): void {
	if (!editable.value) return;
	seriesOpen.value = true;
	void loadSeries();
}

function applySeries(name: string, order: string): void {
	seriesOpen.value = false;
	vals.series = name;
	vals.seriesOrder = order;
	onFieldInput();
}

function useNextOrder(): void {
	vals.seriesOrder = String(nextFreeOrder.value);
	onFieldInput();
}

/** 仓库文章没有 D1 状态，能改就是能改；D1 文章要 draft/rejected 才能改 */
const editable = computed(() =>
	isRepo.value ? true : isEditable(status.value),
);

const statusLabel = computed(() => {
	if (status.value === "pending") return "待审";
	if (status.value === "published") return "已发布";
	if (status.value === "rejected") return "被退回";
	return "草稿";
});

/** 页头说明：固定文案，不随保存状态抖动 */
const pageDesc = computed(() => {
	if (status.value === "pending") {
		return "当前状态：待审，不可编辑。想改点右上角「撤回审核」，改完再提交。";
	}
	if (!editable.value) return `当前状态：${statusLabel.value}，不可编辑`;
	if (isRepo.value) return "改的是仓库里的文件，保存即提交并触发构建。";
	return "草稿存在 D1，停手 1.5 秒自动保存。";
});

const saveHint = computed(() => {
	if (isRepo.value) {
		if (saveState.value === "saving") return "正在提交到仓库…";
		if (saveState.value === "saved")
			return `已提交 ${lastSaved.value ?? ""}，等构建完成即生效`;
		if (saveState.value === "dirty")
			return "有改动未保存，点「保存」提交到仓库";
		if (saveState.value === "error") return errorText.value || "保存失败";
		return "改的是仓库里的文件，保存即提交并触发构建";
	}
	// 不可编辑时的状态说明交给页头，这里留空
	if (!editable.value) return "";
	if (saveState.value === "saving") return "保存中…";
	if (saveState.value === "saved") return `已保存 ${lastSaved.value ?? ""}`;
	if (saveState.value === "dirty") return "有改动未保存";
	if (saveState.value === "error") return errorText.value || "保存失败";
	return "自动保存已开启";
});

/**
 * 工具栏里的自定义按钮图标。Vditor 会给工具栏里的 svg 套上
 * `fill: currentColor; stroke-width: 0`，所以描边属性写在 g 的 style 上，
 * 不然图标会被压成一条看不见的线。图本身画在 24 格里只占 70%，
 * 放大 1.25 倍才和 Vditor 自带图标一样大。
 */
const MINDMAP_ICON: string =
	'<svg viewBox="0 0 24 24" width="15" height="15"><g style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" transform="translate(12 12) scale(1.25) translate(-12 -12)">' +
	'<path d="M4 12h4.5"/>' +
	'<path d="M8.5 12c0-3.4 1.6-5.2 4.5-5.2h3"/>' +
	'<path d="M8.5 12c0 3.4 1.6 5.2 4.5 5.2h3"/>' +
	'<path d="M8.5 12h7"/>' +
	'<path d="M18 5.4h2.6"/>' +
	'<path d="M18 12h2.6"/>' +
	'<path d="M18 18.6h2.6"/>' +
	"</g></svg>";

/** 同一个画框图标，工具栏里用；描边写在 g 上，否则被 Vditor 的样式压平 */
const IMAGE_ICON: string =
	'<svg viewBox="0 0 24 24" width="15" height="15"><g style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" transform="translate(12 12) scale(1.25) translate(-12 -12)">' +
	'<path d="M4 5h16v14H4z"/>' +
	'<path d="m4 16.4 4.4-4.4 3.2 3.2 2.9-2.9L20 16.6"/>' +
	"</g></svg>";

const TOOLBAR: Array<string | IMenuItem> = [
	"headings",
	"bold",
	"italic",
	"strike",
	"|",
	"list",
	"ordered-list",
	"check",
	"quote",
	"|",
	"code",
	"inline-code",
	"link",
	"table",
	"upload",
	"|",
	"undo",
	"redo",
	"|",
	"edit-mode",
	"both",
	"preview",
	"fullscreen",
	"|",
	{
		name: "media",
		tip: "从媒体库插图",
		icon: IMAGE_ICON,
		click: () => {
			bodyPicker.value = true;
		},
	},
	{
		name: "mindmap",
		tip: "思维导图",
		icon: MINDMAP_ICON,
		click: () => openMindMap(),
	},
];

const editorEl = ref<HTMLDivElement | null>(null);
let vditor: Vditor | null = null;
let timer: number | null = null;

function textOf(key: string): string {
	const value = vals[key];
	if (typeof value === "string") return value;
	return value === undefined || value === null ? "" : String(value);
}

function splitTags(): string[] {
	return textOf("tags")
		.split(/[,，]/)
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
}

/** 文章所在目录（相对 src/content/posts）：决定 `./images/...` 要退几层 */
const postDir = computed(() => {
	const path = repoPath.value.replace(/^src\/content\/posts\//, "");
	const slash = path.lastIndexOf("/");
	return slash >= 0 ? path.slice(0, slash) : "";
});

/** 封面可能是不带前导 ./ 的相对路径，管理端下解析不到，转到仓库 raw 上预览 */
const coverBroken = ref(false);
/** 刚上传的封面在站内地址上是 404，构建完才有——重试几次，别一失败就留白 */
const coverTry = ref(0);
const coverTimer = ref(0);
const coverPreview = computed(() => {
	const src = textOf("image").trim();
	if (!src || coverBroken.value) return "";
	const bust =
		coverTry.value > 0
			? `${src}${src.includes("?") ? "&" : "?"}yb_retry=${coverTry.value}`
			: src;
	if (/^(?:https?:|data:)/i.test(src)) return bust;
	if (src.startsWith("/")) return bust;
	return rawBase.value ? `${rawBase.value}${src.replace(/^\.\//, "")}` : "";
});

function onCoverError(): void {
	if (coverTry.value >= 20) {
		coverBroken.value = true;
		return;
	}
	if (coverTimer.value) window.clearTimeout(coverTimer.value);
	coverTimer.value = window.setTimeout(() => {
		coverTry.value += 1;
	}, 6000);
}

function applyProvenance(raw: FieldValue | undefined): void {
	if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
		prov.kind = raw.kind ?? "";
		prov.model = raw.model ?? "";
		prov.agent = raw.agent ?? "";
		prov.note = raw.note ?? "";
		return;
	}
	prov.kind = typeof raw === "string" ? raw : "";
	prov.model = "";
	prov.agent = "";
	prov.note = "";
}

/** 把接口给的 frontmatter 铺进表单 */
function loadFields(fields: Record<string, FieldValue>): void {
	loadedKeys = new Set(Object.keys(fields));
	form.title = typeof fields.title === "string" ? fields.title : "";

	for (const def of ALL_DEFS) {
		// 地址走 form.slug + nextSlug 那条路，不进 frontmatter 字段表
		if (def.key === "slug") continue;
		const raw = fields[def.key];
		if (def.kind === "bool") {
			flags[def.key] = raw === true || raw === "true";
			continue;
		}
		if (def.kind === "tags") {
			vals.tags = Array.isArray(raw)
				? raw.join(", ")
				: typeof raw === "string"
					? raw
					: "";
			continue;
		}
		if (def.kind === "provenance") {
			applyProvenance(raw);
			continue;
		}
		vals[def.key] = raw === undefined || raw === null ? "" : String(raw);
	}

	custom.value = Object.entries(fields)
		.filter(([key]) => !KNOWN.has(key))
		.map(([key, value]) => {
			if (Array.isArray(value)) {
				const text = value.join(", ");
				return {
					orig: key,
					key,
					value: text,
					initial: text,
					type: "list" as const,
				};
			}
			if (value !== null && typeof value === "object") {
				const text = Object.entries(value)
					.map(([childKey, childValue]) => `${childKey}: ${childValue}`)
					.join(" · ");
				return {
					orig: key,
					key,
					value: text,
					initial: text,
					type: "object" as const,
				};
			}
			const text = value === undefined || value === null ? "" : String(value);
			const type = /^(?:true|false)$/i.test(text)
				? ("bool" as const)
				: /^-?\d+(?:\.\d+)?$/.test(text)
					? ("number" as const)
					: ("scalar" as const);
			return { orig: key, key, value: text, initial: text, type };
		});
}

function fill(post: PostDetail): void {
	loadedSlug.value = post.slug;
	repoPath.value = "";
	status.value = post.status;
	lastSaved.value = formatTime(post.updated_at);
	form.slug = post.slug;
	form.body = post.body;
	loadFields((post.meta ?? {}) as Record<string, FieldValue>);
	// D1 的标题、摘要、标签在列上，不在 meta 里
	form.title = post.title;
	vals.description = post.summary ?? "";
	vals.tags = (post.tags ?? []).join(", ");
}

function fillRepo(post: RepoPostDetail): void {
	loadedSlug.value = post.slug;
	repoPath.value = post.repoPath;
	status.value = "published";
	lastSaved.value = "";
	form.slug = post.slug;
	rawBase.value = post.rawBase;
	isMdx.value = post.repoPath.toLowerCase().endsWith(".mdx");
	form.body = bodyToPreview(post.body, post.rawBase);
	loadFields(post.fields);
}

/** 值 -> frontmatter：空值送 null，服务端据此删掉这个键 */
function provValue(): FieldValue | null {
	if (!prov.kind) return null;
	const model = prov.model.trim();
	const agent = prov.agent.trim();
	const note = prov.note.trim();
	if (!model && !agent && !note) return prov.kind;
	return { kind: prov.kind, model, agent, note };
}

/**
 * 只提交真动过的字段：文件里没有、值又是空的就跳过。
 * 否则每存一次都会凭空补一堆 `pinned: false`，diff 没法看。
 */
function buildFields(): Record<string, FieldValue | null> {
	const out: Record<string, FieldValue | null> = {};
	const put = (key: string, value: FieldValue | null, empty: boolean): void => {
		if (loadedKeys.has(key) || !empty) out[key] = empty ? null : value;
	};

	out.title = form.title.trim();

	for (const def of ALL_DEFS) {
		if (def.key === "slug") continue;
		if (def.kind === "bool") {
			const value = Boolean(flags[def.key]);
			put(def.key, value, !value);
			continue;
		}
		if (def.kind === "tags") {
			const tags = splitTags();
			put(def.key, tags, tags.length === 0);
			continue;
		}
		if (def.kind === "provenance") {
			const value = provValue();
			put(def.key, value, value === null);
			continue;
		}
		const text = textOf(def.key).trim();
		if (def.kind === "number") {
			const num = Number(text);
			put(
				def.key,
				text.length > 0 && Number.isFinite(num) ? num : null,
				text.length === 0,
			);
			continue;
		}
		put(def.key, text, text.length === 0);
	}

	for (const row of custom.value) {
		const key = row.key.trim();
		// 改了键名要把老键删掉，否则 frontmatter 里会留下两条
		if (row.orig && row.orig !== key && loadedKeys.has(row.orig))
			out[row.orig] = null;
		if (!KEY_RE.test(key) || KNOWN.has(key)) continue;
		if (row.type === "object") continue;

		const text = row.value.trim();
		const changed = row.orig === "" || row.orig !== key || text !== row.initial;
		if (!changed) continue;

		if (row.type === "list") {
			const items = text
				.split(/[,，]/)
				.map((item) => item.trim())
				.filter((item) => item.length > 0);
			out[key] = items.length > 0 ? items : null;
			continue;
		}
		if (row.type === "bool") {
			out[key] = text.toLowerCase() === "true";
			continue;
		}
		if (row.type === "number") {
			const num = Number(text);
			out[key] = text.length > 0 && Number.isFinite(num) ? num : null;
			continue;
		}
		out[key] = text.length > 0 ? text : null;
	}

	for (const key of removedKeys.value) {
		if (!KNOWN.has(key)) out[key] = null;
	}

	return out;
}

/** 仓库文章：整份写回文件，一次保存 = 一次 commit + 一次构建 */
async function saveRepo(): Promise<boolean> {
	saveState.value = "saving";
	errorText.value = "";
	try {
		await saveRepoPost({
			slug: loadedSlug.value,
			nextSlug: form.slug.trim(),
			fields: buildFields(),
			body: bodyToStorage(form.body, rawBase.value),
		});
		lastSaved.value = new Date().toLocaleString("zh-CN", { hour12: false });
		saveState.value = "saved";
		removedKeys.value = [];
		return true;
	} catch (error) {
		errorText.value =
			error instanceof Error ? error.message : "提交失败，请重试";
		saveState.value = "error";
		return false;
	}
}

async function save(): Promise<boolean> {
	if (!ready.value) return false;
	if (!isRepo.value && !editable.value) return false;
	if (isRepo.value) return saveRepo();
	saveState.value = "saving";
	errorText.value = "";
	try {
		// 标题、摘要、标签在 D1 里是独立的列，meta 里再放一份会打架
		const meta = buildFields();
		delete meta.title;
		delete meta.description;
		delete meta.tags;
		const post = await savePost(postId.value, {
			title: form.title.trim(),
			slug: form.slug.trim(),
			summary: textOf("description").trim(),
			tags: splitTags(),
			body: form.body,
			meta,
		});
		if (post) {
			status.value = post.status;
			lastSaved.value = formatTime(post.updated_at);
		}
		saveState.value = "saved";
		removedKeys.value = [];
		return true;
	} catch (error) {
		errorText.value =
			error instanceof Error ? error.message : "保存失败，请重试";
		saveState.value = "error";
		return false;
	}
}

function scheduleSave(): void {
	if (!editable.value) return;
	saveState.value = "dirty";
	// 仓库文章每次保存都是一次 git 提交 + 一次构建，不做自动保存
	if (isRepo.value) return;
	if (timer !== null) window.clearTimeout(timer);
	timer = window.setTimeout(() => {
		timer = null;
		void save();
	}, 1500);
}

/** 审核员改的那一版渲染出来给作者看，只读，不动自己的稿子 */
async function openReviewBody(): Promise<void> {
	reviewBodyOpen.value = true;
	await nextTick();
	const target = reviewBodyEl.value;
	if (!target || !reviewBody.value) return;
	await Vditor.preview(target, reviewBody.value, {
		cdn: "/admin/vditor",
		lang: "zh_CN",
		mode: isDark.value ? "dark" : "light",
		theme: { current: isDark.value ? "dark" : "light" },
		hljs: { style: isDark.value ? "monokai" : "github", lineNumber: true },
		math: { engine: "KaTeX" },
		anchor: 0,
	});
}

/**
 * 采用审核改稿：覆盖编辑器里的正文。
 * 作者自己再确认一遍保存，别让「看一眼」变成「悄悄替换」。
 */
function applyReviewBody(): void {
	const next = reviewBody.value;
	if (!next) return;
	const ok = window.confirm(
		"用审核员改的这一版替换当前正文？当前正文会被覆盖，替换后还要保存才生效。",
	);
	if (!ok) return;
	form.body = next;
	vditor?.setValue(next);
	reviewBody.value = null;
	reviewBodyOpen.value = false;
	scheduleSave();
}

function onFieldInput(): void {
	scheduleSave();
}

/** 管理员：保存后直接写成仓库文件，不经过审核队列 */
async function onPublish(): Promise<void> {
	const saved = await save();
	if (!saved) return;
	if (
		!window.confirm("发布后直接写入仓库并触发构建，约一分钟后站点上线。确定？")
	) {
		return;
	}
	try {
		await publishPost(postId.value);
		go("/posts");
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "发布失败";
		saveState.value = "error";
	}
}

async function onSubmit(): Promise<void> {
	if (!editable.value) return;
	const saved = await save();
	if (!saved) return;
	if (!window.confirm("提交审核后正文会锁定，想改可以随时撤回。确定提交？")) {
		return;
	}
	try {
		await submitPost(postId.value);
		go("/posts");
	} catch (error) {
		errorText.value = error instanceof ApiError ? error.message : "提交失败";
		saveState.value = "error";
	}
}

async function onWithdraw(): Promise<void> {
	if (
		!window.confirm(
			"撤回后回到草稿，可以继续修改。审核人会收到一封撤回提醒。确定撤回？",
		)
	) {
		return;
	}
	try {
		await withdrawPost(postId.value);
		location.reload();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "撤回失败";
	}
}

function addCustom(): void {
	custom.value.push({
		orig: "",
		key: "",
		value: "",
		initial: "",
		type: "scalar",
	});
}

/** 删掉的行：原来文件里有的键要在下一次保存时送 null，才会从 frontmatter 里消失 */
const removedKeys = ref<string[]>([]);

function removeCustom(index: number): void {
	const row = custom.value[index];
	if (row.orig) removedKeys.value.push(row.orig);
	custom.value.splice(index, 1);
	onFieldInput();
}

/**
 * Vditor 的自定义上传：返回字符串表示错误，返回 null 表示成功。
 * 成功时自己把 Markdown 插进正文，Vditor 不会代劳。
 */
async function onUpload(files: File[]): Promise<string> {
	if (!vditor) return "编辑器还没就绪";
	errorText.value = "";
	const snippets: string[] = [];
	for (const file of files) {
		try {
			const media = await uploadImage(file);
			const alt = file.name.replace(/\.[^.]+$/, "");
			snippets.push(`![${alt}](${media.url})`);
		} catch (error) {
			const reason = error instanceof Error ? error.message : "上传失败";
			errorText.value = `${file.name}：${reason}`;
			saveState.value = "error";
			return `${file.name}：${reason}`;
		}
	}
	vditor.insertValue(`${snippets.join("\n")}\n`);
	scheduleSave();
	// Vditor 约定「出错才返回错误信息」，成功要回空串
	return "";
}

/** 从媒体库挑一张插进正文：插在光标处，编辑器没就绪就追加到末尾 */
function insertLibraryImage(ref: string): void {
	const markdown = `![](${ref})\n`;
	bodyPicker.value = false;
	if (vditor) {
		vditor.insertValue(markdown);
		return;
	}
	form.body = `${form.body.trimEnd()}\n\n${markdown}`;
	onFieldInput();
}

/**
 * Safari 从访达拖入或粘贴图片时，`dataTransfer` 里除了文件还会带一份
 * `text/html`，内容是 `<img src="file:///Users/…">`。Vditor 看到 text/html
 * 就直接按 HTML 插入，根本不走 upload.handler——正文里落下一行本地路径，
 * 图永远裂着，也没有任何报错（Chrome 只给 files，所以只在这个浏览器翻车）。
 * 在捕获阶段先拦下来自己上传。
 */
function editorFiles(event: DragEvent | ClipboardEvent): File[] {
	const el = editorEl.value;
	const target = event.target;
	if (!el || !(target instanceof Node) || !el.contains(target)) return [];
	const carrier =
		event instanceof DragEvent ? event.dataTransfer : event.clipboardData;
	return Array.from(carrier?.files ?? []);
}

function takeDroppedFiles(event: DragEvent | ClipboardEvent): void {
	const files = editorFiles(event);
	if (files.length === 0) return;
	// 拦在这里：Vditor 的监听挂在编辑器元素上，dom 冒泡过不去就不会再插 file://
	event.preventDefault();
	event.stopPropagation();
	void onUpload(files);
}

function onEditorDrop(event: DragEvent): void {
	takeDroppedFiles(event);
}

function onEditorPaste(event: ClipboardEvent): void {
	takeDroppedFiles(event);
}

function createEditor(): void {
	if (!editorEl.value) return;
	vditor = new Vditor(editorEl.value, {
		cdn: "/admin/vditor",
		value: form.body,
		mode: isMdx.value ? "sv" : "ir",
		lang: "zh_CN",
		height: 600,
		// 高度由卡片决定（见 .editor 的样式），自带的拖拽把手会和它打架
		resize: { enable: false },
		theme: isDark.value ? "dark" : "classic",
		cache: { enable: false },
		// MDX 的分屏预览只会把 import 语句当正文、组件是个空标签，看了反而误判，直接不给
		toolbar: isMdx.value
			? TOOLBAR.filter((item) => item !== "both" && item !== "preview")
			: TOOLBAR,
		placeholder: "正文…",
		preview: {
			// MDX 只写源码：markdown 预览里 import 会变成一行正文、组件是空标签，看着像坏了
			mode: isMdx.value ? "editor" : "both",
			theme: { current: isDark.value ? "dark" : "light" },
			hljs: { style: isDark.value ? "monokai" : "github", lineNumber: true },
			math: { engine: "KaTeX" },
		},
		upload: {
			accept: "image/png,image/jpeg,image/webp,image/gif,image/avif",
			handler: (files: File[]) => onUpload(files),
		},
		input: (value: string) => {
			form.body = value;
			scheduleSave();
			scheduleHighlights();
		},
		after: () => {
			ready.value = true;
			if (!editable.value) vditor?.disabled();
			watchEditorRender();
		},
	});
}

/* ---------- 正文批注：高亮 + 点开看内容 ---------- */

type HighlightCtor = new (...ranges: Range[]) => unknown;
interface HighlightRegistryLike {
	set(name: string, highlight: unknown): void;
	delete(name: string): void;
}

function highlightRegistry(): HighlightRegistryLike | null {
	const registry = (CSS as unknown as { highlights?: HighlightRegistryLike })
		.highlights;
	return registry ?? null;
}

/**
 * 正文 DOM 根：即时渲染模式是 pre，所见即所得模式是 div；源码模式没有文本节点，跳过。
 * Vditor 把几种模式的容器都建在页面里（其余 display:none），querySelector 拿到的是
 * 文档里第一个、往往是隐藏的那个空容器，所以要按可见性挑。
 */
function editorTextRoot(): HTMLElement | null {
	const host = editorEl.value;
	if (!host) return null;
	const list = [
		...host.querySelectorAll<HTMLElement>(
			".vditor-ir .vditor-reset, .vditor-wysiwyg .vditor-reset",
		),
	];
	const shown = list.find((el) => el.offsetParent !== null);
	if (shown) return shown;
	return list.find((el) => (el.textContent ?? "").trim().length > 0) ?? null;
}

/**
 * 把批注引用的那段话映射回正文里的 Range。
 * 引用可能跨多个文本节点（加粗、链接会把文字切断），所以按字符建索引再回查；
 * 同时把空白折叠掉——正文里的换行在 DOM 里没有对应字符。
 */
function locateQuote(root: HTMLElement, quote: string): Range | null {
	const wanted = quote.replace(/\s+/g, " ").trim();
	if (!wanted) return null;

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const chars: { node: Text; offset: number }[] = [];
	let flat = "";
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		const data = node.data;
		for (let i = 0; i < data.length; i += 1) {
			const ch = data[i];
			if (/\s/.test(ch)) {
				if (flat.endsWith(" ")) continue;
				flat += " ";
			} else {
				flat += ch;
			}
			chars.push({ node, offset: i });
		}
	}

	const at = flat.indexOf(wanted);
	if (at < 0) return null;
	const start = chars[at];
	const end = chars[at + wanted.length - 1];
	if (!start || !end) return null;

	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset + 1);
	return range;
}

/**
 * 用 CSS Custom Highlight API 上色，不往正文里插标签：
 * 编辑器每次保存都读 DOM，插 <mark> 会被序列化进 Markdown 里。
 */
function applyNoteHighlights(): void {
	const registry = highlightRegistry();
	const Ctor = (window as Window & { Highlight?: HighlightCtor }).Highlight;
	noteHits.length = 0;
	noteMatchCount.value = 0;
	registry?.delete(HIGHLIGHT_NAME);
	if (!registry || !Ctor || reviewNotes.value.length === 0) return;

	const root = editorTextRoot();
	if (!root) return;

	const ranges: Range[] = [];
	reviewNotes.value.forEach((note, index) => {
		const range = locateQuote(root, note.quote);
		if (!range) return;
		ranges.push(range);
		noteHits.push({ note, index, range });
	});
	noteScanned.value = true;
	if (ranges.length > 0) {
		registry.set(HIGHLIGHT_NAME, new Ctor(...ranges));
		noteMatchCount.value = ranges.length;
	}
}

/** 正文一改，编辑器就会重排 DOM，原来的 Range 会失效，安静地补一次 */
function scheduleHighlights(): void {
	if (highlightTimer !== null) window.clearTimeout(highlightTimer);
	highlightTimer = window.setTimeout(() => {
		highlightTimer = null;
		applyNoteHighlights();
	}, 400);
}

/**
 * after 回调跑的时候正文还没铺完（IR 模式要再渲染一拍），所以盯着正文容器：
 * 第一次渲染、改字、重排都会触发，省得靠固定延时猜。
 */
function watchEditorRender(): void {
	renderObserver?.disconnect();
	renderObserver = null;
	const host =
		editorEl.value?.querySelector<HTMLElement>(".vditor-content") ??
		editorTextRoot();
	if (host) {
		renderObserver = new MutationObserver(() => scheduleHighlights());
		renderObserver.observe(host, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	}
	applyWhenRendered();
}

/** 首屏那次如果还空着，就短间隔补几拍：观察器万一盯错了容器也能兜住 */
function applyWhenRendered(attempt = 0): void {
	const root = editorTextRoot();
	if (root && (root.textContent ?? "").trim().length > 0) {
		applyNoteHighlights();
		return;
	}
	if (attempt < 40) {
		window.setTimeout(() => applyWhenRendered(attempt + 1), 150);
	}
}

function caretPoint(
	x: number,
	y: number,
): { node: Node; offset: number } | null {
	const doc = document as Document & {
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
		caretPositionFromPoint?: (
			x: number,
			y: number,
		) => { offsetNode: Node; offset: number } | null;
	};
	const range = doc.caretRangeFromPoint?.(x, y);
	if (range) return { node: range.startContainer, offset: range.startOffset };
	const pos = doc.caretPositionFromPoint?.(x, y);
	return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
}

function openNote(hit: NoteHit, rect: DOMRect): void {
	const width = 300;
	const left = Math.min(
		Math.max(12, rect.left),
		window.innerWidth - width - 16,
	);
	const top = Math.min(rect.bottom + 8, window.innerHeight - 170);
	notePopover.value = { index: hit.index, note: hit.note, top, left };
}

/** 点在正文上：命中高亮就弹批注，点空白处收起 */
function onEditorClick(event: MouseEvent): void {
	if (noteHits.length === 0) return;
	const caret = caretPoint(event.clientX, event.clientY);
	if (!caret) return;
	const hit = noteHits.find(({ range }) => {
		try {
			return range.isPointInRange(caret.node, caret.offset);
		} catch {
			return false;
		}
	});
	if (!hit) {
		notePopover.value = null;
		return;
	}
	openNote(hit, hit.range.getBoundingClientRect());
}

/** 卡片里点第几条，就滚到正文里对应的高亮上，顺手把批注弹出来 */
function focusNote(index: number): void {
	applyNoteHighlights();
	const hit = noteHits.find((row) => row.index === index);
	if (!hit) return;
	ignoreScrollUntil = Date.now() + 700;
	hit.range.startContainer.parentElement?.scrollIntoView({ block: "center" });
	window.setTimeout(() => {
		const next = noteHits.find((row) => row.index === index);
		if (next) openNote(next, next.range.getBoundingClientRect());
	}, 60);
}

function closeNotePopover(): void {
	notePopover.value = null;
}

function onPopoverScroll(): void {
	if (Date.now() < ignoreScrollUntil) return;
	notePopover.value = null;
}

function onPopoverKey(event: KeyboardEvent): void {
	if (event.key === "Escape") notePopover.value = null;
}

function onDocumentClick(event: MouseEvent): void {
	if (!notePopover.value) return;
	const target = event.target as HTMLElement | null;
	if (target?.closest(".note-pop") || target?.closest(".editor")) return;
	notePopover.value = null;
}

function onKeydown(event: KeyboardEvent): void {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
		event.preventDefault();
		void save();
	}
}

function beforeUnload(event: BeforeUnloadEvent): void {
	if (saveState.value === "dirty") {
		event.preventDefault();
		event.returnValue = "";
	}
}

async function onDeleteRepo(): Promise<void> {
	if (
		!window.confirm(
			`删除《${form.title}》？会从仓库里删掉文件并触发构建，站点上这条链接就没了。`,
		)
	) {
		return;
	}
	try {
		await deleteRepoPost(loadedSlug.value);
		go("/posts");
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "删除失败";
	}
}

onMounted(async () => {
	let local: PostDetail | null = null;
	let remote: RepoPostDetail | null = null;
	try {
		if (isRepo.value) {
			remote = await getRepoPost(repoSlug.value);
			if (!remote) errorText.value = "文章不存在";
		} else {
			local = await getPost(postId.value);
			if (!local) errorText.value = "文章不存在";
			else {
				reviewVerdict.value = local.review_note ?? "";
				reviewBody.value = local.review_body ?? null;
				try {
					reviewNotes.value = await getPostNotes(postId.value);
				} catch {
					// 批注取不到不该挡住编辑
				}
			}
		}
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}

	// 编辑器容器在 v-else 分支里，必须等 loading 翻掉、DOM 挂上之后才能初始化
	await nextTick();
	if (local) fill(local);
	if (remote) fillRepo(remote);
	if (local || remote) createEditor();
	// 系列列表只用来算序号提示，晚一步没关系，失败也不挡编辑
	if (local || remote) void loadSeries();

	window.addEventListener("keydown", onKeydown);
	window.addEventListener("beforeunload", beforeUnload);
	window.addEventListener("scroll", onPopoverScroll, true);
	window.addEventListener("keydown", onPopoverKey);
	document.addEventListener("click", onDocumentClick);
	// 捕获阶段先于 Vditor 自己的 drop/paste 处理，见 takeDroppedFiles
	document.addEventListener("drop", onEditorDrop, true);
	document.addEventListener("paste", onEditorPaste, true);
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onKeydown);
	window.removeEventListener("beforeunload", beforeUnload);
	window.removeEventListener("scroll", onPopoverScroll, true);
	window.removeEventListener("keydown", onPopoverKey);
	document.removeEventListener("click", onDocumentClick);
	document.removeEventListener("drop", onEditorDrop, true);
	document.removeEventListener("paste", onEditorPaste, true);
	if (timer !== null) window.clearTimeout(timer);
	if (highlightTimer !== null) window.clearTimeout(highlightTimer);
	if (coverTimer.value) window.clearTimeout(coverTimer.value);
	renderObserver?.disconnect();
	highlightRegistry()?.delete(HIGHLIGHT_NAME);
	vditor?.destroy();
	vditor = null;
});

watch(isDark, (dark) => {
	if (!vditor) return;
	vditor.setTheme(
		dark ? "dark" : "classic",
		dark ? "dark" : "light",
		dark ? "monokai" : "github",
	);
	/*
	 * mermaid 的图是渲染好的静态 SVG，setTheme 不会重画，深色下会留一张白底图。
	 * 正文里没有 ```mermaid 就不折腾，有的话按新主题重建一次编辑器——
	 * 内容在 form.body 里，重建不丢东西，光标会回到开头（切主题本来也不该是编辑中的动作）。
	 */
	if (!form.body.includes("```mermaid")) return;
	vditor.destroy();
	vditor = null;
	if (editorEl.value) editorEl.value.innerHTML = "";
	createEditor();
});
</script>

<template>
	<div>
		<PageHeader title="编辑文章" :desc="pageDesc">
			<template #actions>
				<button type="button" class="btn-ghost" @click="go('/posts')">
					返回列表
				</button>
				<button
					type="button"
					class="btn-ghost"
					:disabled="!previewUrl"
					title="按桌面 / 平板 / 手机宽度看线上页面"
					@click="previewOpen = true"
				>
					<AppIcon name="eye" :size="15" />
					预览页面
				</button>
				<button
					v-if="status === 'pending'"
					type="button"
					class="btn-regular"
					@click="onWithdraw"
				>
					撤回审核
				</button>
				<button
					v-else
					type="button"
					class="btn-regular"
					:disabled="!editable || saveState === 'saving'"
					@click="save()"
				>
					<AppIcon name="save" :size="15" />
					保存
				</button>
				<button
					v-if="editable && !isRepo"
					type="button"
					class="btn-primary"
					@click="isAdmin ? onPublish() : onSubmit()"
				>
					{{ isAdmin ? "发布" : "提交审核" }}
				</button>
				<button
					v-if="isRepo"
					type="button"
					class="btn-ghost danger"
					@click="onDeleteRepo"
				>
					删除
				</button>
			</template>
		</PageHeader>

		<p v-if="errorText" class="error">{{ errorText }}</p>
		<LoadingState v-if="loading" variant="doc" :rows="5" />

		<template v-else>
			<div class="edit-layout">
				<div class="col-main">
					<section
						v-if="!isRepo && (reviewVerdict || reviewNotes.length || reviewBody)"
						class="card-base panel review-card"
					>
						<div class="review-head">
							<p class="panel-title">审核意见</p>
							<span v-if="reviewNotes.length" class="review-count">
								{{ reviewNotes.length }} 条批注
							</span>
						</div>
						<p v-if="reviewVerdict" class="review-verdict">{{ reviewVerdict }}</p>
						<ul v-if="reviewNotes.length" class="review-notes">
							<li
								v-for="(item, index) in reviewNotes"
								:key="item.id"
								:class="{ active: notePopover?.index === index }"
								role="button"
								tabindex="0"
								@click="focusNote(index)"
								@keydown.enter.prevent="focusNote(index)"
							>
								<p class="rn-quote">
									<span class="rn-idx">{{ index + 1 }}</span>
									{{ item.quote }}
								</p>
								<p class="rn-text">{{ item.note }}</p>
								<p class="rn-by">{{ item.reviewer }}</p>
							</li>
						</ul>
						<div v-if="reviewBody" class="rb-tip">
							<p class="rb-title">审核员直接改了一版正文，可以用作参考</p>
							<div class="rb-actions">
								<button type="button" class="btn-regular" @click="openReviewBody">
									看看改了什么
								</button>
								<button type="button" class="btn-primary" @click="applyReviewBody">
									用这版覆盖
								</button>
							</div>
						</div>
						<p class="rn-hint">
							<template v-if="!noteScanned || noteMatchCount > 0">
								正文里带底色的句子就是被划的重点，点一下能看批注；按条改完再提交审核。
							</template>
							<template v-else>
								这几段原文在正文里已经找不到了（可能改过），照批注的意思改就行。
							</template>
						</p>
					</section>

					<section class="card-base panel editor-panel">
						<div class="doc-head">
							<div class="doc-label">
								<span>标题</span>
								<code class="fm-key">title</code>
								<span
									v-if="saveHint"
									class="save-state"
									:data-state="saveState"
								>{{ saveHint }}</span>
							</div>
							<input
								id="post-title"
								v-model="form.title"
								class="doc-title"
								maxlength="120"
								:disabled="!editable"
								placeholder="文章标题"
								@input="onFieldInput"
							/>
							<div class="doc-sub">
								<code class="slug-tag">/posts/{{ form.slug || "…" }}/</code>
								<span class="pill" :data-status="isRepo ? 'published' : status">
									{{ isRepo ? "仓库文件" : statusLabel }}
								</span>
								<span
									v-if="isMdx"
									class="mdx-tag"
									title="MDX 里的组件在编辑器里渲染不出来，用「预览页面」看效果"
								>MDX · 源码模式</span>
								<span class="doc-sub-key">正文 <code class="fm-key">body</code></span>
							</div>
						</div>
						<div ref="editorEl" class="editor" @click="onEditorClick" />
					</section>
				</div>

				<aside class="col-rail">
					<section v-for="group in GROUPS" :key="group.title" class="card-base panel">
						<p class="panel-title">{{ group.title }}</p>
						<p v-if="group.note" class="panel-hint">{{ group.note }}</p>

						<div v-for="def in rowDefs(group)" :key="def.key" class="field-row">
							<label v-if="def.kind !== 'bool'" class="field-label" :for="`f-${def.key}`">
								{{ def.label }}
								<code class="fm-key">{{ def.key }}</code>
								<code v-if="def.kind === 'series'" class="fm-key">seriesOrder</code>
							</label>

							<template v-if="def.kind === 'provenance'">
								<div class="prov">
									<div class="prov-kinds">
										<button
											v-for="kind in PROV_KINDS"
											:key="kind.value"
											type="button"
											class="prov-kind"
											:class="{ on: prov.kind === kind.value }"
											:disabled="!editable"
											@click="
												prov.kind = kind.value;
												onFieldInput();
											"
										>
											{{ kind.label }}
										</button>
									</div>
									<div v-if="prov.kind && prov.kind !== 'handwritten'" class="prov-detail">
										<input
											v-model="prov.model"
											class="field"
											placeholder="模型，如 DeepSeek-V4.1-Flash"
											:disabled="!editable"
											@input="onFieldInput"
										/>
										<input
											v-model="prov.agent"
											class="field"
											placeholder="Agent / 工具，如 WorkBuddy"
											:disabled="!editable"
											@input="onFieldInput"
										/>
										<input
											v-model="prov.note"
											class="field"
											placeholder="备注，如：大纲由模型给出，正文自己重写"
											:disabled="!editable"
											@input="onFieldInput"
										/>
									</div>
								</div>
							</template>

							<template v-else-if="def.kind === 'bool'">
								<label class="check-row" :for="`f-${def.key}`">
									<input
										:id="`f-${def.key}`"
										v-model="flags[def.key]"
										type="checkbox"
										:disabled="!editable"
										@change="onFieldInput"
									/>
									<span>{{ def.label }}</span>
									<code class="fm-key">{{ def.key }}</code>
								</label>
							</template>

							<template v-else-if="def.kind === 'tags'">
								<input
									:id="`f-${def.key}`"
									v-model="vals.tags"
									class="field"
									:disabled="!editable"
									:placeholder="def.placeholder"
									@input="onFieldInput"
								/>
							</template>

							<template v-else-if="def.kind === 'series'">
								<div class="series-row">
									<button
										type="button"
										class="picker-btn"
										:disabled="!editable"
										@click="openSeries"
									>
										<span
											class="picker-val"
											:class="{ 'is-empty': !textOf('series').trim() }"
										>
											{{ textOf("series").trim() || def.placeholder }}
										</span>
										<AppIcon name="chevron" :size="14" />
									</button>
									<input
										id="f-seriesOrder"
										v-model="vals.seriesOrder"
										class="field order-input"
										type="number"
										min="1"
										:disabled="!editable || !textOf('series').trim()"
										placeholder="序号"
										aria-label="系列序号"
										@input="onFieldInput"
									/>
								</div>
								<p v-if="seriesOrderHint" class="field-hint order-hint">
									{{ seriesOrderHint }}
									<button
										v-if="editable && canSuggestOrder"
										type="button"
										class="hint-btn"
										@click="useNextOrder"
									>
										填 {{ nextFreeOrder }}
									</button>
								</p>
							</template>

							<template v-else-if="def.kind === 'image'">
								<div class="cover-row">
									<img
										v-if="coverPreview"
										class="cover-thumb"
										:src="coverPreview"
										alt=""
										@error="onCoverError"
									/>
									<input
										:id="`f-${def.key}`"
										v-model="vals.image"
										class="field"
										:disabled="!editable"
										:placeholder="def.placeholder"
										@input="
											coverBroken = false;
											coverTry = 0;
											onFieldInput();
										"
									/>
									<button
										type="button"
										class="cover-pick"
										:disabled="!editable"
										title="从媒体库里挑一张，或直接上传"
										@click="coverPicker = true"
									>
										<AppIcon name="image" :size="14" />
									</button>
								</div>
							</template>

							<template v-else-if="def.key === 'slug'">
								<div class="slug-wrap">
									<span class="slug-prefix">/posts/</span>
									<input
										id="f-slug"
										v-model="form.slug"
										class="field slug-input"
										maxlength="60"
										:disabled="!editable"
										:placeholder="def.placeholder"
										@input="onFieldInput"
									/>
									<span class="slug-prefix">/</span>
								</div>
								<p class="field-hint">
									2–60 位小写字母、数字与连字符，发布后不要再改。
								</p>
							</template>

							<textarea
								v-else-if="def.kind === 'textarea'"
								:id="`f-${def.key}`"
								v-model="vals[def.key]"
								class="field summary"
								rows="3"
								maxlength="300"
								:disabled="!editable"
								:placeholder="def.placeholder"
								@input="onFieldInput"
							/>

							<input
								v-else
								:id="`f-${def.key}`"
								v-model="vals[def.key]"
								class="field"
								:type="
									def.kind === 'number'
										? 'number'
										: def.kind === 'password'
											? 'password'
											: 'text'
								"
								:disabled="!editable"
								:placeholder="def.placeholder"
								@input="onFieldInput"
							/>
							<p v-if="def.hint" class="field-hint">{{ def.hint }}</p>
						</div>
					</section>

					<section class="card-base panel">
						<p class="panel-title">
							自定义属性
							<span class="panel-count">{{ custom.length }}</span>
						</p>
						<p class="panel-hint">
							schema 之外要写的键放这里，按原样写进 frontmatter；同名的会用模板里的值。
						</p>

						<div v-for="(row, index) in custom" :key="index" class="custom-row">
							<input
								v-model="row.key"
								class="field custom-key"
								placeholder="key"
								:disabled="!editable || row.type === 'object'"
								@input="onFieldInput"
							/>
							<input
								v-model="row.value"
								class="field custom-value"
								:placeholder="row.type === 'list' ? '用逗号分隔' : 'value'"
								:disabled="!editable || row.type === 'object'"
								@input="onFieldInput"
							/>
							<button
								type="button"
								class="row-del"
								title="删除这条属性"
								:disabled="!editable"
								@click="removeCustom(index)"
							>
								✕
							</button>
						</div>

						<button type="button" class="add-row" :disabled="!editable" @click="addCustom">
							＋ 添加属性
						</button>
					</section>
				</aside>
			</div>
		</template>

		<MediaPickerDialog
			v-if="coverPicker"
			context="post"
			:post-dir="postDir"
			:initial="textOf('image')"
			@close="coverPicker = false"
			@select="
				(value) => {
					vals.image = value;
					coverBroken = false;
					coverTry = 0;
					onFieldInput();
				}
			"
		/>

		<MediaPickerDialog
			v-if="bodyPicker"
			context="post"
			:post-dir="postDir"
			@close="bodyPicker = false"
			@select="insertLibraryImage"
		/>

		<SeriesPickerDialog
			v-if="seriesOpen"
			:current="textOf('series')"
			:order="textOf('seriesOrder')"
			:series="seriesList"
			:self-slug="selfSlug"
			:loading="seriesLoading"
			@close="seriesOpen = false"
			@apply="applySeries"
		/>

		<MindMapDialog
			v-if="mmOpen"
			:initial="mmInitial"
			:dark="isDark"
			:notice="mmNotice"
			:target-label="mmTargetLabel"
			@close="mmOpen = false"
			@submit="applyMindMap"
		/>

		<PagePreview
			v-if="previewOpen && previewUrl"
			:url="previewUrl"
			:title="form.title"
			@close="previewOpen = false"
		/>

		<div
			v-if="reviewBodyOpen"
			class="rb-modal"
			@click.self="reviewBodyOpen = false"
		>
			<div class="rb-box card-base">
				<header class="rb-head">
					<p class="panel-title">审核员改过的版本</p>
					<button
						type="button"
						class="btn-ghost"
						@click="reviewBodyOpen = false"
					>
						关闭
					</button>
				</header>
				<div ref="reviewBodyEl" class="rb-content"></div>
				<footer class="rb-foot">
					<p class="rb-note">
						覆盖只会替换编辑器里的正文，保存之后才算数。
					</p>
					<div class="rb-actions">
						<button
							type="button"
							class="btn-regular"
							@click="reviewBodyOpen = false"
						>
							先只看看
						</button>
						<button type="button" class="btn-primary" @click="applyReviewBody">
							用这版覆盖正文
						</button>
					</div>
				</footer>
			</div>
		</div>

		<div
			v-if="notePopover"
			class="note-pop card-base"
			:style="{ top: `${notePopover.top}px`, left: `${notePopover.left}px` }"
		>
			<p class="note-pop-head">
				<span class="rn-idx">{{ notePopover.index + 1 }}</span>
				<span class="note-pop-by">{{ notePopover.note.reviewer }} 的批注</span>
				<button
					type="button"
					class="note-pop-close"
					aria-label="关闭批注"
					@click="closeNotePopover"
				>
					✕
				</button>
			</p>
			<p class="note-pop-text">{{ notePopover.note.note }}</p>
			<p class="note-pop-quote">「{{ notePopover.note.quote }}」</p>
		</div>
	</div>
</template>

<style scoped>
.panel {
	padding: 0.9rem 1rem;
	margin-bottom: 0.75rem;
}

.panel-title {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	margin: 0;
	font-size: 0.8rem;
	font-weight: 600;
	color: var(--fg-75);
}

/* 审核意见：总评一段，下面按条列批注，作者照着改 */
.review-card {
	border-color: color-mix(
		in oklab,
		var(--admonitions-color-caution) 40%,
		var(--line-divider)
	);
	background: color-mix(
		in oklab,
		var(--admonitions-color-caution) 5%,
		var(--card-bg)
	);
}

/* 审核员改的那一版：跟批注分开，别让作者以为批注已经自动改进了正文 */
.rb-tip {
	margin-top: 0.75rem;
	padding: 0.7rem 0.8rem;
	border: 1px solid var(--line-divider);
	border-radius: 0.7rem;
	background: var(--card-bg);
}

.rb-title {
	margin: 0 0 0.55rem;
	font-size: 0.78rem;
	color: var(--fg-90);
}

.rb-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.rb-modal {
	position: fixed;
	inset: 0;
	z-index: 60;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2rem 1rem;
	background: rgba(0, 0, 0, 0.45);
}

.rb-box {
	display: flex;
	flex-direction: column;
	width: min(46rem, 100%);
	max-height: 82vh;
	padding: 1rem 1.1rem;
	border-radius: 0.9rem;
}

.rb-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	padding-bottom: 0.6rem;
	border-bottom: 1px solid var(--line-divider);
}

/* Vditor.preview 把 .vditor-reset 加在容器本身上，所以字号字体要写在容器上 */
.rb-content {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 0.85rem 0.1rem;
	font-family: inherit;
	font-size: 0.9rem;
	line-height: 1.75;
}

.rb-foot {
	padding-top: 0.7rem;
	border-top: 1px solid var(--line-divider);
}

.rb-note {
	margin: 0 0 0.55rem;
	font-size: 0.73rem;
	color: var(--fg-50);
}

.review-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
}

.review-count {
	padding: 0 0.4rem;
	border-radius: 999px;
	background: color-mix(
		in oklab,
		var(--admonitions-color-caution) 18%,
		transparent
	);
	color: var(--admonitions-color-caution);
	font-size: 0.68rem;
}

.review-verdict {
	margin: 0.45rem 0 0;
	font-size: 0.83rem;
	line-height: 1.7;
	color: var(--fg-90);
}

.review-notes {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
	margin: 0.55rem 0 0;
	padding: 0;
	list-style: none;
}

.review-notes li {
	padding: 0.5rem 0.6rem;
	border-radius: 0.55rem;
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	cursor: pointer;
	transition:
		border-color 0.15s ease,
		box-shadow 0.15s ease;
}

.review-notes li:hover,
.review-notes li:focus-visible {
	border-color: color-mix(
		in oklab,
		var(--admonitions-color-caution) 45%,
		var(--line-divider)
	);
	outline: none;
}

.review-notes li.active {
	border-color: var(--admonitions-color-caution);
	box-shadow: 0 0 0 2px
		color-mix(in oklab, var(--admonitions-color-caution) 18%, transparent);
}

/* 点正文里的高亮弹出来的批注气泡 */
.note-pop {
	position: fixed;
	z-index: 70;
	width: 19rem;
	padding: 0.6rem 0.7rem 0.65rem;
	border-radius: 0.7rem;
	border-color: color-mix(
		in oklab,
		var(--admonitions-color-caution) 45%,
		var(--line-divider)
	);
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
}

.note-pop-head {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	margin: 0 0 0.35rem;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.note-pop-by {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.note-pop-close {
	padding: 0 0.1rem;
	border: none;
	background: none;
	color: var(--fg-50);
	font-size: 0.75rem;
	cursor: pointer;
}

.note-pop-close:hover {
	color: var(--fg-90);
}

.note-pop-text {
	margin: 0;
	font-size: 0.82rem;
	line-height: 1.7;
	color: var(--fg-90);
}

.note-pop-quote {
	margin: 0.35rem 0 0;
	font-size: 0.72rem;
	line-height: 1.6;
	color: var(--fg-50);
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.rn-quote {
	margin: 0;
	font-size: 0.75rem;
	line-height: 1.65;
	color: var(--fg-50);
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.rn-idx {
	display: inline-block;
	margin-right: 0.3rem;
	padding: 0 0.28rem;
	border-radius: 0.3rem;
	background: color-mix(
		in oklab,
		var(--admonitions-color-caution) 22%,
		transparent
	);
	color: var(--admonitions-color-caution);
	font-size: 0.66rem;
	font-weight: 600;
}

.rn-text {
	margin: 0.3rem 0 0;
	font-size: 0.8rem;
	line-height: 1.7;
	color: var(--fg-90);
}

.rn-by {
	margin: 0.25rem 0 0;
	font-size: 0.66rem;
	color: var(--fg-50);
}

.rn-hint {
	margin: 0.5rem 0 0;
	font-size: 0.7rem;
	color: var(--fg-50);
}

.panel-count {
	color: var(--fg-30);
	font-weight: 500;
}

.panel-hint {
	margin: 0.2rem 0 0;
	font-size: 0.68rem;
	line-height: 1.5;
	color: var(--fg-50);
}

.check-row {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	font-size: 0.78rem;
	color: var(--fg-75);
	cursor: pointer;
}

.check-row input {
	accent-color: var(--primary);
}

.btn-ghost.danger {
	color: var(--admonitions-color-caution);
}

.btn-ghost.danger:hover {
	background: color-mix(in oklab, var(--admonitions-color-caution) 12%, transparent);
}

.field-row {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	margin-bottom: 0.7rem;
}

.field-row:last-child {
	margin-bottom: 0;
}

.field-label {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	font-size: 0.72rem;
	font-weight: 600;
	color: var(--fg-50);
}

/* frontmatter 里的原始键名，方便对着源码 / 文档改 */
.fm-key {
	padding: 0.02rem 0.3rem;
	border-radius: 0.28rem;
	background: var(--license-block-bg);
	color: var(--fg-50);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.62rem;
	font-weight: 500;
}

:root.dark .fm-key {
	background: rgba(255, 255, 255, 0.07);
}

.field-hint {
	margin: 0;
	font-size: 0.66rem;
	color: var(--fg-50);
}

/* 属性栏里的输入框比全局小一档：14px 的正文在这里显得笨重 */
.field {
	padding: 0.4rem 0.6rem;
	border-radius: 0.55rem;
	font-size: 0.78rem;
}

.slug-wrap {
	display: flex;
	align-items: center;
	gap: 0.3rem;
}

.slug-prefix {
	flex: none;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.slug-input {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.76rem;
}

.summary {
	line-height: 1.55;
	resize: vertical;
}

/* ---- 系列选择器：长得像输入框，点开是弹窗 ---- */
.series-row {
	display: flex;
	align-items: center;
	gap: 0.35rem;
}

.picker-btn {
	display: flex;
	flex: 1;
	min-width: 0;
	align-items: center;
	justify-content: space-between;
	gap: 0.4rem;
	padding: 0.4rem 0.6rem;
	border: 1px solid var(--line-divider);
	border-radius: 0.55rem;
	background: rgba(0, 0, 0, 0.025);
	color: var(--fg-90);
	font-size: 0.78rem;
	text-align: left;
	transition:
		border-color 0.15s ease,
		background-color 0.15s ease;
}

:root.dark .picker-btn {
	background: rgba(255, 255, 255, 0.06);
}

/* 序号跟着系列走，窄到只放得下两三位数 */
.order-input {
	flex: none;
	width: 3.6rem;
	padding: 0.4rem 0.3rem;
	text-align: center;
	font-variant-numeric: tabular-nums;
	-moz-appearance: textfield;
	appearance: textfield;
}

.order-input::-webkit-outer-spin-button,
.order-input::-webkit-inner-spin-button {
	margin: 0;
	-webkit-appearance: none;
}

.picker-btn:hover:not(:disabled) {
	border-color: var(--primary);
	background: var(--btn-plain-bg-hover);
}

.picker-btn:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.picker-val {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.picker-val.is-empty {
	color: var(--fg-30);
}

/* 序号提示后面挂一个「填 N」，省得自己数空位 */
.order-hint {
	display: flex;
	align-items: center;
	gap: 0.35rem;
}

.hint-btn {
	padding: 0.04rem 0.4rem;
	border: 1px dashed var(--line-color);
	border-radius: 999px;
	background: transparent;
	color: var(--fg-75);
	font-size: 0.66rem;
}

.hint-btn:hover {
	border-color: var(--primary);
	color: var(--accent-text);
}

.cover-row {
	display: flex;
	align-items: center;
	gap: 0.45rem;
}

.cover-thumb {
	width: 2.2rem;
	height: 2.2rem;
	flex: none;
	border-radius: 0.45rem;
	border: 1px solid var(--line-divider);
	object-fit: cover;
	background: var(--btn-regular-bg);
}

/* 封面输入框右边的「选图」：跟输入框等高，别喧宾夺主 */
.cover-pick {
	display: grid;
	flex: none;
	place-items: center;
	width: 2rem;
	height: 2rem;
	border: 1px solid var(--line-divider);
	border-radius: 0.5rem;
	background: transparent;
	color: var(--fg-50);
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.cover-pick:hover:not(:disabled) {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.cover-pick:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

/* ---- 代笔声明：三档用胶囊选择，比下拉更好扫 ---- */
.prov {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.prov-kinds {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem;
}

.prov-kind {
	padding: 0.25rem 0.5rem;
	border: 1px solid var(--line-divider);
	border-radius: 999px;
	background: transparent;
	color: var(--fg-75);
	font-size: 0.72rem;
	transition:
		background-color 0.15s ease,
		border-color 0.15s ease,
		color 0.15s ease;
}

.prov-kind:hover {
	background: var(--btn-plain-bg-hover);
}

.prov-kind.on {
	border-color: transparent;
	background: var(--tab-on-bg);
	color: var(--accent-text);
	font-weight: 600;
}

.prov-kind:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.prov-detail {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
}

/* ---- 自定义属性 ---- */
.custom-row {
	display: grid;
	grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr) 1.4rem;
	gap: 0.3rem;
	align-items: center;
	margin-bottom: 0.3rem;
}

.custom-key {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.72rem;
}

.custom-value {
	font-size: 0.74rem;
}

.row-del {
	display: grid;
	place-items: center;
	width: 1.4rem;
	height: 1.4rem;
	border: none;
	border-radius: 0.4rem;
	background: transparent;
	color: var(--fg-50);
	font-size: 0.7rem;
}

.row-del:hover {
	background: color-mix(in oklab, var(--admonitions-color-caution) 12%, transparent);
	color: var(--admonitions-color-caution);
}

.add-row {
	width: 100%;
	margin-top: 0.15rem;
	padding: 0.35rem;
	border: 1px dashed var(--line-color);
	border-radius: 0.5rem;
	background: transparent;
	color: var(--fg-50);
	font-size: 0.72rem;
}

.add-row:hover {
	border-color: var(--primary);
	color: var(--accent-text);
}

/* 正文占主列，属性收进右侧栏：编辑器才能吃掉整屏高度 */
.edit-layout {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 18.5rem;
	gap: 1rem;
	align-items: start;
}

.col-main {
	min-width: 0;
	/* 属性栏比正文高得多，正文若不粘住，往下滚左边就空出一大片白。
	   粘住之后正文始终占满一屏，属性栏自己往下滚 */
	position: sticky;
	top: 0.5rem;
	height: calc(100vh - 1rem);
}

.col-rail {
	display: flex;
	flex-direction: column;
}

.col-rail .panel {
	margin-bottom: 0.7rem;
}

.col-rail .panel:last-child {
	margin-bottom: 0;
}

.col-rail .panel-title {
	margin: 0 0 0.55rem;
}

.panel.editor-panel {
	display: flex;
	flex-direction: column;
	/* 高度跟着 .col-main 走：视口多高，编辑器就多高 */
	height: 100%;
	min-height: 30rem;
	padding: 0;
	margin-bottom: 0;
	overflow: hidden;
}

.doc-head {
	display: flex;
	flex-direction: column;
	flex: none;
	gap: 0.35rem;
	padding: 0.8rem 1rem 0.55rem;
	border-bottom: 1px solid var(--line-divider);
}

.doc-label {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	font-size: 0.68rem;
	font-weight: 600;
	color: var(--fg-50);
}

.doc-title {
	width: 100%;
	padding: 0;
	border: none;
	background: transparent;
	color: var(--fg-90);
	font-size: 1.2rem;
	font-weight: 700;
	line-height: 1.35;
	outline: none;
}

.doc-title::placeholder {
	color: var(--fg-30);
}

.doc-sub {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.35rem;
	font-size: 0.68rem;
	color: var(--fg-50);
}

.slug-tag {
	font-size: 0.68rem;
	color: var(--fg-50);
}

.doc-sub-key {
	margin-left: auto;
	color: var(--fg-50);
}

.mdx-tag {
	padding: 0.02rem 0.4rem;
	border-radius: 999px;
	background: color-mix(in oklab, var(--admonitions-color-note) 16%, transparent);
	color: var(--admonitions-color-note);
	font-size: 0.64rem;
	font-weight: 600;
}

.save-state {
	margin-left: auto;
	font-size: 0.68rem;
	font-weight: 500;
	color: var(--fg-50);
}

.save-state[data-state="dirty"] {
	color: var(--admonitions-color-warning);
}

.save-state[data-state="error"] {
	color: var(--admonitions-color-caution);
}

.pill {
	padding: 0.02rem 0.4rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.64rem;
	font-weight: 600;
}

.pill[data-status="published"] {
	background: color-mix(in oklab, var(--admonitions-color-tip) 18%, transparent);
	color: var(--admonitions-color-tip);
}

.pill[data-status="pending"] {
	background: color-mix(in oklab, var(--admonitions-color-warning) 18%, transparent);
	color: var(--admonitions-color-warning);
}

.pill[data-status="rejected"] {
	background: color-mix(in oklab, var(--admonitions-color-caution) 16%, transparent);
	color: var(--admonitions-color-caution);
}

.editor {
	flex: 1;
	min-height: 0;
}

/* Vditor 会把容器元素本身变成 .vditor（类名挂在同一个节点上），
   所以这里不能写后代选择器，否则规则永远不生效 */
.editor.vditor:not(.vditor--fullscreen) {
	height: 100% !important;
	border: none;
	border-radius: 0;
	background: transparent;
}

/* Vditor 自带深色是 #24292e，比卡片亮一档，铺满整屏后就是一块发灰的补丁 */
.editor.vditor--dark {
	--panel-background-color: var(--card-bg);
	--textarea-background-color: var(--card-bg);
}

.editor :deep(.vditor-toolbar) {
	background: transparent;
	border-bottom-color: var(--line-divider);
	/* Vditor 会用行内 padding-left 把工具栏居中，与整站的左对齐语言不一致 */
	padding-left: 0.6rem !important;
}

.editor :deep(.vditor-reset) {
	font-size: 0.9rem;
	line-height: 1.7;
}

.error {
	margin: 0 0 0.6rem;
	padding: 0.4rem 0.65rem;
	border-radius: 0.55rem;
	background: color-mix(in oklab, var(--admonitions-color-caution) 14%, transparent);
	color: var(--admonitions-color-caution);
	font-size: 0.78rem;
}

.state {
	padding: 2rem 1rem;
	text-align: center;
	font-size: 0.82rem;
	color: var(--fg-50);
}

/* 窄屏：属性栏落到正文下面，编辑器不再强行一屏高 */
@media (max-width: 1180px) {
	.edit-layout {
		grid-template-columns: minmax(0, 1fr);
	}

	.col-main {
		position: static;
		height: auto;
	}

	.panel.editor-panel {
		height: min(75vh, 44rem);
		min-height: 26rem;
	}
}
</style>

<style>
/*
 * 正文里被批注的原文：走 CSS Custom Highlight API 上色，不往 DOM 里插标签。
 * 编辑器保存时读的是 DOM，插 <mark> 会被序列化进 Markdown，所以只能这么染。
 * ::highlight() 不能带选择器，只能放在非 scoped 的样式块里。
 */
::highlight(yb-review-note) {
	background-color: color-mix(
		in oklab,
		var(--admonitions-color-caution) 30%,
		transparent
	);
	text-decoration: underline dashed
		color-mix(in oklab, var(--admonitions-color-caution) 70%, transparent);
	text-underline-offset: 0.18em;
}
</style>
