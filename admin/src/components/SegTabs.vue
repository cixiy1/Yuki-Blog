<script setup lang="ts">
/**
 * 分段页签：我的文章 / 评论 / 站点设置共用一个控件。
 *
 * 这三处以前各写一套——一处透明胶囊、一处凹槽、一处圆角 999 的标签，
 * 同样是「切一组视图」，点上去的手感却像三个产品。统一成凹槽 + 白底浮起，
 * 跟列表右上角的视图切换同一个语言。
 */
const props = withDefaults(
	defineProps<{
		options: Array<{ key: string; label: string; count?: number }>;
		modelValue: string;
		/** 页签太多时允许横向滚动（站点设置有 8 个） */
		scrollable?: boolean;
	}>(),
	{ scrollable: false },
);

const emit = defineEmits<{ "update:modelValue": [key: string] }>();
</script>

<template>
	<div class="seg" :class="{ scrollable }" role="tablist">
		<button
			v-for="option in options"
			:key="option.key"
			type="button"
			class="seg-btn"
			:class="{ on: option.key === modelValue }"
			role="tab"
			:aria-selected="option.key === modelValue"
			@click="emit('update:modelValue', option.key)"
		>
			{{ option.label }}
			<span v-if="option.count !== undefined" class="seg-count">
				{{ option.count }}
			</span>
		</button>
	</div>
</template>

<style scoped>
.seg {
	display: flex;
	align-items: center;
	gap: 1px;
	padding: 0.18rem;
	border-radius: 9px;
	background: var(--btn-regular-bg);
	width: fit-content;
	max-width: 100%;
}

.seg.scrollable {
	overflow-x: auto;
	scrollbar-width: none;
}

.seg.scrollable::-webkit-scrollbar {
	display: none;
}

.seg-btn {
	flex: 0 0 auto;
	display: inline-flex;
	align-items: center;
	gap: 0.28rem;
	padding: 0.3rem 0.7rem;
	border: none;
	border-radius: 7px;
	background: transparent;
	color: var(--fg-50);
	font-size: 0.78rem;
	line-height: 1.4;
	cursor: pointer;
	white-space: nowrap;
	transition:
		background-color 0.15s ease,
		color 0.15s ease,
		box-shadow 0.15s ease;
}

.seg-btn:hover {
	color: var(--fg-90);
}

.seg-btn.on {
	background: var(--card-bg);
	color: var(--accent-text);
	font-weight: 600;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
}

.seg-count {
	font-size: 0.7rem;
	font-weight: 500;
	color: var(--fg-30);
	font-variant-numeric: tabular-nums;
}

.seg-btn.on .seg-count {
	color: var(--accent-text);
	opacity: 0.7;
}
</style>
