<script setup lang="ts">
/**
 * 未开通的功能页：说清楚「为什么是空的」和「接进来之后什么规矩」。
 *
 * 以前是一张左上角对齐的小卡片、右边和下面全是白，看着像页面没加载完。
 * 现在走统一的空状态：图标兜住视线，标题给结论，约束条款跟在下面。
 */
import AppIcon from "./AppIcon.vue";
import EmptyState from "./EmptyState.vue";
import PageHeader from "./PageHeader.vue";

defineProps<{ title: string; desc?: string; points?: string[] }>();
</script>

<template>
	<div>
		<PageHeader :title="title" :desc="desc" />

		<EmptyState
			icon="components"
			title="这一块还没接后端"
			desc="入口和规范先占住，等管理接口做出来，就能在这儿增删改自己的组件。"
		>
			<ul v-if="points?.length" class="points">
				<li v-for="point in points" :key="point">
					<AppIcon name="chevron" :size="12" />
					<span>{{ point }}</span>
				</li>
			</ul>
		</EmptyState>
	</div>
</template>

<style scoped>
/* 居中容器里塞左对齐的清单：只收窄、不居中文字，读起来才顺 */
.points {
	width: 100%;
	max-width: 30rem;
	margin: 0.65rem 0 0;
	padding: 0;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	text-align: left;
}

.points li {
	display: flex;
	align-items: flex-start;
	gap: 0.4rem;
	font-size: 0.78rem;
	line-height: 1.7;
	color: var(--fg-50);
}

.points svg {
	flex: none;
	margin-top: 0.42rem;
	color: var(--fg-30);
}
</style>
