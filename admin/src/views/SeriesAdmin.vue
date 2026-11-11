<script setup lang="ts">
/**
 * 系列管理：给「由文章 series 字段分组出来的系列」补封面、简介和卡片形态。
 *
 * 系列本身不是内容集合，没有独立文件可写，所以这里改的是
 * `config/series.json`：保存即 commit，触发一次构建，/series/ 上才会变。
 * 因此保存成功的提示要写清楚「1–2 分钟后生效」，不能让站长以为没存上。
 */
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import EmptyState from "../components/EmptyState.vue";
import LoadingState from "../components/LoadingState.vue";
import MediaPickerDialog from "../components/MediaPickerDialog.vue";
import PageHeader from "../components/PageHeader.vue";
import SegTabs from "../components/SegTabs.vue";
import {
	emptySetting,
	listSeries,
	type SeriesLayout,
	type SeriesRow,
	type SeriesSetting,
	saveSeriesDefaultLayout,
	saveSeriesSetting,
} from "../lib/series";

const rows = ref<SeriesRow[]>([]);
const settings = ref<Record<string, SeriesSetting>>({});
const defaultLayout = ref<SeriesLayout>("icon");
const loading = ref(true);
const error = ref("");
const warning = ref("");
const note = ref("");

const editing = ref<string | null>(null);
const draft = ref<SeriesSetting>(emptySetting());
const saving = ref(false);
const saveError = ref("");
const pickerOpen = ref(false);
const savingDefault = ref(false);

const LAYOUT_LABEL: Record<SeriesLayout, string> = {
	banner: "横幅",
	icon: "圆形",
	none: "不显示",
};

const defaultOptions = [
	{ key: "banner", label: "横幅" },
	{ key: "icon", label: "圆形" },
	{ key: "none", label: "不显示" },
];

/** 草稿用 default 表示「跟随默认」，落到配置里是 null */
const draftOptions = [
	{ key: "default", label: "跟随默认" },
	{ key: "banner", label: "横幅" },
	{ key: "icon", label: "圆形" },
	{ key: "none", label: "不显示" },
];

const totalPosts = computed(() =>
	rows.value.reduce((sum, row) => sum + row.count, 0),
);

const configuredCount = computed(
	() =>
		Object.values(settings.value).filter(
			(item) => item.cover || item.description || item.layout,
		).length,
);

/** 某个系列最终生效的形态：自己选过就用自己选的，否则跟默认 */
function layoutOf(name: string): SeriesLayout {
	return settings.value[name]?.layout ?? defaultLayout.value;
}

function coverOf(name: string): string {
	return settings.value[name]?.cover ?? "";
}

function descOf(name: string): string {
	return settings.value[name]?.description ?? "";
}

