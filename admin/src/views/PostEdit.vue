<script setup lang="ts">
import Vditor from "vditor";
import "vditor/dist/index.css";
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	reactive,
	ref,
	watch,
} from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { ApiError } from "../lib/api";
import { isAdmin } from "../lib/auth";
import { uploadImage } from "../lib/media";
import {
	bodyToPreview,
	bodyToStorage,
	deleteRepoPost,
	type FieldValue,
	formatTime,
	getPost,
	getRepoPost,
	isEditable,
	type PostDetail,
	publishPost,
	type RepoPostDetail,
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
	| "provenance";

interface Def {
	key: string;
	label: string;
	kind: Kind;
	placeholder?: string;
	hint?: string;
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
			{ key: "category", label: "分类", kind: "text", placeholder: "如：编码经验" },
			{ key: "series", label: "系列", kind: "text", placeholder: "留空表示不属于系列" },
			{
				key: "seriesOrder",
				label: "系列序号",
				kind: "number",
				placeholder: "同系列内排序",
			},
			{ key: "image", label: "封面图", kind: "image", placeholder: "站内路径或图片地址" },
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
			{ key: "published", label: "发布日期", kind: "date", placeholder: "2026-11-01" },
			{ key: "updated", label: "更新日期", kind: "date", placeholder: "留空表示没更新过" },
			{ key: "draft", label: "存为草稿", kind: "bool", hint: "draft: true，站点上看不到" },
			{ key: "pinned", label: "置顶", kind: "bool" },
			{ key: "comment", label: "允许评论", kind: "bool" },
		],
	},
	{
		title: "署名与出处",
		defs: [
			{ key: "author", label: "作者", kind: "text", placeholder: "留空表示站主" },
			{ key: "sourceLink", label: "转载来源", kind: "url", placeholder: "留空表示原创" },
			{ key: "lang", label: "语言", kind: "text", placeholder: "zh-CN" },
			{
				key: "licenseName",
				label: "许可协议",
				kind: "text",
				placeholder: "如：CC BY-NC-SA 4.0",
			},
			{ key: "licenseUrl", label: "协议链接", kind: "url", placeholder: "https://…" },
		],
	},
	{
		title: "访问控制",
		note: "设了密码，站点上的正文要输密码才能看",
		defs: [
			{ key: "password", label: "访问密码", kind: "password" },
			{ key: "passwordHint", label: "密码提示", kind: "text", placeholder: "给读者的提示" },
		],
	},
];

const ALL_DEFS: Def[] = GROUPS.flatMap((group) => group.defs);
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
const lastSaved = ref<string | null>(null);

/** 仓库文章没有 D1 状态，能改就是能改；D1 文章要 draft/rejected 才能改 */
const editable = computed(() => (isRepo.value ? true : isEditable(status.value)));

const statusLabel = computed(() => {
	if (status.value === "pending") return "待审";
	if (status.value === "published") return "已发布";
	if (status.value === "rejected") return "被退回";
	return "草稿";
});

/** 页头说明：固定文案，不随保存状态抖动 */
const pageDesc = computed(() => {
	if (!editable.value) return `当前状态：${statusLabel.value}，不可编辑`;
	if (isRepo.value) return "改的是仓库里的文件，保存即提交并触发构建。";
	return "草稿存在 D1，停手 1.5 秒自动保存。";
});

const saveHint = computed(() => {
	if (isRepo.value) {
		if (saveState.value === "saving") return "正在提交到仓库…";
		if (saveState.value === "saved")
			return `已提交 ${lastSaved.value ?? ""}，等构建完成即生效`;
		if (saveState.value === "dirty") return "有改动未保存，点「保存」提交到仓库";
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

const TOOLBAR = [
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

/** 封面可能是不带前导 ./ 的相对路径，管理端下解析不到，转到仓库 raw 上预览 */
const coverBroken = ref(false);
const coverPreview = computed(() => {
	const src = textOf("image").trim();
	if (!src || coverBroken.value) return "";
	if (/^(?:https?:|data:|\/)/i.test(src)) return src;
	return rawBase.value ? `${rawBase.value}${src.replace(/^\.\//, "")}` : "";
});

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
				return { orig: key, key, value: text, initial: text, type: "object" as const };
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
			put(def.key, text.length > 0 && Number.isFinite(num) ? num : null, text.length === 0);
			continue;
		}
		put(def.key, text, text.length === 0);
	}

	for (const row of custom.value) {
		const key = row.key.trim();
		// 改了键名要把老键删掉，否则 frontmatter 里会留下两条
		if (row.orig && row.orig !== key && loadedKeys.has(row.orig)) out[row.orig] = null;
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
		errorText.value = error instanceof Error ? error.message : "提交失败，请重试";
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
		errorText.value = error instanceof Error ? error.message : "保存失败，请重试";
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

function onFieldInput(): void {
	scheduleSave();
}

/** 管理员：保存后直接写成仓库文件，不经过审核队列 */
async function onPublish(): Promise<void> {
	const saved = await save();
	if (!saved) return;
	if (!window.confirm("发布后直接写入仓库并触发构建，约一分钟后站点上线。确定？")) {
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
	if (!window.confirm("提交审核后就不能改，要等审核通过或退回。确定提交？")) {
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
async function onUpload(files: File[]): Promise<string | null> {
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
	return null;
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
		toolbar: TOOLBAR,
		placeholder: "正文…",
		preview: {
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
		},
		after: () => {
			ready.value = true;
			if (!editable.value) vditor?.disabled();
		},
	});
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

	window.addEventListener("keydown", onKeydown);
	window.addEventListener("beforeunload", beforeUnload);
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onKeydown);
	window.removeEventListener("beforeunload", beforeUnload);
	if (timer !== null) window.clearTimeout(timer);
	vditor?.destroy();
	vditor = null;
});

watch(isDark, (dark) => {
	vditor?.setTheme(
		dark ? "dark" : "classic",
		dark ? "dark" : "light",
		dark ? "monokai" : "github",
	);
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
		<div v-if="loading" class="state">读取中…</div>

		<template v-else>
			<div class="edit-layout">
				<div class="col-main">
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
								<span v-if="isMdx" class="mdx-tag">MDX · 源码模式</span>
								<span class="doc-sub-key">正文 <code class="fm-key">body</code></span>
							</div>
						</div>
						<div ref="editorEl" class="editor" />
					</section>
				</div>

				<aside class="col-rail">
					<section v-for="group in GROUPS" :key="group.title" class="card-base panel">
						<p class="panel-title">{{ group.title }}</p>
						<p v-if="group.note" class="panel-hint">{{ group.note }}</p>

						<div v-for="def in group.defs" :key="def.key" class="field-row">
							<label v-if="def.kind !== 'bool'" class="field-label" :for="`f-${def.key}`">
								{{ def.label }}
								<code class="fm-key">{{ def.key }}</code>
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

							<template v-else-if="def.kind === 'image'">
								<div class="cover-row">
									<img
										v-if="coverPreview"
										class="cover-thumb"
										:src="coverPreview"
										alt=""
										@error="coverBroken = true"
									/>
									<input
										:id="`f-${def.key}`"
										v-model="vals.image"
										class="field"
										:disabled="!editable"
										:placeholder="def.placeholder"
										@input="
											coverBroken = false;
											onFieldInput();
										"
									/>
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
