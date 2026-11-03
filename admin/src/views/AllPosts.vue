<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { formatTime, listAllPosts, type PostSummary } from "../lib/posts";
import { goRepoEdit } from "../router";

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
		[post.title, post.slug, post.tags.join(" ")].some((text) =>
			text.toLowerCase().includes(query),
		),
	);
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

onMounted(refresh);
</script>

<template>
	<div>
		<PageHeader
			title="全站文章"
			desc="站点上已发布的全部文章，读的是仓库快照；编辑即改文件，保存后构建生效。"
		>
			<template #actions>
				<input
					v-model="keyword"
					class="field search"
					placeholder="搜索标题、地址或标签"
				/>
				<button type="button" class="btn-regular" @click="refresh">
					<AppIcon name="refresh" :size="15" />
					刷新
				</button>
			</template>
		</PageHeader>

		<p v-if="errorText" class="error">{{ errorText }}</p>

		<div v-if="loading" class="state">读取中…</div>
		<div v-else-if="visible.length === 0" class="state">
			{{ keyword ? "没有匹配的文章" : "站点上还没有已发布的文章" }}
		</div>

		<ul v-else class="list">
			<li
				v-for="post in visible"
				:key="post.slug"
				class="row card-base"
			>
				<div class="row-main">
					<p class="row-title">
						{{ post.title }}
						<span v-if="post.source_link" class="badge repost">转载</span>
					</p>
					<p class="row-meta">
						<code>/posts/{{ post.slug }}/</code>
						<span>·</span>
						<span>{{ formatTime(post.published_at) }}</span>
						<span v-if="post.category">·</span>
						<span v-if="post.category">{{ post.category }}</span>
						<span v-if="post.tags.length">·</span>
						<span v-if="post.tags.length">{{ post.tags.join(" / ") }}</span>
					</p>
				</div>
				<div class="row-actions">
					<button
						type="button"
						class="btn-regular"
						@click="goRepoEdit(post.slug, 'all-posts')"
					>
						编辑
					</button>
					<a
						class="btn-ghost"
						:href="`/posts/${post.slug}/`"
						target="_blank"
						rel="noopener"
					>
						<AppIcon name="external" :size="15" />
					</a>
				</div>
			</li>
		</ul>

		<p class="footnote">
			这里的每一篇都对应 <code>src/content/posts/</code> 下的一个文件。列表是构建时的
			frontmatter 快照，改完要等这次构建跑完（约一分钟）才会更新。
		</p>
	</div>
</template>

<style scoped>
.search {
	width: 15rem;
	height: 2.35rem;
}

.list {
	margin: 0;
	padding: 0;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
}

.row {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.8rem 1rem;
}

.row-main {
	min-width: 0;
	flex: 1;
}

.row-title {
	margin: 0;
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.35rem;
	font-size: 0.9rem;
	font-weight: 600;
	color: var(--fg-90);
}

.row-meta {
	margin: 0.25rem 0 0;
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
	font-size: 0.75rem;
	color: var(--fg-50);
}

.row-meta code {
	font-size: 0.72rem;
}

.row-actions {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	flex: none;
}

.badge {
	font-size: 0.68rem;
	font-weight: 600;
	padding: 0.06rem 0.42rem;
	border-radius: 999px;
}

.badge.repost {
	background: color-mix(in oklab, var(--admonitions-color-note) 16%, transparent);
	color: var(--admonitions-color-note);
}

.state {
	padding: 2rem 0;
	text-align: center;
	font-size: 0.85rem;
	color: var(--fg-50);
}

.footnote {
	margin: 1.1rem 0 0;
	font-size: 0.72rem;
	color: var(--fg-30);
	line-height: 1.8;
}

@media (max-width: 640px) {
	.search {
		width: 100%;
	}

	.row {
		flex-direction: column;
		align-items: flex-start;
		gap: 0.6rem;
	}
}
</style>