function dateText(ts: number): string {
	if (!ts) return "";
	const at = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${at.getMonth() + 1}-${pad(at.getDate())}`;
}

function openEditor(row: SeriesRow): void {
	if (editing.value === row.name) {
		editing.value = null;
		return;
	}
	editing.value = row.name;
	draft.value = { ...emptySetting(), ...(settings.value[row.name] ?? {}) };
	saveError.value = "";
	note.value = "";
}

function setDraftLayout(key: string): void {
	draft.value.layout = key === "default" ? null : (key as SeriesLayout);
}

async function persist(name: string): Promise<void> {
	saving.value = true;
	saveError.value = "";
	try {
		const saved = await saveSeriesSetting(name, {
			cover: draft.value.cover.trim(),
			description: draft.value.description.trim(),
			layout: draft.value.layout,
		});
		settings.value = saved.series;
		defaultLayout.value = saved.defaultLayout;
		note.value = `「${name}」已保存，构建约 1–2 分钟后 /series/ 上生效。`;
		editing.value = null;
	} catch (err) {
		saveError.value = err instanceof Error ? err.message : "保存失败";
	} finally {
		saving.value = false;
	}
}

async function persistDefault(key: string): Promise<void> {
	const next = key as SeriesLayout;
	if (next === defaultLayout.value) return;
	const previous = defaultLayout.value;
	defaultLayout.value = next;
	savingDefault.value = true;
	try {
		const saved = await saveSeriesDefaultLayout(next);
		settings.value = saved.series;
		defaultLayout.value = saved.defaultLayout;
		note.value = `默认形态已改为${LAYOUT_LABEL[next]}，构建约 1–2 分钟后生效。`;
	} catch (err) {
		defaultLayout.value = previous;
		error.value = err instanceof Error ? err.message : "保存默认形态失败";
	} finally {
		savingDefault.value = false;
	}
}

function pickCover(value: string): void {
	draft.value.cover = value;
	pickerOpen.value = false;
}

async function load(): Promise<void> {
	loading.value = true;
	error.value = "";
	try {
		const data = await listSeries();
		rows.value = data.rows;
		settings.value = data.series;
		defaultLayout.value = data.defaultLayout;
		warning.value = data.warning ?? "";
	} catch (err) {
		error.value = err instanceof Error ? err.message : "读取系列失败";
	} finally {
		loading.value = false;
	}
}

onMounted(load);
</script>

<template>
	<div class="series-page">
		<PageHeader
			title="系列管理"
			desc="封面、简介与卡片形态。系列由文章的 series 字段分组得出，这里只补展示信息。"
		/>

		<div class="default-bar">
			<div class="default-text">
				<p class="db-title">默认卡片形态</p>
				<p class="db-desc">
					没单独设置过的系列用这个；已经选过形态的不会被改动。
				</p>
			</div>
			<SegTabs
				:model-value="defaultLayout"
				:options="defaultOptions"
				@update:model-value="persistDefault"
			/>
			<span v-if="savingDefault" class="db-saving">保存中…</span>
		</div>

		<p v-if="note" class="note">{{ note }}</p>
		<p v-if="warning" class="note warn">{{ warning }}</p>
		<p v-if="error" class="note err">{{ error }}</p>

		<LoadingState v-if="loading" :rows="4" />

		<EmptyState
			v-else-if="!rows.length"
			icon="posts"
			title="还没有系列"
			desc="在文章 frontmatter 里加 series 字段，构建完就会出现在这里。"
		/>

		<div v-else class="list">
			<div class="list-head">
				<span>系列</span>
				<span>{{ rows.length }} 个系列 · {{ totalPosts }} 篇 · 已配 {{ configuredCount }}</span>
			</div>

			<div
				v-for="row in rows"
				:key="row.name"
				class="row"
				:class="{ open: editing === row.name }"
			>
				<button type="button" class="row-main" @click="openEditor(row)">
					<span class="thumb" :class="`t-${layoutOf(row.name)}`">
						<img
							v-if="coverOf(row.name)"
							:src="coverOf(row.name)"
							:alt="row.name"
							loading="lazy"
						/>
						<span
							v-else-if="layoutOf(row.name) !== 'none'"
							class="thumb-mark"
						>
							{{ row.name.slice(0, 1) }}
						</span>
						<AppIcon v-else name="image" :size="16" />
					</span>

					<span class="row-text">
						<span class="row-top">
							<span class="row-name">{{ row.name }}</span>
							<span class="tag">{{ LAYOUT_LABEL[layoutOf(row.name)] }}</span>
						</span>
						<span class="row-sub">
							{{ row.count }} 篇 · 最近 {{ dateText(row.latest) }}
						</span>
						<span v-if="descOf(row.name)" class="row-desc">
							{{ descOf(row.name) }}
						</span>
					</span>

					<AppIcon
						name="chevron"
						:size="14"
						class="row-chev"
						:class="{ on: editing === row.name }"
					/>
				</button>

				<div v-if="editing === row.name" class="editor">
					<div class="ed-cover">
						<div class="ed-preview" :class="`t-${draft.layout ?? defaultLayout}`">
							<img v-if="draft.cover" :src="draft.cover" :alt="row.name" />
							<span v-else class="preview-mark">{{ row.name.slice(0, 1) }}</span>
						</div>
						<div class="ed-cover-actions">
							<button type="button" class="btn-regular" @click="pickerOpen = true">
								<AppIcon name="image" :size="13" />
								选择图片
							</button>
							<button
								v-if="draft.cover"
								type="button"
								class="btn-ghost"
								@click="draft.cover = ''"
							>
								清除
							</button>
							<p class="ed-hint">
								{{
									draft.cover
										? "横幅形态铺在卡片顶部，按 2.4:1 取图最合适；圆形形态会居中裁成方的。"
										: "还没设封面：横幅形态用系列名首字铺底，圆形形态显示图标。"
								}}
							</p>
						</div>
					</div>

					<label class="ed-field">
						<span class="ed-label">一句话简介</span>
						<input
							v-model="draft.description"
							class="field"
							maxlength="80"
							placeholder="这一组文章讲什么，卡片上一行显示"
						/>
					</label>

					<div class="ed-field">
						<span class="ed-label">卡片形态</span>
						<SegTabs
							:model-value="draft.layout ?? 'default'"
							:options="draftOptions"
							@update:model-value="setDraftLayout"
						/>
					</div>

					<div class="ed-foot">
						<span class="ed-error">{{ saveError }}</span>
						<button type="button" class="btn-ghost" @click="editing = null">
							取消
						</button>
						<button
							type="button"
							class="btn-primary"
							:disabled="saving"
							@click="persist(row.name)"
						>
							{{ saving ? "保存中…" : "保存" }}
						</button>
					</div>
				</div>
			</div>
		</div>

		<MediaPickerDialog
			v-if="pickerOpen"
			context="site"
			:initial="draft.cover"
			@close="pickerOpen = false"
			@select="pickCover"
		/>
	</div>
</template>

<style scoped>
.series-page {
	display: flex;
	flex-direction: column;
}

/* 默认形态：一条通栏，不装进列表里，改的是全局值 */
.default-bar {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.85rem 0.95rem;
	margin-bottom: 1rem;
	border: 1px solid var(--line-divider);
	border-radius: 10px;
}

.default-text {
	flex: 1;
	min-width: 0;
}

.db-title {
	margin: 0;
	font-size: 0.86rem;
	font-weight: 600;
	color: var(--fg-90);
}

.db-desc {
	margin: 0.15rem 0 0;
	font-size: 0.74rem;
	line-height: 1.5;
	color: var(--fg-50);
}

.db-saving {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.note {
	margin: 0 0 0.7rem;
	font-size: 0.76rem;
	color: var(--fg-75);
}

.note.warn {
	color: var(--admonitions-color-caution);
}

.note.err {
	color: var(--admonitions-color-caution);
}

.list {
	border: 1px solid var(--line-divider);
	border-radius: 10px;
	overflow: hidden;
}

.list-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	padding: 0.55rem 0.95rem;
	border-bottom: 1px solid var(--line-divider);
	font-size: 0.72rem;
	color: var(--fg-50);
}

.row + .row {
	border-top: 1px solid var(--line-divider);
}

.row-main {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	width: 100%;
	padding: 0.8rem 0.95rem;
	border: none;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.row-main:hover,
.row.open .row-main {
	background: var(--btn-plain-bg-hover);
}

/* 缩略图跟着形态变：横幅是 2.4:1 的横条，圆形是圆，不显示时只剩一个图标位 */
.thumb {
	flex: none;
	display: inline-grid;
	place-items: center;
	overflow: hidden;
	background: color-mix(in oklab, var(--primary) 10%, var(--btn-regular-bg));
	color: var(--accent-text);
}

.thumb.t-banner {
	width: 5.4rem;
	aspect-ratio: 2.4 / 1;
	border-radius: 6px;
}

.thumb.t-icon {
	width: 2.6rem;
	height: 2.6rem;
	border-radius: 999px;
}

.thumb.t-none {
	width: 2.6rem;
	height: 2.6rem;
	border-radius: 6px;
	background: var(--btn-regular-bg);
	color: var(--fg-50);
}

.thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}

.thumb-mark {
	font-size: 1.1rem;
	font-weight: 700;
	letter-spacing: -0.02em;
}

.row-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
}

.row-top {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	min-width: 0;
}

.row-name {
	font-size: 0.92rem;
	font-weight: 600;
	color: var(--fg-90);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tag {
	flex: none;
	padding: 0.05rem 0.35rem;
	border-radius: 4px;
	background: var(--btn-regular-bg);
	font-size: 0.66rem;
	color: var(--fg-50);
}

.row-sub {
	font-size: 0.72rem;
	color: var(--fg-50);
	font-variant-numeric: tabular-nums;
}

.row-desc {
	font-size: 0.74rem;
	color: var(--fg-75);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.row-chev {
	flex: none;
	color: var(--fg-30);
	transition: transform 0.2s ease;
}

.row-chev.on {
	transform: rotate(90deg);
}

/* ---- 编辑区 ---- */
.editor {
	display: flex;
	flex-direction: column;
	gap: 0.85rem;
	padding: 0.2rem 0.95rem 1rem 6.9rem;
}

.ed-cover {
	display: flex;
	align-items: flex-start;
	gap: 0.9rem;
}

.ed-preview {
	position: relative;
	flex: none;
	display: grid;
	place-items: center;
	overflow: hidden;
	border: 1px solid var(--line-divider);
	background: linear-gradient(
		135deg,
		color-mix(in oklab, var(--primary) 14%, var(--card-bg)),
		color-mix(in oklab, var(--primary) 5%, var(--card-bg))
	);
}

.ed-preview.t-banner {
	width: 12rem;
	aspect-ratio: 2.4 / 1;
	border-radius: 8px;
}

.ed-preview.t-icon {
	width: 4.4rem;
	height: 4.4rem;
	border-radius: 999px;
}

.ed-preview.t-none {
	width: 6rem;
	height: 2.5rem;
	border-radius: 8px;
	opacity: 0.5;
}

.ed-preview img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}

/* 首字大小跟着预览块走：圆形只有 4.4rem，2rem 的字会顶满整块 */
.preview-mark {
	font-size: 1.5rem;
	font-weight: 800;
	line-height: 1;
	color: color-mix(in oklab, var(--primary) 55%, var(--fg-90));
	opacity: 0.45;
}

.ed-preview.t-banner .preview-mark {
	font-size: 2.4rem;
}

.ed-cover-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem;
}

.ed-hint {
	flex-basis: 100%;
	margin: 0.1rem 0 0;
	font-size: 0.7rem;
	line-height: 1.5;
	color: var(--fg-50);
}

.ed-field {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
}

.ed-label {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.ed-foot {
	display: flex;
	align-items: center;
	gap: 0.45rem;
}

.ed-error {
	flex: 1;
	font-size: 0.72rem;
	color: var(--admonitions-color-caution);
}

@media (max-width: 768px) {
	.editor {
		padding-left: 0.95rem;
	}

	.thumb.t-banner {
		width: 4rem;
	}
}
</style>
