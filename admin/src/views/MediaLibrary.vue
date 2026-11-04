<script setup lang="ts">
/**
 * 媒体库：仓库里的图片资源。
 *
 * 不新建一套存储——`public/assets`、`public/gallery`、`src/content/posts/images`
 * 里已有的文件都在这里，上传的新图落在 `public/assets/uploads/<年>/<月>/`。
 * 列表默认读构建期快照，「刷新索引」现拉一次 GitHub 目录树。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import LoadingState from "../components/LoadingState.vue";
import MediaGrid from "../components/MediaGrid.vue";
import PageHeader from "../components/PageHeader.vue";
import { isAdmin } from "../lib/auth";
import {
	deleteMediaFile,
	formatBytes,
	listMedia,
	type MediaFile,
	uploadMediaFiles,
} from "../lib/media";

const files = ref<MediaFile[]>([]);
const refs = ref<Record<string, string[]>>({});
const generated = ref(0);
const live = ref(false);
const loading = ref(false);
const refreshing = ref(false);
const error = ref("");
const query = ref("");
const origin = ref<"all" | "public" | "content">("all");

const busy = ref(false);
const note = ref("");
const uploadError = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

const detail = ref<MediaFile | null>(null);
const confirmDelete = ref(false);
const copied = ref("");

const visible = computed(() => {
	const keyword = query.value.trim().toLowerCase();
	return files.value.filter((file) => {
		if (origin.value !== "all" && file.origin !== origin.value) return false;
		if (!keyword) return true;
		return (
			file.name.toLowerCase().includes(keyword) ||
			file.path.toLowerCase().includes(keyword)
		);
	});
});

const totalBytes = computed(() =>
	files.value.reduce((sum, file) => sum + file.bytes, 0),
);

const usedByDetail = computed(() =>
	detail.value ? (refs.value[detail.value.name] ?? []) : [],
);

const generatedText = computed(() => {
	if (!generated.value) return "";
	const at = new Date(generated.value);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${at.getMonth() + 1}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
});

async function load(refresh = false): Promise<void> {
	if (refresh) refreshing.value = true;
	else loading.value = true;
	error.value = "";
	try {
		const data = await listMedia(refresh);
		files.value = data.files;
		refs.value = data.refs;
		generated.value = data.generated;
		live.value = data.live;
	} catch (err) {
		error.value = err instanceof Error ? err.message : "读取媒体库失败";
	} finally {
		loading.value = false;
		refreshing.value = false;
	}
}

async function doUpload(list: FileList | File[]): Promise<void> {
	const batch = Array.from(list);
	if (batch.length === 0) return;
	busy.value = true;
	uploadError.value = "";
	note.value = `正在压缩并上传 ${batch.length} 张…`;
	try {
		const result = await uploadMediaFiles(batch);
		const added = [...result.created, ...result.reused];
		if (added.length > 0) {
			files.value = [...added, ...files.value];
			detailed(added[0] ?? null);
		}
		const parts: string[] = [];
		if (result.created.length) parts.push(`新传 ${result.created.length} 张`);
		if (result.reused.length)
			parts.push(`${result.reused.length} 张内容相同，已复用`);
		note.value = `${parts.join("，") || "没有变化"}。构建约 1–2 分钟后站点上才能打开。`;
	} catch (err) {
		uploadError.value = err instanceof Error ? err.message : "上传失败";
		note.value = "";
	} finally {
		busy.value = false;
	}
}

function detailed(file: MediaFile | null): void {
	detail.value = file;
	confirmDelete.value = false;
	copied.value = "";
}

async function copy(text: string, label: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		copied.value = label;
		window.setTimeout(() => {
			if (copied.value === label) copied.value = "";
		}, 1600);
	} catch {
		copied.value = "复制失败，手动选中吧";
	}
}

async function remove(): Promise<void> {
	if (!detail.value) return;
	busy.value = true;
	uploadError.value = "";
	try {
		await deleteMediaFile(detail.value.path);
		files.value = files.value.filter(
			(file) => file.path !== detail.value?.path,
		);
		note.value = `已删除 ${detail.value.name}，构建完成后站点上才会消失。`;
		detailed(null);
	} catch (err) {
		uploadError.value = err instanceof Error ? err.message : "删除失败";
	} finally {
		busy.value = false;
	}
}

function onDrop(event: DragEvent): void {
	event.preventDefault();
	dragging.value = false;
	if (event.dataTransfer?.files.length) void doUpload(event.dataTransfer.files);
}

function onPaste(event: ClipboardEvent): void {
	const items = Array.from(event.clipboardData?.files ?? []);
	if (items.length) {
		event.preventDefault();
		void doUpload(items);
	}
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape" && detail.value) detailed(null);
}

onMounted(() => {
	void load();
	window.addEventListener("paste", onPaste);
	window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
	window.removeEventListener("paste", onPaste);
	window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
	<div class="media-page">
		<PageHeader
			title="媒体库"
			desc="仓库里的图片资源，编辑器插图、封面图、头像都从这里挑；上传的图落在 public/assets/uploads。"
		>
			<template #actions>
				<button
					type="button"
					class="btn-ghost"
					:disabled="refreshing"
					title="走 GitHub 目录树现拉一份，不用等构建"
					@click="load(true)"
				>
					<AppIcon name="refresh" :size="13" />
					{{ refreshing ? "刷新中…" : "刷新索引" }}
				</button>
				<button
					type="button"
					class="btn-primary"
					:disabled="busy"
					@click="fileInput?.click()"
				>
					<AppIcon name="plus" :size="13" />
					上传图片
				</button>
				<input
					ref="fileInput"
					type="file"
					accept="image/*"
					multiple
					hidden
					@change="(event) => doUpload((event.target as HTMLInputElement).files ?? [])"
				/>
			</template>
		</PageHeader>

		<div class="toolbar">
			<input v-model="query" class="field search" placeholder="搜索文件名或路径" />
			<select v-model="origin" class="field filter">
				<option value="all">全部来源</option>
				<option value="public">站点静态</option>
				<option value="content">文章内嵌</option>
			</select>
			<span v-if="!loading" class="count">
				{{ visible.length }} / {{ files.length }} 个文件 · {{ formatBytes(totalBytes) }}
				<span v-if="generatedText">
					· {{ live ? "现拉" : "快照" }} {{ generatedText }}
				</span>
			</span>
		</div>

		<p v-if="note" class="note">{{ note }}</p>
		<p v-if="uploadError" class="note err">{{ uploadError }}</p>

		<div
			class="canvas"
			:class="{ dragging }"
			@dragover.prevent="dragging = true"
			@dragleave="dragging = false"
			@drop="onDrop"
		>
			<LoadingState v-if="loading" variant="grid" :rows="12" />
			<p v-else-if="error" class="empty err">{{ error }}</p>
			<p v-else-if="!visible.length" class="empty">
				这里还没有图。把图片拖进来，或点右上角「上传图片」。
			</p>
			<MediaGrid v-else :files="visible" :selected="detail?.path" @pick="detailed" />
		</div>

		<p class="foot-hint">
			拖拽或粘贴可以直接上传。一批图片合并成一次提交，只触发一次构建；
			文件名按内容摘要生成，同一张图不会存两份。
		</p>

		<div v-if="detail" class="dt-mask" @click.self="detailed(null)">
			<div class="dt-dialog" role="dialog" aria-modal="true" aria-label="图片详情">
				<header class="dt-head">
					<p class="dt-title">{{ detail.name }}</p>
					<button type="button" class="dt-x" title="关闭" @click="detailed(null)">
						<AppIcon name="close" :size="14" />
					</button>
				</header>

				<div class="dt-body">
					<div class="dt-preview">
						<img :src="detail.url" :alt="detail.name" />
					</div>
					<dl class="dt-fields">
						<dt>路径</dt>
						<dd><code>{{ detail.path }}</code></dd>
						<dt>引用写法</dt>
						<dd><code>{{ detail.ref }}</code></dd>
						<dt>大小</dt>
						<dd>{{ formatBytes(detail.bytes) }} · {{ detail.ext }}</dd>
						<dt>用它的文章</dt>
						<dd>
							<span v-if="!usedByDetail.length" class="dt-muted">
								没有文章引用
							</span>
							<template v-else>
								<span v-for="slug in usedByDetail" :key="slug" class="dt-slug">
									{{ slug }}
								</span>
							</template>
						</dd>
					</dl>
				</div>

				<footer class="dt-foot">
					<span v-if="copied" class="dt-copied">{{ copied }}</span>
					<div class="dt-actions">
						<button
							type="button"
							class="btn-regular"
							@click="copy(detail.ref, '引用已复制')"
						>
							复制引用
						</button>
						<button
							type="button"
							class="btn-regular"
							@click="copy(detail.url, '地址已复制')"
						>
							复制地址
						</button>
						<template v-if="isAdmin">
							<button
								v-if="!confirmDelete"
								type="button"
								class="btn-ghost danger"
								:disabled="busy"
								@click="confirmDelete = true"
							>
								<AppIcon name="trash" :size="13" />
								删除
							</button>
							<button
								v-else
								type="button"
								class="btn-ghost danger"
								:disabled="busy"
								@click="remove"
							>
								{{ busy ? "删除中…" : "确认删除" }}
							</button>
						</template>
					</div>
				</footer>
			</div>
		</div>
	</div>
</template>

<style scoped>
.media-page {
	display: flex;
	flex-direction: column;
	min-height: 100%;
}

.toolbar {
	display: flex;
	flex: none;
	align-items: center;
	gap: 0.5rem;
	margin-bottom: 0.8rem;
}

.search {
	flex: 0 1 20rem;
}

.filter {
	flex: none;
	width: 8.5rem;
}

.count {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.note {
	margin: 0 0 0.7rem;
	font-size: 0.74rem;
	color: var(--fg-75);
}

.note.err {
	color: var(--admonitions-color-caution);
}

.canvas {
	flex: 1;
	min-height: 14rem;
	border-radius: 0.7rem;
}

.canvas.dragging {
	outline: 2px dashed var(--primary);
	outline-offset: 4px;
}

.empty {
	margin: 3rem 0;
	text-align: center;
	font-size: 0.78rem;
	color: var(--fg-50);
}

.empty.err {
	color: var(--admonitions-color-caution);
}

.foot-hint {
	margin: 0.9rem 0 0;
	font-size: 0.7rem;
	line-height: 1.6;
	color: var(--fg-50);
}

/* ---- 详情 ---- */
.dt-mask {
	position: fixed;
	inset: 0;
	z-index: 210;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2vh 2vw;
	background: rgb(0 0 0 / 45%);
	backdrop-filter: blur(2px);
}

