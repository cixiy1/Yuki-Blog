<script setup lang="ts">
import { onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { canReview, isAdmin, user } from "../lib/auth";
import {
	isEditable,
	listAllPosts,
	listPosts,
	type PostSummary,
	STATUS_LABEL,
	splitDate,
} from "../lib/posts";
import { go, goRepoEdit } from "../router";

const entries = [
	{
		key: "posts",
		icon: "posts",
		title: "我的文章",
		desc: "写稿、改稿、提交审核",
		path: "/posts",
		show: true,
	},
	{
		key: "all-posts",
		icon: "globe",
		title: "全站文章",
		desc: "已发布的全部文章",
		path: "/all-posts",
		show: canReview.value,
	},
	{
		key: "components",
		icon: "components",
		title: "我的组件",
		desc: "文章里的自定义组件",
		path: "/components",
		show: true,
	},
	{
		key: "review",
		icon: "review",
		title: "审核队列",
		desc: "审待发布的投稿",
		path: "/review",
		show: canReview.value,
	},
	{
		key: "settings",
		icon: "admin",
		title: "站点设置",
		desc: "标题、外观与密钥",
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

/**
 * 右栏放数字，左栏放最近改过的几篇。只有入口卡时整页 2/3 是空白，
 * 看着像没做完；补上最近更新之后，进来第一眼就知道最近动过什么。
 */
const recent = ref<PostSummary[]>([]);

function sortKey(post: PostSummary): number {
	const raw = post.published_at ?? post.updated_at ?? "";
	return Date.parse(raw) || 0;
}

function dayOf(post: PostSummary): string {
	const raw = post.published_at ?? post.updated_at ?? "";
	return splitDate(raw).day;
}

function initialOf(title: string): string {
	const text = (title ?? "").trim();
	return text ? text.slice(0, 1).toUpperCase() : "·";
}

function openPost(post: PostSummary): void {
	if (post.origin === "repo") goRepoEdit(post.slug);
	else go(`/posts/${post.id}`);
}

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
		const pool = all.length ? all : mine;
		recent.value = [...pool]
			.sort((a, b) => sortKey(b) - sortKey(a))
			.slice(0, 5);
	} catch {
		// 未登录或接口不可用时不显示统计，页面其余部分照常
	}
});
</script>

<template>
	<div>
		<PageHeader title="概览" :desc="`你好，${name}。这里是内容与权限入口。`">
			<template #actions>
				<button type="button" class="btn-primary" @click="go('/posts')">
					<AppIcon name="posts" :size="16" />
					去写文章
				</button>
			</template>
		</PageHeader>

		<div class="grid">
			<a
				v-for="entry in entries"
				:key="entry.key"
				class="entry card-base"
				:href="`#${entry.path}`"
				@click.prevent="go(entry.path)"
			>
				<span class="entry-head">
					<span class="entry-icon">
						<AppIcon :name="entry.icon" :size="18" />
					</span>
					<span class="entry-title">{{ entry.title }}</span>
					<AppIcon name="chevron" :size="14" class="entry-go" />
				</span>
				<span class="entry-desc">{{ entry.desc }}</span>
			</a>
		</div>

		<div class="body">
			<section class="recent card-base">
				<div class="sec-head">
					<h2 class="sec-title">最近更新</h2>
					<a
						class="sec-link"
						href="#/all-posts"
						@click.prevent="go(canReview ? '/all-posts' : '/posts')"
					>
						全部
						<AppIcon name="chevron" :size="12" />
					</a>
				</div>

				<ul class="posts">
					<li v-for="post in recent" :key="post.slug">
						<button type="button" class="post" @click="openPost(post)">
							<span class="thumb" :class="{ flat: !post.cover }">
								<img v-if="post.cover" :src="post.cover" alt="" loading="lazy" />
								<span v-else>{{ initialOf(post.title) }}</span>
							</span>
							<span class="post-text">
								<span class="post-title">{{ post.title }}</span>
								<span class="post-sub">
									{{ dayOf(post) }}
									<span class="dot" aria-hidden="true">·</span>
									{{ STATUS_LABEL[post.status] ?? post.status }}
								</span>
							</span>
							<span class="post-act">
								{{ post.origin === "repo" || !isEditable(post.status) ? "打开" : "编辑" }}
							</span>
						</button>
					</li>
				</ul>

				<p v-if="counts && !recent.length" class="recent-empty">
					还没有文章，写第一篇吧。
				</p>
			</section>

			<section v-if="counts" class="stats card-base">
				<div class="sec-head">
					<h2 class="sec-title">内容计数</h2>
				</div>
				<a class="stat" href="#/posts" @click.prevent="go('/posts')">
					<span class="label">我的草稿</span>
					<span class="num">{{ counts.draft }}</span>
				</a>
				<a
					class="stat"
					:class="{ alert: counts.pending > 0 }"
					href="#/review"
					@click.prevent="go('/review')"
				>
					<span class="label">待审稿</span>
					<span class="num">{{ counts.pending }}</span>
				</a>
				<a class="stat" href="#/posts" @click.prevent="go('/posts')">
					<span class="label">我发布的</span>
					<span class="num">{{ counts.published }}</span>
				</a>
				<a
					v-if="canReview"
					class="stat"
					href="#/all-posts"
					@click.prevent="go('/all-posts')"
				>
					<span class="label">全站文章</span>
					<span class="num">{{ counts.site }}</span>
				</a>
			</section>
		</div>

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
/* ---------- 入口：一行五张，图标在左、说明在右，右端一个箭头 ---------- */

.grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
	gap: 0.7rem;
}

.entry {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	padding: 0.7rem 0.8rem;
	transition:
		transform 0.18s ease,
		border-color 0.18s ease;
}

.entry-head {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.entry:hover {
	transform: translateY(-2px);
	border-color: var(--primary);
}

.entry-icon {
	display: inline-grid;
	place-items: center;
	flex: none;
	width: 1.85rem;
	height: 1.85rem;
	border-radius: 0.55rem;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
}

.entry-title {
	font-size: 0.88rem;
	font-weight: 600;
	color: var(--fg-90);
	white-space: nowrap;
}

/* 说明铺满卡宽、最多两行：以前挤在图标右边，一行只放得下六七个字，
   五张卡的说明全被截成「…」 */
.entry-desc {
	font-size: 0.72rem;
	line-height: 1.5;
	color: var(--fg-50);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

/* 最后一行留白，五张卡不等高时说明不会跳位 */

.entry-go {
	flex: none;
	margin-left: auto;
	color: var(--fg-30);
	transition:
		color 0.15s ease,
		transform 0.15s ease;
}

.entry:hover .entry-go {
	color: var(--accent-text);
	transform: translateX(2px);
}

/* ---------- 主体：左边最近更新，右边计数 ---------- */

.body {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 17rem;
	gap: 0.9rem;
	align-items: start;
	margin-top: 0.9rem;
}

@media (max-width: 1080px) {
	.body {
		grid-template-columns: minmax(0, 1fr);
	}
}

.recent,
.stats {
	padding: 0.9rem 1.05rem 0.55rem;
}

.sec-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 0.35rem;
}

.sec-title {
	margin: 0;
	font-size: 0.8rem;
	font-weight: 650;
	color: var(--fg-75);
	letter-spacing: 0.02em;
}

.sec-link {
	display: inline-flex;
	align-items: center;
	gap: 0.1rem;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.sec-link:hover {
	color: var(--accent-text);
}

.posts {
	margin: 0;
	padding: 0;
	list-style: none;
}

.posts li + li {
	border-top: 1px solid var(--line-divider);
}

.post {
	display: flex;
	align-items: center;
	gap: 0.7rem;
	width: 100%;
	padding: 0.6rem 0.15rem;
	border: none;
	background: transparent;
	text-align: left;
	cursor: pointer;
	border-radius: 8px;
	transition: background-color 0.15s ease;
}

.post:hover {
	background: var(--btn-plain-bg-hover);
}

.thumb {
	display: inline-grid;
	place-items: center;
	flex: none;
	width: 2.5rem;
	height: 2.5rem;
	overflow: hidden;
	border-radius: 7px;
	background: var(--btn-regular-bg);
}

.thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}

/* 没有封面时用主题色首字兜住，别留一个空方块 */
.thumb.flat {
	background: color-mix(in oklab, var(--primary) 10%, var(--btn-regular-bg));
	color: var(--accent-text);
	font-size: 1rem;
	font-weight: 700;
}

.post-text {
	display: flex;
	flex-direction: column;
	gap: 0.12rem;
	min-width: 0;
}

.post-title {
	font-size: 0.86rem;
	font-weight: 600;
	color: var(--fg-90);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.post-sub {
	font-size: 0.7rem;
	color: var(--fg-50);
	font-variant-numeric: tabular-nums;
}

.dot {
	margin: 0 0.25rem;
	color: var(--fg-30);
}

.post-act {
	flex: none;
	margin-left: auto;
	font-size: 0.7rem;
	color: var(--fg-50);
	opacity: 0;
	transition: opacity 0.15s ease;
}

.post:hover .post-act {
	opacity: 1;
	color: var(--accent-text);
}

.recent-empty {
	margin: 0.4rem 0 0.6rem;
	font-size: 0.78rem;
	color: var(--fg-50);
}

/* 计数在窄栏里竖排，数字靠右对齐，一眼能顺着读下来 */
.stat {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.6rem;
	padding: 0.62rem 0.15rem;
	border-top: 1px solid var(--line-divider);
	transition: background-color 0.15s ease;
}

.stat:hover {
	background: var(--btn-plain-bg-hover);
}

.stat .label {
	font-size: 0.78rem;
	color: var(--fg-75);
}

.stat .num {
	font-size: 1.35rem;
	font-weight: 700;
	line-height: 1.1;
	color: var(--fg-90);
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.02em;
}

/* 有待审的稿子才亮，0 的时候跟其它数字一样安静 */
.stat.alert .num {
	color: var(--admonitions-color-warning);
}

.stat.alert .label {
	color: var(--admonitions-color-warning);
}

/* ---------- 底部的规则说明 ---------- */

.note {
	margin-top: 0.9rem;
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
	/* 四条规则排一列会把卡片拉得很长，固定两列；auto-fit 在宽屏会排成 3 列，最后一条孤零零落单 */
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.1rem 1.75rem;
	font-size: 0.78rem;
	color: var(--fg-50);
	line-height: 1.9;
}

@media (max-width: 720px) {
	.note ul {
		grid-template-columns: minmax(0, 1fr);
	}
}

/* 手机上一个卡片占满整屏太浪费，改成两列紧凑卡 */
@media (max-width: 560px) {
	.grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.entry {
		padding: 0.7rem;
	}

	.entry-icon {
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 0.55rem;
	}

	.entry-desc {
		display: none;
	}

	.recent,
	.stats {
		padding: 0.8rem 0.9rem 0.4rem;
	}
}
</style>
