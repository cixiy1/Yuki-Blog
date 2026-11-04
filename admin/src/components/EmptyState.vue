<script setup lang="ts">
/**
 * 空状态：列表没内容、功能没开通都走这里。
 *
 * 以前每个页面自己写一句灰字，位置、字号、留白各不相同，页面上就是一整片白里
 * 漂着一行小字，看着像加载失败。统一成一块虚线框：图标兜住视线，标题说结论，
 * 说明补充，按钮给下一步。
 */
import AppIcon from "./AppIcon.vue";

const props = withDefaults(
	defineProps<{
		title: string;
		desc?: string;
		icon?: string;
		/** 紧凑版：塞在各种卡片内部时用，别把容器撑太高 */
		compact?: boolean;
	}>(),
	{ icon: "inbox", compact: false },
);
</script>

<template>
	<div class="empty" :class="{ compact }">
		<span class="mark">
			<AppIcon :name="icon" :size="compact ? 18 : 22" />
		</span>
		<p class="title">{{ title }}</p>
		<p v-if="desc" class="desc">{{ desc }}</p>
		<slot />
	</div>
</template>

<style scoped>
.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.45rem;
	padding: 3.2rem 1.5rem;
	border: 1px dashed var(--line-divider);
	border-radius: 12px;
	text-align: center;
}

.empty.compact {
	padding: 1.8rem 1.2rem;
	border: none;
	border-radius: 0;
}

.mark {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.6rem;
	height: 2.6rem;
	margin-bottom: 0.15rem;
	border-radius: 10px;
	background: color-mix(in oklab, var(--primary) 9%, transparent);
	color: var(--accent-text);
}

.compact .mark {
	width: 2rem;
	height: 2rem;
	border-radius: 8px;
}

.title {
	margin: 0;
	font-size: 0.9rem;
	font-weight: 650;
	color: var(--fg-90);
	letter-spacing: -0.01em;
}

.compact .title {
	font-size: 0.84rem;
}

.desc {
	max-width: 30rem;
	margin: 0;
	font-size: 0.78rem;
	line-height: 1.8;
	color: var(--fg-50);
}
</style>
