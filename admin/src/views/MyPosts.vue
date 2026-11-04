<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import PostList from "../components/PostList.vue";
import { ApiError } from "../lib/api";
import { canReview, isAdmin } from "../lib/auth";
import {
	createPost,
	deletePost,
	isEditable,
	listPosts,
	type PostStatus,
	type PostSummary,
	publishPost,
	submitPost,
	withdrawPost,
} from "../lib/posts";
import { go, goRepoEdit } from "../router";

const posts = ref<PostSummary[]>([]);
const loading = ref(true);
const busyId = ref(0);
const errorText = ref("");
const notice = ref("");

const FILTERS: Array<{ key: string; label: string; status?: PostStatus }> = [
	{ key: "all", label: "全部" },
	{ key: "draft", label: "草稿", status: "draft" },
	{ key: "pending", label: "待审", status: "pending" },
	{ key: "published", label: "已发布", status: "published" },
	{ key: "rejected", label: "被退回", status: "rejected" },
];

const activeFilter = ref("all");

const visible = computed(() => {
	const filter = FILTERS.find((item) => item.key === activeFilter.value);
	if (!filter?.status) return posts.value;
	return posts.value.filter((post) => post.status === filter.status);
});

const counts = computed(() => {
	const map: Record<string, number> = { all: posts.value.length };
	for (const post of posts.value) {
		map[post.status] = (map[post.status] ?? 0) + 1;
	}
	return map;
});

async function refresh(): Promise<void> {
	loading.value = true;
	errorText.value = "";
	try {
		posts.value = await listPosts();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}
}

async function onCreate(): Promise<void> {
	busyId.value = -1;
	errorText.value = "";
	try {
		const post = await createPost("未命名文章");
		if (post) go(`/posts/${post.id}`);
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "新建失败";
	} finally {
		busyId.value = 0;
	}
}

/** 管理员：D1 草稿直接写成仓库文件，不进审核队列 */
async function onPublish(post: PostSummary): Promise<void> {
	busyId.value = post.id;
	errorText.value = "";
	notice.value = "";
	try {
		await publishPost(post.id);
		notice.value = `《${post.title}》已发布，约一分钟后站点上线`;
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "发布失败";
	} finally {
		busyId.value = 0;
	}
}

async function onSubmit(post: PostSummary): Promise<void> {
	busyId.value = post.id;
	errorText.value = "";
	notice.value = "";
	try {
		await submitPost(post.id);
		notice.value = `《${post.title}》已提交审核`;
		await refresh();
	} catch (error) {
		errorText.value =
			error instanceof ApiError ? error.message : "提交失败，请重试";
	} finally {
		busyId.value = 0;
	}
}

async function onWithdraw(post: PostSummary): Promise<void> {
	if (
		!window.confirm(
			`撤回《${post.title}》？撤回后回到草稿可以继续改，审核人会收到提醒。`,
		)
	) {
		return;
	}
	busyId.value = post.id;
	errorText.value = "";
	try {
		await withdrawPost(post.id);
		notice.value = `《${post.title}》已撤回为草稿，可以继续修改`;
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "撤回失败";
	} finally {
		busyId.value = 0;
	}
}

async function onDelete(post: PostSummary): Promise<void> {
	if (!window.confirm(`删除《${post.title}》？删掉就找不回来了。`)) return;
	busyId.value = post.id;
	errorText.value = "";
	try {
		await deletePost(post.id);
		notice.value = `已删除《${post.title}》`;
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "删除失败";
	} finally {
		busyId.value = 0;
	}
}

/** 点行就进编辑器：仓库文章改文件，站内稿子进 D1 草稿页 */
function openPost(post: PostSummary): void {
	if (post.origin === "repo") goRepoEdit(post.slug);
	else go(`/posts/${post.id}`);
}

onMounted(refresh);
</script>

