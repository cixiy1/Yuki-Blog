/**
 * 文章列表：我的文章 / 全站文章共用。
 *
 * 三种视图，切换结果记在 localStorage：
 * - masonry（默认）瀑布：CSS columns 自适应列数，卡片高度随内容参差
 * - grid 网格：等宽等高，同排卡片底边对齐
 * - list 列表：整份一个容器，行间只有 1px 分隔线
 *
 * 文字按重要性分三级：标题最重（700、最深色），摘要次之（0.78rem、弱色），
 * 日期与标签最小（0.66-0.72rem、更淡）。别把 slug 这类机器字段放正文位置。
 */
<script setup lang="ts">
import { computed, ref } from "vue";
import {
	isEditable,
	type PostSummary,
	STATUS_LABEL,
	splitDate,
} from "../lib/posts";
import AppIcon from "./AppIcon.vue";

const props = withDefaults(
	defineProps<{
		items: PostSummary[];
		/** 显示草稿/待审这类状态；全站文章都是已发布，没必要每张卡挂一个「已发布」 */
		showStatus?: boolean;
		/** 日期取哪个字段：草稿看改动时间，已发布看发布时间 */
		dateField?: "updated_at" | "published_at";
		/** 标签最多显示几个，多出来的折成 +N */
		maxTags?: number;
		/** 工具条左侧计数，如「23 篇」；留空不渲染 */
		countText?: string;
		/** 工具条里的排序说明，如「按发布时间倒序」 */
		sortText?: string;
	}>(),
	{ showStatus: false, dateField: "updated_at", maxTags: 4 },
);

const emit = defineEmits<{ open: [post: PostSummary] }>();

type ViewMode = "masonry" | "grid" | "list";

const VIEW_OPTIONS: { key: ViewMode; label: string; icon: string }[] = [
	{ key: "masonry", label: "瀑布流", icon: "view-masonry" },
	{ key: "grid", label: "网格", icon: "view-grid" },
	{ key: "list", label: "列表", icon: "view-list" },
];

const VIEW_KEY = "yb.post-list-view";

function readView(): ViewMode {
	try {
		const saved = localStorage.getItem(VIEW_KEY);
		if (saved === "masonry" || saved === "grid" || saved === "list")
			return saved;
	} catch {
		// 隐私模式读 localStorage 会抛，回落默认值就行
	}
	return "masonry";
}

const view = ref<ViewMode>(readView());

function setView(next: ViewMode): void {
	view.value = next;
	try {
		localStorage.setItem(VIEW_KEY, next);
	} catch {
		// 存不下不影响本次会话
	}
}

interface Row {
	post: PostSummary;
	day: string;
	year: string;
	tags: string[];
	more: number;
	editLabel: string;
}

const rows = computed<Row[]>(() =>
	props.items.map((post) => {
		const raw =
			props.dateField === "published_at" ? post.published_at : post.updated_at;
		const { day, year } = splitDate(raw ?? post.updated_at);
		const all = post.tags ?? [];
		return {
			post,
			day,
			year,
			tags: all.slice(0, props.maxTags),
			more: Math.max(0, all.length - props.maxTags),
			editLabel:
				post.origin === "repo"
					? "编辑"
					: isEditable(post.status)
						? "编辑"
						: "查看",
		};
	}),
);
</script>

