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
import {
	formatTime,
	getPost,
	isEditable,
	type PostDetail,
	savePost,
	submitPost,
	withdrawPost,
} from "../lib/posts";
import { isDark } from "../lib/theme";
import { go, route } from "../router";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const postId = computed(() => route.value.id ?? 0);

const form = reactive({
	title: "",
	slug: "",
	summary: "",
	tagsText: "",
	body: "",
	category: "",
	series: "",
});

const status = ref("draft");
const loading = ref(true);
const ready = ref(false);
const saveState = ref<SaveState>("idle");
const errorText = ref("");
const lastSaved = ref<string | null>(null);

const editable = computed(() => isEditable(status.value));

const statusLabel = computed(() => {
	if (status.value === "pending") return "待审";
	if (status.value === "published") return "已发布";
	if (status.value === "rejected") return "被退回";
	return "草稿";
});

const saveHint = computed(() => {
	if (!editable.value) return `当前状态：${statusLabel.value}，不可编辑`;
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

function fill(post: PostDetail): void {
	status.value = post.status;
	lastSaved.value = formatTime(post.updated_at);
	form.title = post.title;
	form.slug = post.slug;
	form.summary = post.summary;
	form.tagsText = post.tags.join(", ");
	form.body = post.body;
	form.category =
		typeof post.meta?.category === "string" ? post.meta.category : "";
	form.series = typeof post.meta?.series === "string" ? post.meta.series : "";
}

function buildPatch(): Record<string, unknown> {
	const tags = form.tagsText
		.split(/[,，]/)
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
	const meta: Record<string, unknown> = {};
	if (form.category.trim()) meta.category = form.category.trim();
	if (form.series.trim()) meta.series = form.series.trim();
	return {
		title: form.title.trim(),
		slug: form.slug.trim(),
		summary: form.summary,
		tags,
		body: form.body,
		meta,
	};
}

async function save(): Promise<boolean> {
	if (!editable.value || !ready.value) return false;
	saveState.value = "saving";
	errorText.value = "";
	try {
		const post = await savePost(postId.value, buildPatch());
		if (post) {
			status.value = post.status;
			lastSaved.value = formatTime(post.updated_at);
		}
		saveState.value = "saved";
		return true;
	} catch (error) {
		errorText.value =
			error instanceof ApiError ? error.message : "保存失败，请重试";
		saveState.value = "error";
		return false;
	}
}

function scheduleSave(): void {
	if (!editable.value) return;
	saveState.value = "dirty";
	if (timer !== null) window.clearTimeout(timer);
	timer = window.setTimeout(() => {
		timer = null;
		void save();
	}, 1500);
}

function onFieldInput(): void {
	scheduleSave();
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

async function onUpload(files: File[]): Promise<void> {
	// 图片上传在下一步接入 /api/media，这里先明确告知，避免静默失败
	const names = files.map((file) => file.name).join("、");
	errorText.value = `图片上传还没接（${names}）。下一步做媒体与组件时一起接。`;
	saveState.value = "error";
}

function createEditor(): void {
	if (!editorEl.value) return;
	vditor = new Vditor(editorEl.value, {
		cdn: "/admin/vditor",
		value: form.body,
		mode: "ir",
		lang: "zh_CN",
		height: 560,
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
			handler: (files: File[]) => {
				void onUpload(files);
				return null;
			},
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

onMounted(async () => {
	let loaded: PostDetail | null = null;
	try {
		loaded = await getPost(postId.value);
		if (!loaded) errorText.value = "文章不存在";
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}

	// 编辑器容器在 v-else 分支里，必须等 loading 翻掉、DOM 挂上之后才能初始化
	await nextTick();
	if (loaded) {
		fill(loaded);
		createEditor();
	}

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
		<PageHeader title="编辑文章" :desc="saveHint">
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
					v-if="editable"
					type="button"
					class="btn-primary"
					@click="onSubmit"
				>
					提交审核
				</button>
			</template>
		</PageHeader>

		<p v-if="errorText" class="error">{{ errorText }}</p>
		<div v-if="loading" class="state">读取中…</div>

		<template v-else>
			<section class="card-base panel">
				<div class="field-row">
					<label class="field-label" for="post-title">标题</label>
					<input
						id="post-title"
						v-model="form.title"
						class="field"
						maxlength="120"
						:disabled="!editable"
						placeholder="文章标题"
						@input="onFieldInput"
					/>
				</div>

				<div class="field-row">
					<label class="field-label" for="post-slug">地址</label>
					<div class="slug-wrap">
						<span class="slug-prefix">/posts/</span>
						<input
							id="post-slug"
							v-model="form.slug"
							class="field slug-input"
							maxlength="60"
							:disabled="!editable"
							placeholder="my-post-slug"
							@input="onFieldInput"
						/>
						<span class="slug-prefix">/</span>
					</div>
					<p class="field-hint">
						2–60 位小写字母、数字与连字符，站内唯一。发布后不要再改。
					</p>
				</div>

				<div class="field-row">
					<label class="field-label" for="post-summary">摘要</label>
					<input
						id="post-summary"
						v-model="form.summary"
						class="field"
						maxlength="300"
						:disabled="!editable"
						placeholder="列表页显示的一两句话"
						@input="onFieldInput"
					/>
				</div>

				<div class="field-grid">
					<div class="field-row">
						<label class="field-label" for="post-tags">标签</label>
						<input
							id="post-tags"
							v-model="form.tagsText"
							class="field"
							:disabled="!editable"
							placeholder="用逗号分隔，最多 10 个"
							@input="onFieldInput"
						/>
					</div>
					<div class="field-row">
						<label class="field-label" for="post-category">分类</label>
						<input
							id="post-category"
							v-model="form.category"
							class="field"
							:disabled="!editable"
							placeholder="如：编码经验"
							@input="onFieldInput"
						/>
					</div>
					<div class="field-row">
						<label class="field-label" for="post-series">系列</label>
						<input
							id="post-series"
							v-model="form.series"
							class="field"
							:disabled="!editable"
							placeholder="留空表示不属于系列"
							@input="onFieldInput"
						/>
					</div>
				</div>
			</section>

			<section class="card-base panel editor-panel">
				<div class="editor-head">
					<p class="panel-title">正文</p>
					<p class="panel-hint">Ctrl/⌘ + S 立即保存，停手 1.5 秒也会自动保存。</p>
				</div>
				<div ref="editorEl" class="editor" />
			</section>
		</template>
	</div>
</template>

<style scoped>
.panel {
	padding: 1.1rem 1.2rem;
	margin-bottom: 0.9rem;
}

.panel-title {
	margin: 0;
	font-size: 0.85rem;
	font-weight: 600;
	color: var(--fg-75);
}

.panel-hint {
	margin: 0.15rem 0 0;
	font-size: 0.72rem;
	color: var(--fg-30);
}

.field-row {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	margin-bottom: 0.85rem;
}

.field-label {
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--fg-50);
}

.field-hint {
	margin: 0;
	font-size: 0.72rem;
	color: var(--fg-30);
}

.field-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
	gap: 0 0.8rem;
}

.slug-wrap {
	display: flex;
	align-items: center;
	gap: 0.35rem;
}

.slug-prefix {
	font-size: 0.78rem;
	color: var(--fg-30);
	flex: none;
}

.slug-input {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.82rem;
}

.editor-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 1rem;
	margin-bottom: 0.6rem;
}

.editor {
	min-height: 22rem;
}

.editor :deep(.vditor) {
	border-radius: 0.75rem;
	border-color: var(--line-divider);
	background: transparent;
}

.editor :deep(.vditor-toolbar) {
	background: transparent;
	border-bottom-color: var(--line-divider);
}

.editor :deep(.vditor-reset) {
	font-size: 0.9rem;
}

.error {
	margin: 0 0 0.7rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: color-mix(in oklab, var(--admonitions-color-caution) 14%, transparent);
	color: var(--admonitions-color-caution);
	font-size: 0.8rem;
}

.state {
	padding: 2rem 1rem;
	text-align: center;
	font-size: 0.85rem;
	color: var(--fg-50);
}
</style>
