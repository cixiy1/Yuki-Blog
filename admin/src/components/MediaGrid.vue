<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { formatBytes, type MediaFile } from "../lib/media";

/** 媒体库与选择器共用的一套网格：卡片只有一像素描边，不铺灰底 */
const props = defineProps<{
	files: MediaFile[];
	selected?: string;
	/** 站点其它位置引用不了「文章内嵌图」，这些卡片置灰 */
	disableContent?: boolean;
}>();

const emit = defineEmits<{ pick: [file: MediaFile] }>();

/** 加载失败的图（raw 地址被墙、文件被删）标记一下，别留个破图标 */
const broken = ref<Set<string>>(new Set());
/** 已经成功解码的图，用来撤掉「构建中」角标 */
const loaded = ref<Set<string>>(new Set());
/** 第几次重试，读写它就能让 img 换 src 重新请求 */
const attempts = ref<Record<string, number>>({});
/** 重试次数用完仍是 404 的，改成一句确定的话 */
const waiting = ref<Set<string>>(new Set());

/**
 * 刚上传的图在构建完成前必然 404，这时报「读不到」是误报。
 * 构建 1–2 分钟，按 6 秒一次重试 20 次把这段时间盖住。
 */
const RETRY_MS = 6000;
const MAX_RETRY = 20;
const timers = new Map<string, number>();

watch(
	() => props.files,
	() => {
		broken.value = new Set();
		loaded.value = new Set();
		waiting.value = new Set();
		attempts.value = {};
		for (const timer of timers.values()) window.clearTimeout(timer);
		timers.clear();
	},
);

onBeforeUnmount(() => {
	for (const timer of timers.values()) window.clearTimeout(timer);
	timers.clear();
});

function disabled(file: MediaFile, disableContent?: boolean): boolean {
	return Boolean(disableContent && file.origin === "content");
}

function thumbSrc(file: MediaFile): string {
	const n = attempts.value[file.path] ?? 0;
	if (n === 0) return file.url;
	// 带上次数当缓存键，绕过 404 的缓存直接再打一次源站
	const glue = file.url.includes("?") ? "&" : "?";
	return `${file.url}${glue}yb_retry=${n}`;
}

function onThumbLoad(file: MediaFile): void {
	const timer = timers.get(file.path);
	if (timer !== undefined) {
		window.clearTimeout(timer);
		timers.delete(file.path);
	}
	loaded.value = new Set([...loaded.value, file.path]);
}

function onThumbError(file: MediaFile): void {
	const n = attempts.value[file.path] ?? 0;
	if (file.pending) {
		if (n >= MAX_RETRY) {
			waiting.value = new Set([...waiting.value, file.path]);
			return;
		}
		const timer = window.setTimeout(() => {
			timers.delete(file.path);
			attempts.value = { ...attempts.value, [file.path]: n + 1 };
		}, RETRY_MS);
		timers.set(file.path, timer);
		return;
	}
	broken.value = new Set([...broken.value, file.path]);
}

function badge(file: MediaFile): string {
	if (!file.pending) return "";
	if (loaded.value.has(file.path)) return "";
	if (waiting.value.has(file.path)) return "构建完成后可见";
	return "构建中…";
}
</script>

<template>
	<div class="mg-grid">
		<button
			v-for="file in files"
			:key="file.path"
			type="button"
			class="mg-card"
			:class="{ on: selected === file.path, off: disabled(file, disableContent) }"
			:title="disabled(file, disableContent) ? '文章内嵌图只能在文章里引用' : file.path"
			:disabled="disabled(file, disableContent)"
			@click="emit('pick', file)"
		>
			<span class="mg-thumb">
				<img
					v-if="!broken.has(file.path)"
					:src="thumbSrc(file)"
					:alt="file.name"
					loading="lazy"
					decoding="async"
					@load="onThumbLoad(file)"
					@error="onThumbError(file)"
				/>
				<span v-else class="mg-broken">{{ file.ext.toUpperCase() }} 读不到</span>
				<span v-if="badge(file)" class="mg-badge">{{ badge(file) }}</span>
			</span>
			<span class="mg-name">{{ file.name }}</span>
			<span class="mg-meta">
				<span class="mg-ext">{{ file.ext }}</span>
				<span class="mg-size">{{ formatBytes(file.bytes) }}</span>
				<span v-if="file.origin === 'content'" class="mg-tag">文章内嵌</span>
			</span>
		</button>
	</div>
</template>

<style scoped>
.mg-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
	gap: 0.7rem;
}

.mg-card {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	padding: 0.45rem 0.45rem 0.5rem;
	border: 1px solid var(--line-divider);
	border-radius: 10px;
	background: var(--card-bg);
	color: var(--fg-90);
	text-align: left;
	overflow: hidden;
	transition:
		border-color 0.15s ease,
		transform 0.15s ease;
}

.mg-card:hover:not(.off) {
	transform: translateY(-2px);
	border-color: color-mix(in oklab, var(--primary) 34%, var(--line-divider));
}

.mg-card.on {
	border-color: var(--primary);
}

.mg-card.off {
	opacity: 0.4;
	cursor: not-allowed;
}

.mg-thumb {
	position: relative;
	display: grid;
	place-items: center;
	aspect-ratio: 4 / 3;
	padding: 0.3rem;
	border-radius: 7px;
	overflow: hidden;
	background: var(--btn-regular-bg);
}

/* 站内图多是网页截图和架构图，cover 会把顶部排版切掉，认不出是哪张 → 整张塞进去。
   contain 留出的边正好让素材有呼吸，缩略图也不至于糊成一片 */
.mg-thumb img {
	width: 100%;
	height: 100%;
	object-fit: contain;
	display: block;
	background: transparent;
}

.mg-broken {
	font-size: 0.68rem;
	color: var(--fg-50);
}

/* 角标压在缩略图左下角：图还没出来时也不能挡住整块区域 */
.mg-badge {
	position: absolute;
	left: 0.35rem;
	bottom: 0.35rem;
	padding: 0.1rem 0.34rem;
	border-radius: 4px;
	background: color-mix(in oklab, var(--card-bg) 82%, transparent);
	border: 1px solid var(--line-divider);
	color: var(--fg-50);
	font-size: 0.6rem;
	line-height: 1.4;
	font-variant-numeric: tabular-nums;
}

.mg-name {
	font-size: 0.73rem;
	font-weight: 600;
	line-height: 1.35;
	color: var(--fg-90);
	letter-spacing: -0.01em;
	/* 文件名常常很长，留一行、中间省略 */
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.mg-meta {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	font-size: 0.64rem;
	color: var(--fg-50);
}

/* 扩展名是分类信息，做成固定宽的小块，列对齐时不会跳 */
.mg-ext {
	flex: none;
	width: 2.1rem;
	padding: 0 0.2rem;
	border-radius: 4px;
	background: var(--btn-regular-bg);
	color: var(--fg-75);
	font-size: 0.6rem;
	font-weight: 600;
	text-align: center;
	text-transform: uppercase;
}

.mg-size {
	font-variant-numeric: tabular-nums;
}

.mg-tag {
	padding: 0 0.3rem;
	border: 1px solid var(--line-divider);
	border-radius: 999px;
	font-size: 0.6rem;
	white-space: nowrap;
}
</style>
