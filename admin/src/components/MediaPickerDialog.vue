<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { listMedia, type MediaFile, uploadMediaFiles } from "../lib/media";
import AppIcon from "./AppIcon.vue";
import MediaGrid from "./MediaGrid.vue";

/**
 * 统一选择器：编辑器插图、封面图、头像、友链头像都走这一个。
 * 三个入口——从库里挑、传新的、直接填外链。
 */
const props = withDefaults(
	defineProps<{
		/** post：正文/封面，允许文章内嵌图并用相对路径；site：站点其它位置，只能用站内静态资源 */
		context?: "post" | "site";
		/** 文章所在目录（相对 src/content/posts），用来算相对路径的层级 */
		postDir?: string;
		/** 当前已有的值，打开时回显 */
		initial?: string;
	}>(),
	{ context: "post", postDir: "", initial: "" },
);

const emit = defineEmits<{ close: []; select: [ref: string] }>();

type Tab = "library" | "upload" | "url";

const tab = ref<Tab>("library");
const files = ref<MediaFile[]>([]);
const loading = ref(false);
const loadError = ref("");
const query = ref("");
const origin = ref<"all" | "public" | "content">("all");
const picked = ref<MediaFile | null>(null);
const urlText = ref(props.initial);
const busy = ref(false);
const uploadNote = ref("");
const uploadError = ref("");

const fileInput = ref<HTMLInputElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);

/** 文章在子目录时相对路径要多退几层 */
const depth = computed(
	() => props.postDir.split("/").filter((part) => part.length > 0).length,
);

