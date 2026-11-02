<script setup lang="ts">
defineProps<{ title: string; desc?: string }>();
</script>

<template>
	<div class="page-header">
		<div class="text">
			<h1>{{ title }}</h1>
			<p v-if="desc">{{ desc }}</p>
		</div>
		<div class="actions">
			<slot name="actions" />
		</div>
	</div>
</template>

<style scoped>
.page-header {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 1rem 1.25rem;
	margin-bottom: 1.35rem;
	flex-wrap: wrap;
}

.text h1 {
	margin: 0;
	font-size: 1.5rem;
	font-weight: 700;
	line-height: 1.2;
	color: var(--fg-90);
	letter-spacing: -0.02em;
}

.text p {
	margin: 0.3rem 0 0;
	font-size: 0.85rem;
	line-height: 1.7;
	color: var(--fg-50);
}

.actions {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	flex-wrap: wrap;
}
</style>
