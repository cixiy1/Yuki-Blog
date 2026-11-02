<script setup lang="ts">
import PageHeader from "./PageHeader.vue";

defineProps<{ title: string; desc?: string; points?: string[] }>();
</script>

<template>
	<div>
		<PageHeader :title="title" :desc="desc" />
		<div class="pending card-base">
			<p class="tag">开发中</p>
			<p class="hint">这一块还没接后端，先把入口和布局占住。</p>
			<ul v-if="points?.length">
				<li v-for="point in points" :key="point">{{ point }}</li>
			</ul>
		</div>
	</div>
</template>

<style scoped>
.pending {
	padding: 1.4rem 1.5rem;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.tag {
	align-self: flex-start;
	margin: 0;
	padding: 0.12rem 0.5rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--btn-content);
	font-size: 0.7rem;
	font-weight: 600;
}

.hint {
	margin: 0;
	font-size: 0.84rem;
	color: var(--fg-75);
}

ul {
	margin: 0;
	padding-left: 1.1rem;
	font-size: 0.78rem;
	color: var(--fg-50);
	line-height: 1.9;
}
</style>
