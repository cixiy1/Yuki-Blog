<script setup lang="ts">
import { ref, watch } from "vue";
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

watch(
	() => props.files,
	() => {
		broken.value = new Set();
	},
);

function disabled(file: MediaFile, disableContent?: boolean): boolean {
	return Boolean(disableContent && file.origin === "content");
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
					:src="file.url"
					:alt="file.name"
					loading="lazy"
					decoding="async"
					@error="broken.add(file.path)"
				/>
				<span v-else class="mg-broken">{{ file.ext.toUpperCase() }} 读不到</span>
			</span>
			<span class="mg-name">{{ file.name }}</span>
			<span class="mg-meta">
				{{ file.ext }} · {{ formatBytes(file.bytes) }}
				<span v-if="file.origin === 'content'" class="mg-tag">文章内嵌</span>
			</span>
		</button>
	</div>
</template>

<style scoped>
.mg-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
	gap: 0.7rem;
}

.mg-card {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	padding: 0.45rem;
	border: 1px solid var(--line-divider);
	border-radius: 0.6rem;
	background: transparent;
	color: var(--fg-90);
	text-align: left;
	overflow: hidden;
	transition:
		border-color 0.15s ease,
		background-color 0.15s ease;
}

.mg-card:hover:not(.off) {
	background: var(--btn-plain-bg-hover);
}

.mg-card.on {
	border-color: var(--primary);
}

.mg-card.off {
	opacity: 0.4;
	cursor: not-allowed;
}

.mg-thumb {
	display: grid;
	place-items: center;
	aspect-ratio: 4 / 3;
	border-radius: 0.45rem;
	overflow: hidden;
	background: var(--btn-regular-bg);
}

.mg-thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	/* 透明底（svg / png）叠在浅色卡上，不要留白块错觉 */
	background: transparent;
}

.mg-broken {
	font-size: 0.68rem;
	color: var(--fg-50);
}

.mg-name {
	font-size: 0.74rem;
	line-height: 1.35;
	color: var(--fg-90);
	/* 文件名常常很长，留一行、中间省略 */
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.mg-meta {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	font-size: 0.66rem;
	color: var(--fg-50);
}

.mg-tag {
	padding: 0 0.3rem;
	border: 1px solid var(--line-divider);
	border-radius: 999px;
	font-size: 0.6rem;
	white-space: nowrap;
}
</style>
