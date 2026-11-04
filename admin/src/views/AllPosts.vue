<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import EmptyState from "../components/EmptyState.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import PostList from "../components/PostList.vue";
import { listAllPosts, type PostSummary } from "../lib/posts";
import { go, goRepoEdit } from "../router";

/**
 * 全站文章：站点上已经发布的内容，来自 src/content/posts。
 * 和「我的文章」分开——那栏只放自己在管理端写的稿子，这栏是站点的全部成品。
 */
const posts = ref<PostSummary[]>([]);
const loading = ref(true);
const errorText = ref("");
const keyword = ref("");

const visible = computed(() => {
	const query = keyword.value.trim().toLowerCase();
	if (!query) return posts.value;
	return posts.value.filter((post) =>
		[post.title, post.slug, post.summary, post.tags.join(" ")].some((text) =>
			text.toLowerCase().includes(query),
		),
	);
});

const summaryText = computed(() => {
	if (loading.value) return "";
	if (!keyword.value.trim()) return `共 ${posts.value.length} 篇`;
	return `${visible.value.length} / ${posts.value.length} 篇`;
});

async function refresh(): Promise<void> {
	loading.value = true;
	errorText.value = "";
	try {
		posts.value = await listAllPosts();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}
}

/** 仓库文章进编辑器改文件；D1 里的已发布行只能回详情页看 */
function open(post: PostSummary): void {
	if (post.origin === "repo") goRepoEdit(post.slug, "all-posts");
	else go(`/posts/${post.id}`);
}

onMounted(refresh);
</script>

<template>
	<div>
		<PageHeader
			title="全站文章"
			desc="站点上已发布的全部文章，读的是仓库快照；编辑即改文件，保存后构建生效。"
		>
			<template #actions>
				<label class="search-box">
					<AppIcon name="search" :size="15" />
					<input v-model="keyword" class="search-input" placeholder="搜索标题、摘要或标签" />
				</label>
				<button type="button" class="btn-regular" @click="refresh">
					<AppIcon name="refresh" :size="15" />
					刷新
				</button>
			</template>
		</PageHeader>

		<p v-if="errorText" class="error">{{ errorText }}</p>

		<LoadingState v-if="loading" :rows="5" />
		<EmptyState
			v-else-if="visible.length === 0"
			:icon="keyword ? 'search' : 'posts'"
			:title="keyword ? '没有匹配的文章' : '站点上还没有已发布的文章'"
			:desc="
				keyword
					? '换个关键词，或者清空搜索看全部。'
					: '发布过的文章都会出现在这里，列表按发布时间倒序。'
			"
		/>

		<PostList
			v-else
			:items="visible"
			date-field="published_at"
			:count-text="summaryText"
			sort-text="按发布时间倒序"
			@open="open"
		/>

		<p class="footnote">
			这里的每一篇都对应 <code>src/content/posts/</code> 下的一个文件。列表是构建时的
			frontmatter 快照，改完要等这次构建跑完（约一分钟）才会更新。
		</p>
	</div>
</template>

<style scoped>
.search-box {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	width: 15rem;
	height: 2.35rem;
	padding: 0 0.7rem;
	border-radius: 0.6rem;
	background: var(--btn-regular-bg);
	color: var(--fg-50);
	transition:
		background-color 0.15s ease,
		box-shadow 0.15s ease,
		color 0.15s ease;
}

/* 聚焦时整块换成描边高亮，比只给 input 描边更像一个完整的输入件 */
.search-box:focus-within {
	background: var(--card-bg);
	color: var(--fg-90);
	box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--primary) 55%, transparent);
}

.search-input {
	flex: 1;
	min-width: 0;
	border: none;
	background: transparent;
	outline: none;
	font-size: 0.82rem;
	color: var(--fg-90);
}

.search-input::placeholder {
	color: var(--fg-50);
}

.error {
	margin: 0 0 0.75rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: color-mix(in oklab, var(--admonitions-color-caution) 14%, transparent);
	color: var(--admonitions-color-caution);
	font-size: 0.8rem;
}

/* 脚注收成一条带强调线的说明，别让它在页面底部散成一团灰字 */
.footnote {
	margin: 1.4rem 0 0;
	padding-left: 0.75rem;
	border-left: 2px solid var(--line-divider);
	font-size: 0.72rem;
	color: var(--fg-50);
	line-height: 1.9;
}

@media (max-width: 640px) {
	.search-box {
		width: 100%;
	}
}
</style>