.dt-dialog {
	display: flex;
	flex-direction: column;
	width: min(40rem, 96vw);
	max-height: min(36rem, 90vh);
	overflow: hidden;
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
}

.dt-head {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.7rem 0.9rem;
	border-bottom: 1px solid var(--line-divider);
}

.dt-title {
	margin: 0;
	font-size: 0.85rem;
	font-weight: 600;
	color: var(--fg-90);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.dt-x {
	width: 1.8rem;
	height: 1.8rem;
	display: grid;
	flex: none;
	place-items: center;
	border: none;
	border-radius: 999px;
	background: transparent;
	color: var(--fg-50);
	cursor: pointer;
}

.dt-x:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.dt-body {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 0.9rem;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
}

.dt-preview {
	display: grid;
	place-items: center;
	max-height: 18rem;
	overflow: hidden;
	border: 1px solid var(--line-divider);
	border-radius: 0.6rem;
}

.dt-preview img {
	max-width: 100%;
	max-height: 18rem;
	object-fit: contain;
}

.dt-fields {
	display: grid;
	grid-template-columns: 6rem 1fr;
	gap: 0.4rem 0.7rem;
	margin: 0;
	font-size: 0.74rem;
}

.dt-fields dt {
	color: var(--fg-50);
}

.dt-fields dd {
	margin: 0;
	color: var(--fg-75);
	word-break: break-all;
}

.dt-muted {
	color: var(--fg-50);
}

.dt-slug {
	display: inline-block;
	margin: 0 0.3rem 0.3rem 0;
	padding: 0 0.4rem;
	border: 1px solid var(--line-divider);
	border-radius: 999px;
	font-size: 0.68rem;
}

.dt-foot {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: space-between;
	gap: 0.8rem;
	padding: 0.6rem 0.9rem;
	border-top: 1px solid var(--line-divider);
}

.dt-copied {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.dt-actions {
	display: flex;
	flex: none;
	/* 复制成功的提示在左，按钮靠右对齐 */
	margin-left: auto;
	gap: 0.45rem;
}

.danger {
	color: var(--admonitions-color-caution);
}
</style>
