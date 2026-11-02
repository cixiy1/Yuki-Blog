<script setup lang="ts">
import { onMounted, watch } from "vue";
import AppShell from "./components/AppShell.vue";
import {
	authError,
	authStatus,
	loadSession,
	redirectToLogin,
} from "./lib/auth";

onMounted(() => {
	void loadSession();
});

// 未登录不在 SPA 内画登录表单：主站 /login/ 才是唯一登录入口
watch(authStatus, (status) => {
	if (status === "anon") redirectToLogin();
});
</script>

<template>
	<div v-if="authStatus === 'loading'" class="boot">
		<div class="boot-card card-base">
			<span class="spinner" />
			<p>正在确认登录状态…</p>
		</div>
	</div>

	<div v-else-if="authStatus === 'error'" class="boot">
		<div class="boot-card card-base">
			<p class="boot-title">管理端暂时连不上服务端</p>
			<p class="boot-desc">{{ authError }}</p>
			<p class="boot-desc">
				本地开发需要先起 Worker：
				<code>corepack pnpm@11.22.0 worker:dev</code>
			</p>
			<div class="boot-actions">
				<button type="button" class="btn-regular" @click="loadSession()">
					重试
				</button>
				<a class="btn-ghost" href="/">返回站点</a>
			</div>
		</div>
	</div>

	<div v-else-if="authStatus === 'anon'" class="boot">
		<div class="boot-card card-base">
			<span class="spinner" />
			<p>正在跳转到登录页…</p>
			<a class="boot-link" :href="`/login/?next=${encodeURIComponent('/admin/')}`">
				如果没有自动跳转，点这里
			</a>
		</div>
	</div>

	<AppShell v-if="authStatus === 'ready'" />
</template>

<style scoped>
.boot {
	min-height: 100vh;
	display: grid;
	place-items: center;
	padding: 2rem;
}

.boot-card {
	max-width: 26rem;
	padding: 1.75rem;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.75rem;
	text-align: center;
	color: var(--fg-75);
}

.boot-title {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 600;
	color: var(--fg-90);
}

.boot-desc {
	margin: 0;
	font-size: 0.8rem;
	color: var(--fg-50);
}

.boot-desc code {
	background: var(--btn-regular-bg);
	color: var(--btn-content);
	padding: 0.1rem 0.35rem;
	border-radius: 0.4rem;
	font-size: 0.75rem;
}

.boot-actions {
	display: flex;
	gap: 0.5rem;
	margin-top: 0.25rem;
}

.boot-link {
	font-size: 0.78rem;
	color: var(--btn-content);
}

.spinner {
	width: 1.25rem;
	height: 1.25rem;
	border-radius: 999px;
	border: 2px solid var(--line-color);
	border-top-color: var(--primary);
	animation: spin 0.8s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
