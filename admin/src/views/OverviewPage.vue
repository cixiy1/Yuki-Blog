<script setup lang="ts">
import { onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { canReview, isAdmin, user } from "../lib/auth";
import { listAllPosts, listPosts } from "../lib/posts";
import { go } from "../router";

const entries = [
	{
		key: "posts",
		icon: "posts",
		title: "我的文章",
		desc: "写草稿、改稿、提交审核。",
		path: "/posts",
		show: true,
	},
	{
		key: "all-posts",
		icon: "globe",
		title: "全站文章",
		desc: "站点上已发布的全部文章。",
		path: "/all-posts",
		show: canReview.value,
	},
	{
		key: "components",
		icon: "components",
		title: "我的组件",
		desc: "文章里可 import 的自定义组件。",
		path: "/components",
		show: true,
	},
	{
		key: "review",
		icon: "review",
		title: "审核队列",
		desc: "审待发布的投稿，通过后进构建。",
		path: "/review",
		show: canReview.value,
	},
	{
		key: "settings",
		icon: "admin",
		title: "站点设置",
		desc: "标题、外观、页面开关与密钥。",
		path: "/settings",
		show: isAdmin.value,
	},
].filter((item) => item.show);

const name = user.value?.display_name || user.value?.email.split("@")[0] || "";

/** 概览只有入口卡会显得空，补一组自己的内容计数，顺手让「有几篇待审」一眼可见 */
const counts = ref<{
	draft: number;
	pending: number;
	published: number;
	site: number;
} | null>(null);

onMounted(async () => {
	try {
		const mine = await listPosts();
		const all = canReview.value ? await listAllPosts() : [];
		counts.value = {
			draft: mine.filter((post) => post.status === "draft").length,
			pending: mine.filter((post) => post.status === "pending").length,
			published: mine.filter((post) => post.status === "published").length,
			site: all.length,
		};
	} catch {
		// 未登录或接口不可用时不显示统计，页面其余部分照常
	}
});
</script>

<template>
	<div>
		<PageHeader title="概览" :desc="`你好，${name}。这里是内容与权限入口。`" />

		<div class="grid">
			<a
				v-for="entry in entries"
				:key="entry.key"
				class="entry card-base"
				:href="`#${entry.path}`"
				@click.prevent="go(entry.path)"
			>
				<span class="entry-icon">
					<AppIcon :name="entry.icon" :size="20" />
				</span>
				<p class="entry-title">{{ entry.title }}</p>
				<p class="entry-desc">{{ entry.desc }}</p>
			</a>
		</div>

		<section v-if="counts" class="stats card-base">
			<div class="stat">
				<span class="num">{{ counts.draft }}</span>
				<span class="label">我的草稿</span>
			</div>
			<div class="stat">
				<span class="num">{{ counts.pending }}</span>
				<span class="label">待审</span>
			</div>
			<div class="stat">
				<span class="num">{{ counts.published }}</span>
				<span class="label">我发布的</span>
			</div>
			<div v-if="canReview" class="stat">
				<span class="num">{{ counts.site }}</span>
				<span class="label">全站文章</span>
			</div>
			<a class="stat-go" href="#/posts" @click.prevent="go('/posts')">
				去看文章
				<AppIcon name="external" :size="14" />
			</a>
		</section>

		<section class="note card-base">
			<p class="note-title">这里的规则</p>
			<ul>
				<li>草稿存在站内，自动保存不产生 git 提交，也不会上线。</li>
				<li>管理员点「发布」直接写进仓库并触发构建；其他人提交后由审核员处理。</li>
				<li>已发布的文章再编辑，改的是仓库里的文件，保存就提交一次。</li>
				<li>管理端不参与主站搜索索引，也不进 sitemap 与统计。</li>
			</ul>
		</section>
	</div>
</template>

<style scoped>
.grid {
	display: grid;
	/* 入口卡现在有五张，15rem 在 1440 下只能排四张、第二行剩一张孤零零的 */
	grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
	gap: 0.85rem;
}

.entry {
	padding: 1rem 1.1rem;
	display: block;
	transition:
		transform 0.18s ease,
		border-color 0.18s ease;
}

.entry:hover {
	transform: translateY(-2px);
	border-color: var(--primary);
}

.entry-icon {
	display: inline-grid;
	place-items: center;
	width: 2.1rem;
	height: 2.1rem;
	border-radius: 0.7rem;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
}

.entry-title {
	margin: 0.6rem 0 0;
	font-size: 0.92rem;
	font-weight: 600;
	color: var(--fg-90);
}

.entry-desc {
	margin: 0.15rem 0 0;
	font-size: 0.78rem;
	color: var(--fg-50);
}

.note {
	margin-top: 1rem;
	padding: 1rem 1.15rem;
}

.stats {
	display: flex;
	align-items: center;
	gap: 2.25rem;
	margin-top: 1rem;
	padding: 0.9rem 1.2rem;
}

.stat {
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
}

.stat .num {
	font-size: 1.35rem;
	font-weight: 700;
	line-height: 1.2;
	color: var(--fg-90);
	font-variant-numeric: tabular-nums;
}

.stat .label {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.stat-go {
	margin-left: auto;
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	padding: 0.4rem 0.75rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.78rem;
	font-weight: 600;
}

.stat-go:hover {
	background: var(--btn-regular-bg-hover);
}

@media (max-width: 560px) {
	.stats {
		gap: 1.4rem;
		padding: 0.8rem 1rem;
	}

	.stat .num {
		font-size: 1.15rem;
	}
}

.note-title {
	margin: 0 0 0.4rem;
	font-size: 0.82rem;
	font-weight: 600;
	color: var(--fg-75);
}

.note ul {
	margin: 0;
	padding-left: 1.1rem;
	font-size: 0.78rem;
	color: var(--fg-50);
	line-height: 1.9;
}

/* 手机上一个卡片占满整屏太浪费，改成两列紧凑卡 */
@media (max-width: 560px) {
	.grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.entry {
		padding: 0.75rem 0.8rem;
	}

	.entry-icon {
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 0.55rem;
	}

	.entry-title {
		margin-top: 0.45rem;
		font-size: 0.85rem;
	}

	.entry-desc {
		font-size: 0.72rem;
		line-height: 1.55;
	}
}
</style>