function refFor(file: MediaFile): string {
	if (file.origin === "public") return file.ref;
	const rel = file.ref.replace(/^\.\//, "");
	return depth.value > 0 ? `${"../".repeat(depth.value)}${rel}` : `./${rel}`;
}

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

const selectedRef = computed(() => {
	if (tab.value === "url") return urlText.value.trim();
	return picked.value ? refFor(picked.value) : "";
});

async function load(): Promise<void> {
	loading.value = true;
	loadError.value = "";
	try {
		const data = await listMedia();
		files.value = data.files;
		// 打开时把当前值对应的文件选中，方便「换一张」
		const current = props.initial.trim();
		if (current) {
			const hit = data.files.find(
				(file) => file.ref === current || file.url === current,
			);
			if (hit) picked.value = hit;
		}
	} catch (error) {
		loadError.value = error instanceof Error ? error.message : "读取媒体库失败";
	} finally {
		loading.value = false;
	}
}

function pick(file: MediaFile): void {
	picked.value = file;
}

async function doUpload(list: FileList | File[]): Promise<void> {
	const batch = Array.from(list);
	if (batch.length === 0) return;
	busy.value = true;
	uploadNote.value = `正在压缩并上传 ${batch.length} 张…`;
	uploadError.value = "";
	try {
		const result = await uploadMediaFiles(batch);
		const added = [...result.created, ...result.reused];
		if (added.length > 0) {
			files.value = [...added, ...files.value];
			picked.value = added[0] ?? null;
			tab.value = "library";
		}
		const parts: string[] = [];
		if (result.created.length) parts.push(`新传 ${result.created.length} 张`);
		if (result.reused.length)
			parts.push(`${result.reused.length} 张已存在，直接复用`);
		uploadNote.value = parts.join("，") || "没有变化";
	} catch (error) {
		uploadError.value = error instanceof Error ? error.message : "上传失败";
		uploadNote.value = "";
	} finally {
		busy.value = false;
	}
}

function onDrop(event: DragEvent): void {
	event.preventDefault();
	if (event.dataTransfer?.files.length) void doUpload(event.dataTransfer.files);
}

function onPaste(event: ClipboardEvent): void {
	const items = Array.from(event.clipboardData?.files ?? []);
	if (items.length) {
		event.preventDefault();
		void doUpload(items);
	}
}

function confirm(): void {
	const value = selectedRef.value;
	if (!value) return;
	emit("select", value);
	emit("close");
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape") emit("close");
}

onMounted(() => {
	void load();
	window.addEventListener("keydown", onKeydown);
	// 打开就能直接打字筛选，不用先点一下搜索框
	searchEl.value?.focus();
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
	<div class="mp-mask" @click.self="emit('close')">
		<div class="mp-dialog" role="dialog" aria-modal="true" aria-label="选择图片">
			<header class="mp-head">
				<div class="mp-tabs" role="tablist">
					<button
						type="button"
						class="mp-tab"
						:class="{ on: tab === 'library' }"
						@click="tab = 'library'"
					>
						从库选
					</button>
					<button
						type="button"
						class="mp-tab"
						:class="{ on: tab === 'upload' }"
						@click="tab = 'upload'"
					>
						上传新图
					</button>
					<button
						type="button"
						class="mp-tab"
						:class="{ on: tab === 'url' }"
						@click="tab = 'url'"
					>
						外链
					</button>
				</div>
				<button type="button" class="mp-x" title="关闭" @click="emit('close')">
					<AppIcon name="close" :size="14" />
				</button>
			</header>

			<div class="mp-body">
				<template v-if="tab === 'library'">
					<div class="mp-toolbar">
						<input
							ref="searchEl"
							v-model="query"
							class="field mp-search"
							placeholder="搜索文件名或路径"
						/>
						<select v-model="origin" class="field mp-filter">
							<option value="all">全部来源</option>
							<option value="public">站点静态</option>
							<option value="content">文章内嵌</option>
						</select>
					</div>

					<div class="mp-scroll">
						<p v-if="loading" class="mp-empty">读取媒体库…</p>
						<p v-else-if="loadError" class="mp-empty err">{{ loadError }}</p>
						<p v-else-if="!visible.length" class="mp-empty">
							没有匹配的图，去「上传新图」加一张。
						</p>
						<MediaGrid
							v-else
							:files="visible"
							:selected="picked?.path"
							:disable-content="context === 'site'"
							@pick="pick"
						/>
					</div>
				</template>

				<template v-else-if="tab === 'upload'">
					<div
						class="mp-drop"
						:class="{ busy }"
						@dragover.prevent
						@drop="onDrop"
						@paste="onPaste"
					>
						<AppIcon name="plus" :size="18" />
						<p class="mp-drop-title">把图片拖进来，或</p>
						<button
							type="button"
							class="btn-regular"
							:disabled="busy"
							@click="fileInput?.click()"
						>
							选文件
						</button>
						<p class="mp-drop-tip">
							也可以直接粘贴截图。一批图片合并成一次提交，只触发一次构建。
						</p>
						<input
							ref="fileInput"
							type="file"
							accept="image/*"
							multiple
							hidden
							@change="(event) => doUpload((event.target as HTMLInputElement).files ?? [])"
						/>
					</div>
					<p v-if="uploadNote" class="mp-note">{{ uploadNote }}</p>
					<p v-if="uploadError" class="mp-note err">{{ uploadError }}</p>
					<p class="mp-hint">
						上传的文件落在仓库 <code>public/assets/uploads/</code>，
						构建完成后才能在本站打开；文件名按内容摘要生成，同一张图不会存两份。
					</p>
				</template>

				<template v-else>
					<input
						v-model="urlText"
						class="field mp-url"
						placeholder="https://… 或 /assets/…"
					/>
					<p class="mp-hint">
						外链不下载、不转存，只登记地址。站点外的图挂了这边也不知道，
						长期用的图建议传到自己仓库里。
					</p>
				</template>
			</div>

			<footer class="mp-foot">
				<span class="mp-ref" :title="selectedRef">
					{{ selectedRef || "还没选图片" }}
				</span>
				<div class="mp-foot-actions">
					<button type="button" class="btn-ghost" @click="emit('close')">
						取消
					</button>
					<button
						type="button"
						class="btn-primary"
						:disabled="!selectedRef"
						@click="confirm"
					>
						使用这张
					</button>
				</div>
			</footer>
		</div>
	</div>
</template>

<style scoped>
.mp-mask {
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

.mp-dialog {
	display: flex;
	flex-direction: column;
	width: min(52rem, 96vw);
	height: min(38rem, 90vh);
	overflow: hidden;
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
}

.mp-head {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.6rem 0.8rem;
	border-bottom: 1px solid var(--line-divider);
}

.mp-tabs {
	display: flex;
	gap: 0.25rem;
}

.mp-tab {
	padding: 0.32rem 0.7rem;
	border: 1px solid transparent;
	border-radius: 0.5rem;
	background: transparent;
	color: var(--fg-50);
	font-size: 0.76rem;
	cursor: pointer;
}

.mp-tab:hover {
	color: var(--fg-90);
}

.mp-tab.on {
	border-color: var(--line-divider);
	background: var(--btn-regular-bg);
	color: var(--fg-90);
}

.mp-x {
	width: 1.8rem;
	height: 1.8rem;
	display: grid;
	place-items: center;
	border: none;
	border-radius: 999px;
	background: transparent;
	color: var(--fg-50);
	cursor: pointer;
}

.mp-x:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.mp-body {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 0.6rem;
	min-height: 0;
	padding: 0.8rem;
}

.mp-toolbar {
	display: flex;
	flex: none;
	gap: 0.5rem;
}

.mp-search {
	flex: 1;
}

.mp-filter {
	width: 8.5rem;
	flex: none;
}

.mp-scroll {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding-right: 0.15rem;
}

.mp-empty {
	margin: 2rem 0;
	text-align: center;
	font-size: 0.78rem;
	color: var(--fg-50);
}

.mp-empty.err,
.mp-note.err {
	color: var(--admonitions-color-caution);
}

.mp-drop {
	display: flex;
	flex: 1;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.55rem;
	border: 1px dashed var(--line-divider);
	border-radius: 0.7rem;
	color: var(--fg-75);
	text-align: center;
	padding: 1.5rem;
}

.mp-drop.busy {
	opacity: 0.6;
}

.mp-drop-title {
	margin: 0;
	font-size: 0.82rem;
}

.mp-drop-tip {
	margin: 0;
	max-width: 24rem;
	font-size: 0.7rem;
	line-height: 1.6;
	color: var(--fg-50);
}

.mp-url {
	width: 100%;
}

.mp-hint {
	margin: 0;
	font-size: 0.7rem;
	line-height: 1.6;
	color: var(--fg-50);
}

.mp-hint code {
	font-size: 0.68rem;
}

.mp-note {
	margin: 0;
	font-size: 0.74rem;
	color: var(--fg-75);
}

.mp-foot {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.6rem 0.8rem;
	border-top: 1px solid var(--line-divider);
}

.mp-ref {
	flex: 1;
	min-width: 0;
	font-family: var(--font-mono, ui-monospace, monospace);
	font-size: 0.7rem;
	color: var(--fg-50);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.mp-foot-actions {
	display: flex;
	flex: none;
	gap: 0.45rem;
}
</style>
