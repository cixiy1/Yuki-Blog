<script setup lang="ts">
import Vditor from "vditor";
import "vditor/dist/index.css";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import { ApiError } from "../lib/api";
import {
	getSpecPage,
	type SpecPageDetail,
	saveSpecPage,
	specPageUrl,
} from "../lib/pages";
import { isDark } from "../lib/theme";
import { go, route } from "../router";

/**
 * 站点单页编辑器：正文整份回写仓库文件，保存即上线。
 * 用分屏源码模式（sv）而不是即时渲染（ir）：关于我里有大段裸 HTML，
 * ir 模式会把它们当成节点重排，存回去 diff 就全乱了。
 */
const file = computed(() => route.value.pageFile ?? "");

const page = ref<SpecPageDetail | null>(null);
const loading = ref(true);
const errorText = ref("");
const noteText = ref("");
const saving = ref(false);
const dirty = ref(false);

const title = ref("");
const description = ref("");
const body = ref("");

const editorEl = ref<HTMLElement | null>(null);
let vditor: Vditor | null = null;

const canSave = computed(
	() =>
		!loading.value &&
		!saving.value &&
		dirty.value &&
		body.value.trim().length > 0,
);

function onInput(value: string): void {
	body.value = value;
	dirty.value = true;
	noteText.value = "";
}

function createEditor(): void {
	if (!editorEl.value) return;
	vditor = new Vditor(editorEl.value, {
		cdn: "/admin/vditor",
		value: body.value,
		mode: "sv",
		lang: "zh_CN",
		height: 620,
		resize: { enable: false },
		theme: isDark.value ? "dark" : "classic",
		cache: { enable: false },
		placeholder: "页面正文…",
		toolbar: [
			"headings",
			"bold",
			"italic",
			"strike",
			"|",
			"list",
			"ordered-list",
			"check",
			"|",
			"quote",
			"line",
			"code",
			"inline-code",
			"|",
			"table",
			"link",
			"|",
			"undo",
			"redo",
			"|",
			"fullscreen",
		],
		preview: {
			theme: { current: isDark.value ? "dark" : "light" },
			hljs: { style: isDark.value ? "monokai" : "github", lineNumber: true },
			math: { engine: "KaTeX" },
		},
		input: onInput,
	});
}

async function load(): Promise<void> {
	loading.value = true;
	errorText.value = "";
	try {
		const data = await getSpecPage(file.value);
		if (!data) {
			errorText.value = "找不到这个页面";
			return;
		}
		page.value = data;
		title.value = data.title;
		description.value = data.description;
		body.value = data.body;
		dirty.value = false;
	} catch (error) {
		errorText.value =
			error instanceof ApiError ? error.message : "读取失败，稍后重试";
	} finally {
		loading.value = false;
	}
	await nextTick();
	if (!vditor) createEditor();
	else vditor.setValue(body.value, false);
}

async function save(): Promise<void> {
	if (!canSave.value) return;
	saving.value = true;
	errorText.value = "";
	noteText.value = "";
	try {
		await saveSpecPage({
			file: file.value,
			title: title.value,
			description: description.value,
			body: body.value,
		});
		dirty.value = false;
		noteText.value = "已提交，约一分钟后构建完成即可在线看到";
	} catch (error) {
		errorText.value =
			error instanceof ApiError ? error.message : "保存失败，稍后重试";
	} finally {
		saving.value = false;
	}
}

function back(): void {
	go("/pages");
}

onMounted(load);

onBeforeUnmount(() => {
	vditor?.destroy();
	vditor = null;
});
</script>

<template>
	<div>
		<PageHeader
			:title="page?.title || '页面'"
			:desc="`src/content/spec/${file}`"
		>
			<template #actions>
				<button type="button" class="btn-regular" @click="back">
					<AppIcon name="back" :size="15" />
					返回
				</button>
				<a
					v-if="page"
					class="btn-regular"
					:href="specPageUrl(file)"
					target="_blank"
					rel="noopener"
				>
					<AppIcon name="external" :size="14" />
					线上查看
				</a>
				<button
					type="button"
					class="btn-primary"
					:disabled="!canSave"
					@click="save"
				>
					<AppIcon name="save" :size="15" />
					{{ saving ? "保存中…" : "保存并上线" }}
				</button>
			</template>
		</PageHeader>

		<p v-if="errorText" class="error">{{ errorText }}</p>
		<p v-if="noteText" class="note">{{ noteText }}</p>

		<LoadingState v-if="loading" variant="doc" label="读取页面" />

		<template v-else-if="page">
			<div v-if="page.hasFrontmatter" class="card-base meta">
				<label class="field">
					<span class="label">标题</span>
					<input
						v-model="title"
						class="input"
						type="text"
						maxlength="120"
						@input="dirty = true"
					/>
				</label>
				<label class="field">
					<span class="label">描述</span>
					<input
						v-model="description"
						class="input"
						type="text"
						maxlength="300"
						placeholder="显示在标题下方的一句话，留空则不显示"
						@input="dirty = true"
					/>
				</label>
			</div>

			<p v-else class="hint">
				这个文件没有 frontmatter，页面标题写在正文第一行的 <code># 标题</code> 里。
			</p>

			<div class="card-base editor-card">
				<div ref="editorEl" class="editor" />
			</div>

			<p class="footnote">
				正文里的 Markdown、HTML 与 frontmatter 之外的原始内容都会原样写回。
				保存即提交到仓库并触发构建，没有草稿这一步。
			</p>
		</template>
	</div>
</template>

<style scoped>
.error,
.note {
	margin: 0 0 1rem;
	padding: 0.7rem 0.9rem;
	border-radius: 0.7rem;
	font-size: 0.84rem;
}

.error {
	background: var(--btn-regular-bg);
	color: var(--fg-90);
}

.note {
	background: var(--tab-on-bg);
	color: var(--accent-text);
}

.meta {
	display: grid;
	gap: 0.9rem;
	padding: 1rem 1.1rem;
	margin-bottom: 1rem;
}

.field {
	display: grid;
	gap: 0.35rem;
}

.label {
	color: var(--fg-50);
	font-size: 0.78rem;
	font-weight: 600;
}

.input {
	height: 2.35rem;
	padding: 0 0.7rem;
	border: 1px solid var(--line-divider);
	border-radius: 0.6rem;
	background: var(--card-bg);
	color: var(--fg-90);
	font-size: 0.88rem;
	outline: none;
	transition: border-color 0.15s ease;
}

.input:focus {
	border-color: var(--primary);
}

.hint {
	margin: 0 0 1rem;
	color: var(--fg-50);
	font-size: 0.8rem;
}

.hint code,
.footnote code {
	padding: 0.05rem 0.3rem;
	border-radius: 0.35rem;
	background: var(--btn-regular-bg);
	font-size: 0.75rem;
}

.editor-card {
	overflow: hidden;
	padding: 0.25rem;
}

/* Vditor 会把 .vditor 挂到容器本身上，圆角得按内层裁 */
.editor :deep(.vditor) {
	border: none;
	border-radius: 0.9rem;
	background: transparent;
}

.footnote {
	margin: 1rem 0 0;
	color: var(--fg-50);
	font-size: 0.78rem;
	line-height: 1.7;
}
</style>