<template>
	<div class="post-block">
		<div class="list-bar">
			<span v-if="countText" class="bar-count">{{ countText }}</span>
			<span v-if="sortText" class="bar-note">{{ sortText }}</span>
			<div class="view-switch" role="group" aria-label="切换列表视图">
				<button
					v-for="option in VIEW_OPTIONS"
					:key="option.key"
					type="button"
					class="view-btn"
					:class="{ on: view === option.key }"
					:title="option.label"
					:aria-label="option.label"
					:aria-pressed="view === option.key"
					@click="setView(option.key)"
				>
					<AppIcon :name="option.icon" :size="16" />
				</button>
			</div>
		</div>

		<ul
			class="post-list"
			:class="{ 'card-base': view === 'list' }"
			:data-view="view"
		>
			<li
				v-for="row in rows"
				:key="
					row.post.origin === 'repo'
						? `repo-${row.post.slug}`
						: `db-${row.post.id}`
				"
				class="post-item"
				@click="emit('open', row.post)"
			>
				<div class="col-date">
					<span class="date-day">{{ row.day }}</span>
					<span class="date-year">{{ row.year }}</span>
				</div>

				<div class="col-main">
					<h2 class="post-title">{{ row.post.title }}</h2>
					<p v-if="row.post.summary" class="post-summary">
						{{ row.post.summary }}
					</p>
					<p
						v-if="row.post.status === 'rejected' && row.post.review_note"
						class="post-note"
					>
						退回理由：{{ row.post.review_note }}
					</p>
					<div v-if="row.tags.length" class="tag-row">
						<span v-for="tag in row.tags" :key="tag" class="tag">#{{ tag }}</span>
						<span v-if="row.more" class="tag-more">+{{ row.more }}</span>
					</div>
				</div>

				<div class="col-side">
					<span v-if="showStatus" class="badge" :data-status="row.post.status">
						{{ STATUS_LABEL[row.post.status] ?? row.post.status }}
					</span>
					<span v-if="row.post.source_link" class="badge repost">转载</span>

					<div class="row-actions" @click.stop>
						<slot name="actions" :post="row.post">
							<button
								type="button"
								class="btn-regular"
								@click="emit('open', row.post)"
							>
								{{ row.editLabel }}
							</button>
							<a
								class="btn-ghost"
								:href="`/posts/${row.post.slug}/`"
								target="_blank"
								rel="noopener"
								:title="`打开 /posts/${row.post.slug}/`"
							>
								<AppIcon name="external" :size="15" />
							</a>
						</slot>
					</div>
				</div>
			</li>
		</ul>
	</div>
</template>

<style scoped>
.list-bar {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin: 0 0 0.65rem;
	min-height: 1.9rem;
}

.bar-count {
	font-size: 0.8rem;
	font-weight: 600;
	color: var(--fg-75);
	font-variant-numeric: tabular-nums;
}

.bar-note {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.view-switch {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: 0.1rem;
	padding: 0.14rem;
	border-radius: 8px;
	border: 1px solid var(--line-divider);
}

.view-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.72rem;
	height: 1.62rem;
	padding: 0;
	border: none;
	border-radius: 6px;
	background: transparent;
	color: var(--fg-50);
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.view-btn:hover {
	color: var(--fg-90);
	background: var(--btn-plain-bg-hover);
}

.view-btn.on {
	color: var(--fg-90);
	background: var(--btn-regular-bg);
}

.post-list {
	margin: 0;
	padding: 0;
	list-style: none;
}

/* ---------- 列表视图：整份一个容器，行间只留分隔线 ---------- */

.post-list[data-view="list"] {
	overflow: hidden;
}

.post-list[data-view="list"] .post-item {
	display: grid;
	grid-template-columns: 2.9rem minmax(0, 1fr) auto;
	grid-template-areas: "date main side";
	gap: 1rem;
	padding: 0.95rem 1.15rem;
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.post-list[data-view="list"] .post-item + .post-item {
	border-top: 1px solid var(--line-divider);
}

.post-list[data-view="list"] .post-item:hover,
.post-list[data-view="list"] .post-item:focus-within {
	background: var(--btn-plain-bg-hover);
}

/* ---------- 瀑布 / 网格：每篇一张独立卡片 ---------- */

.post-list[data-view="masonry"] {
	columns: 3 18rem;
	column-gap: 0.7rem;
}

.post-list[data-view="masonry"] .post-item {
	break-inside: avoid;
	margin: 0 0 0.7rem;
}

.post-list[data-view="grid"] {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr));
	gap: 0.7rem;
}

.post-list[data-view="masonry"] .post-item,
.post-list[data-view="grid"] .post-item {
	display: grid;
	/* main 行撑满，日期与操作贴底——同排卡片底边就能对齐 */
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas:
		"main main"
		"date side";
	grid-template-rows: 1fr auto;
	gap: 0.55rem 0.6rem;
	padding: 0.85rem 0.95rem;
	border: 1px solid var(--line-divider);
	border-radius: 10px;
	background: var(--card-bg);
	cursor: pointer;
	transition:
		border-color 0.15s ease,
		background-color 0.15s ease;
}