<template>
	<div>
		<PageHeader
			title="我的文章"
			desc="署名为你的全部文章。草稿存在站内，随时可以继续改。"
		>
			<template #actions>
				<button
					type="button"
					class="btn-primary"
					:disabled="busyId === -1"
					@click="onCreate"
				>
					<AppIcon name="plus" :size="16" />
					新建文章
				</button>
			</template>
		</PageHeader>

		<div class="tabs">
			<button
				v-for="filter in FILTERS"
				:key="filter.key"
				type="button"
				class="tab"
				:class="{ active: activeFilter === filter.key }"
				@click="activeFilter = filter.key"
			>
				{{ filter.label }}
				<span class="count">{{ counts[filter.status ?? 'all'] ?? 0 }}</span>
			</button>
		</div>

		<p v-if="notice" class="notice">{{ notice }}</p>
		<p v-if="errorText" class="error">{{ errorText }}</p>

		<div v-if="loading" class="state">读取中…</div>
		<div v-else-if="visible.length === 0" class="state card-base">
			这里还没有文章。点上面的「新建文章」开始写。
		</div>

		<PostList
			v-else
			:items="visible"
			show-status
			:count-text="`${visible.length} 篇`"
			sort-text="按最后改动时间排序"
			@open="openPost"
		>
			<template #actions="{ post }">
				<template v-if="post.origin === 'repo'">
					<button type="button" class="btn-regular act" @click="goRepoEdit(post.slug)">
						编辑
					</button>
					<a
						class="btn-ghost act"
						:href="`/posts/${post.slug}/`"
						target="_blank"
						rel="noopener"
					>
						<AppIcon name="external" :size="15" />
					</a>
				</template>
				<template v-else>
					<button
						type="button"
						class="btn-regular act"
						:disabled="busyId === post.id"
						@click="go(`/posts/${post.id}`)"
					>
						{{ isEditable(post.status) ? "编辑" : "查看" }}
					</button>
					<button
						v-if="isEditable(post.status) && isAdmin"
						type="button"
						class="btn-ghost act"
						:disabled="busyId === post.id"
						@click="onPublish(post)"
					>
						发布
					</button>
					<button
						v-if="isEditable(post.status) && !isAdmin"
						type="button"
						class="btn-ghost act"
						:disabled="busyId === post.id"
						@click="onSubmit(post)"
					>
						提交审核
					</button>
					<button
						v-if="post.status === 'pending'"
						type="button"
						class="btn-ghost act"
						:disabled="busyId === post.id"
						@click="onWithdraw(post)"
					>
						撤回
					</button>
					<button
						v-if="isEditable(post.status)"
						type="button"
						class="btn-ghost act danger"
						:disabled="busyId === post.id"
						:title="`删除《${post.title}》`"
						@click="onDelete(post)"
					>
						<AppIcon name="trash" :size="15" />
					</button>
				</template>
			</template>
		</PostList>

		<p class="footnote">
			<template v-if="canReview">
				站内草稿自动保存，不产生 git 提交，写完点「发布」直接上线；已发布的那几篇对应
				<code>src/content/posts/</code> 里的文件，编辑即改文件，保存会触发构建。
				别人的稿子走「提交审核」。
			</template>
			<template v-else>
				草稿存在站内，自动保存不会上线。写完点「提交审核」，通过后自动发布。
			</template>
		</p>
	</div>
</template>

<style scoped>
.tabs {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
	margin-bottom: 0.85rem;
}

.tab {
	border: none;
	background: transparent;
	padding: 0.32rem 0.65rem;
	border-radius: 0.6rem;
	font-size: 0.8rem;
	color: var(--fg-50);
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.tab:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.tab.active {
	background: var(--tab-on-bg);
	color: var(--accent-text);
	font-weight: 600;
}

.count {
	margin-left: 0.2rem;
	font-size: 0.72rem;
	opacity: 0.7;
}

.notice {
	margin: 0 0 0.7rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.8rem;
}

.error {
	margin: 0 0 0.7rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: color-mix(in oklab, var(--admonitions-color-caution) 14%, transparent);
	color: var(--admonitions-color-caution);
	font-size: 0.8rem;
}

.state {
	padding: 2rem 1rem;
	text-align: center;
	font-size: 0.85rem;
	color: var(--fg-50);
}

.act {
	padding: 0.32rem 0.68rem;
	font-size: 0.78rem;
}

.danger:hover {
	color: var(--admonitions-color-caution);
}

.footnote {
	margin: 1.1rem 0 0;
	font-size: 0.76rem;
	color: var(--fg-50);
	line-height: 1.8;
}
</style>
