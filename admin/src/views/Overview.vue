<script setup lang="ts">
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { canReview, isAdmin, user } from "../lib/auth";
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
		key: "admin",
		icon: "admin",
		title: "站点管理",
		desc: "用户、组织、设置与审计。",
		path: "/admin",
		show: isAdmin.value,
	},
].filter((item) => item.show);

const name = user.value?.display_name || user.value?.email.split("@")[0] || "";
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

		<section class="note card-base">
			<p class="note-title">当前阶段</p>
			<ul>
				<li>草稿正文存在 D1，自动保存不会产生 git 提交。</li>
				<li>提交审核后（下一阶段）才写入仓库 inbox/，通过后移到文章目录并触发构建。</li>
				<li>管理端不参与主站搜索索引，也不进 sitemap 与统计。</li>
			</ul>
		</section>
	</div>
</template>

<style scoped>
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
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
	color: var(--btn-content);
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
	margin-top: 1.25rem;
	padding: 1rem 1.15rem;
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
</style>