.post-list[data-view="masonry"] .post-item:hover,
.post-list[data-view="grid"] .post-item:hover,
.post-list[data-view="masonry"] .post-item:focus-within,
.post-list[data-view="grid"] .post-item:focus-within {
	border-color: var(--line-color);
	background: var(--btn-plain-bg-hover);
}

/* ---------- 三块内容 ---------- */

.col-date {
	grid-area: date;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	line-height: 1.25;
}

.date-day {
	font-size: 0.72rem;
	font-weight: 600;
	color: var(--fg-75);
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.01em;
}

.date-year {
	font-size: 0.64rem;
	color: var(--fg-30);
	font-variant-numeric: tabular-nums;
}

.col-main {
	grid-area: main;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.32rem;
}

.post-title {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 700;
	line-height: 1.45;
	color: var(--fg-90);
	letter-spacing: -0.005em;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.post-item:hover .post-title {
	color: var(--accent-text);
}

.post-summary {
	margin: 0;
	font-size: 0.78rem;
	line-height: 1.65;
	color: var(--content-meta);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* 卡片里摘要给三行：瀑布的高度差就来自这里，参差才自然 */
.post-list[data-view="masonry"] .post-summary,
.post-list[data-view="grid"] .post-summary {
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	white-space: normal;
}

.post-list[data-view="grid"] .post-summary {
	-webkit-line-clamp: 2;
}

.post-note {
	margin: 0;
	font-size: 0.74rem;
	line-height: 1.6;
	color: var(--admonitions-color-caution);
}

.tag-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3rem;
	margin-top: 0.08rem;
}

.tag {
	font-size: 0.66rem;
	line-height: 1.55;
	padding: 0 0.4rem;
	border-radius: 999px;
	border: 1px solid var(--line-divider);
	color: var(--fg-50);
	white-space: nowrap;
}

.tag-more {
	font-size: 0.64rem;
	color: var(--fg-30);
}

.col-side {
	grid-area: side;
	display: flex;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 0.45rem;
}

.badge {
	white-space: nowrap;
	font-size: 0.66rem;
	font-weight: 600;
	line-height: 1.6;
	padding: 0 0.42rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
}

.badge[data-status="pending"] {
	background: color-mix(in oklab, var(--admonitions-color-warning) 18%, transparent);
	color: var(--admonitions-color-warning);
}

/* 已发布是常态，不上色——一屏全是绿徽章，真正要处理的待审/退回反而看不出 */
.badge[data-status="published"] {
	background: transparent;
	border: 1px solid var(--line-divider);
	color: var(--fg-50);
	padding: 0 calc(0.42rem - 1px);
}

.badge[data-status="rejected"] {
	background: color-mix(in oklab, var(--admonitions-color-caution) 16%, transparent);
	color: var(--admonitions-color-caution);
}

.badge.repost {
	background: color-mix(in oklab, var(--admonitions-color-note) 16%, transparent);
	color: var(--admonitions-color-note);
}

.row-actions {
	display: flex;
	align-items: center;
	gap: 0.28rem;
	opacity: 0.62;
	transition: opacity 0.15s ease;
}

.post-item:hover .row-actions,
.post-item:focus-within .row-actions {
	opacity: 1;
}

.row-actions .btn-regular {
	padding: 0.28rem 0.6rem;
	font-size: 0.74rem;
}

.row-actions .btn-ghost {
	padding: 0.28rem 0.45rem;
}

/* 卡片里日期横排，和状态徽章同在底行 */
.post-list[data-view="masonry"] .col-date,
.post-list[data-view="grid"] .col-date {
	flex-direction: row;
	align-items: baseline;
	gap: 0.28rem;
}

@media (max-width: 720px) {
	.post-list[data-view="list"] .post-item {
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas:
			"date"
			"main"
			"side";
		gap: 0.35rem;
		padding: 0.85rem 1rem;
	}

	.post-list[data-view="list"] .col-date {
		flex-direction: row;
		align-items: baseline;
		gap: 0.3rem;
	}

	.post-list[data-view="list"] .col-side {
		justify-content: flex-end;
	}
}
</style>
