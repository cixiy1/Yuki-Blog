<script setup lang="ts">
defineProps<{ title: string; desc?: string }>();
</script>

<template>
	<div class="page-header">
		<div class="text">
			<h2>{{ title }}</h2>
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
	gap: 1rem;
	margin-bottom: 1.1rem;
	flex-wrap: wrap;
}

.text h2 {
	margin: 0;
	font-size: 1.15rem;
	font-weight: 700;
	color: var(--fg-90);
	letter-spacing: -0.01em;
}

.text p {
	margin: 0.2rem 0 0;
	font-size: 0.8rem;
	color: var(--fg-50);
}

.actions {
	display: flex;
	align-items: center;
	gap: 0.45rem;
}
</style>
