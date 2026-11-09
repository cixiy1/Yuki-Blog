<script setup lang="ts">
import { onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import EmptyState from "../components/EmptyState.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import { listSpecPages, type SpecPageSummary, specPageUrl } from "../lib/pages";
import { goPageEdit } from "../router";

/**
 * 站点固定页面：关于、友链、留言板。
 * 这些文件不进文章列表，也没有草稿链路，编辑就是直接改仓库文件。
 */
const pages = ref<SpecPageSummary[]>([]);
const loading = ref(true);
const errorText = ref("");

async function refresh(): Promise<void> {
	loading.value = true;
	errorText.value = "";
	try {
		pages.value = await listSpecPages();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}
}

onMounted(refresh);
</script>

<template>
	<div>
		<PageHeader
			title="页面"
			desc="关于我、友链、留言板这类固定页面。保存即写入仓库并触发构建，没有草稿这一步。"
		>
			<template #actions>
				<button type="button" class="btn-regular" @click="refresh">
					<AppIcon name="refresh" :size="15" />
					刷新
				</button>
			</template>
		</PageHeader>

		<p v-if="errorText" class="error">{{ errorText }}</p>

		<LoadingState v-if="loading" variant="list" :rows="3" label="读取页面" />
		<EmptyState
			v-else-if="pages.length === 0"
			icon="page"
			title="没有可编辑的页面"
			desc="src/content/spec 下只有 .md / .mdx 文件会出现在这里。"
		/>

		<div v-else class="card-base list">
			<div v-for="page in pages" :key="page.file" class="row">
				<span class="mark">
					<AppIcon name="page" :size="18" />
				</span>
				<div class="meta">
					<p class="title">{{ page.title }}</p>
					<p class="path">src/content/spec/{{ page.file }}</p>
				</div>
				<div class="actions">
					<a
						class="btn-regular open"
						:href="specPageUrl(page.file)"
						target="_blank"
						rel="noopener"
						title="在新标签页打开线上页面"
					>
						<AppIcon name="external" :size="14" />
						查看
					</a>
					<button
						type="button"
						class="btn-primary"
						@click="goPageEdit(page.file)"
					>
						编辑
					</button>
				</div>
			</div>
		</div>

		<p class="footnote">
			每份文件对应 <code>src/content/spec/</code> 下的一个页面，正文里的 Markdown 与
			HTML 都原样保存。改完要等这次构建跑完（约一分钟）线上才会变。
		</p>
	</div>
</template>

<style scoped>
.error {
	margin: 0 0 1rem;
	padding: 0.7rem 0.9rem;
	border-radius: 0.7rem;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.84rem;
}

.list {
	overflow: hidden;
}

.row {
	display: flex;
	align-items: center;
	gap: 0.85rem;
	padding: 0.95rem 1.1rem;
}

.row + .row {
	border-top: 1px solid var(--line-divider);
}

.mark {
	display: grid;
	place-items: center;
	width: 2.2rem;
	height: 2.2rem;
	border-radius: 0.7rem;
	background: var(--btn-regular-bg);
	color: var(--accent-text);
	flex: none;
}

.meta {
	flex: 1;
	min-width: 0;
}

.title {
	margin: 0;
	color: var(--fg-90);
	font-size: 0.94rem;
	font-weight: 600;
	line-height: 1.4;
}

.path {
	margin: 0.15rem 0 0;
	color: var(--fg-50);
	font-size: 0.75rem;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.actions {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	flex: none;
}

.actions .btn-regular,
.actions .btn-primary {
	height: 2.1rem;
	padding: 0 0.85rem;
	font-size: 0.82rem;
}

.footnote {
	margin: 1rem 0 0;
	color: var(--fg-50);
	font-size: 0.78rem;
	line-height: 1.7;
}

.footnote code {
	padding: 0.05rem 0.3rem;
	border-radius: 0.35rem;
	background: var(--btn-regular-bg);
	font-size: 0.75rem;
}

@media (max-width: 640px) {
	.row {
		flex-wrap: wrap;
	}

	.actions {
		width: 100%;
		justify-content: flex-end;
	}
}
</style>
