/**
 * 文章列表：我的文章 / 全站文章共用。
 *
 * 视觉约定：整份列表是一个 card-base 容器，行与行之间只有 1px 分隔线，
 * 不再一篇一张圆角卡——那样一屏七八个圆角块，边界比内容还抢眼。
 * 行内按「日期柱 → 标题 → 摘要 → 标签」分级，操作按钮靠右、hover 才提亮。
 */
<script setup lang="ts">
import { computed } from "vue";
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
		/** 显示草稿/待审这类状态；全站文章都是已发布，没必要每行挂一个「已发布」 */
		showStatus?: boolean;
		/** 日期取哪个字段：草稿看改动时间，已发布看发布时间 */
		dateField?: "updated_at" | "published_at";
		/** 标签最多显示几个，多出来的折成 +N */
		maxTags?: number;
	}>(),
	{ showStatus: false, dateField: "updated_at", maxTags: 4 },
);

const emit = defineEmits<{ open: [post: PostSummary] }>();

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
	<ul class="post-list card-base">
		<li
			v-for="row in rows"
			:key="row.post.origin === 'repo' ? `repo-${row.post.slug}` : `db-${row.post.id}`"
			class="post-row"
			@click="emit('open', row.post)"
		>
			<div class="col-date">
				<span class="date-day">{{ row.day }}</span>
				<span class="date-year">{{ row.year }}</span>
			</div>

			<div class="col-main">
				<h2 class="post-title">{{ row.post.title }}</h2>
				<p v-if="row.post.summary" class="post-summary">{{ row.post.summary }}</p>
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
						<button type="button" class="btn-regular" @click="emit('open', row.post)">
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
</template>

<style scoped>
.post-list {
	margin: 0;
	padding: 0;
	list-style: none;
	overflow: hidden;
}

.post-row {
	position: relative;
	display: flex;
	align-items: flex-start;
	gap: 1rem;
	padding: 0.95rem 1.15rem;
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.post-row + .post-row {
	border-top: 1px solid var(--line-divider);
}

.post-row:hover,
.post-row:focus-within {
	background: var(--btn-plain-bg-hover);
}

/* 日期做成左侧锚点：扫一列日期就能定位，比塞进 meta 串里好读 */
.col-date {
	flex: none;
	width: 2.9rem;
	padding-top: 0.12rem;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	line-height: 1.25;
}

.date-day {
	font-size: 0.82rem;
	font-weight: 600;
	color: var(--fg-75);
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.01em;
}

.date-year {
	font-size: 0.66rem;
	color: var(--fg-50);
	font-variant-numeric: tabular-nums;
}

.col-main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.28rem;
}

.post-title {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 600;
	line-height: 1.45;
	color: var(--fg-90);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.post-row:hover .post-title {
	color: var(--accent-text);
}

.post-summary {
	margin: 0;
	font-size: 0.8rem;
	line-height: 1.6;
	color: var(--content-meta);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.post-note {
	margin: 0;
	font-size: 0.75rem;
	line-height: 1.6;
	color: var(--admonitions-color-caution);
}

.tag-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.32rem;
	margin-top: 0.1rem;
}

.tag {
	font-size: 0.68rem;
	line-height: 1.5;
	padding: 0 0.42rem;
	border-radius: 999px;
	border: 1px solid var(--line-color);
	color: var(--fg-50);
	white-space: nowrap;
}

.tag-more {
	font-size: 0.66rem;
	color: var(--fg-30);
}

.col-side {
	flex: none;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding-top: 0.05rem;
}

.badge {
	white-space: nowrap;
	font-size: 0.68rem;
	font-weight: 600;
	line-height: 1.6;
	padding: 0 0.45rem;
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
	padding: 0 calc(0.45rem - 1px);
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
	gap: 0.3rem;
	opacity: 0.62;
	transition: opacity 0.15s ease;
}

.post-row:hover .row-actions,
.post-row:focus-within .row-actions {
	opacity: 1;
}

.row-actions .btn-regular {
	padding: 0.32rem 0.68rem;
	font-size: 0.78rem;
}

.row-actions .btn-ghost {
	padding: 0.32rem 0.5rem;
}

@media (max-width: 720px) {
	.post-row {
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
	}

	.col-date {
		width: auto;
		flex-direction: row;
		align-items: baseline;
		gap: 0.3rem;
	}

	/* 不用 calc(100% - …)：侧栏吃掉宽度后百分比算出来的基宽会超过一行，
	   标题被挤到单独一行。给个最小基宽，剩多少由 main 自己占 */
	.col-main {
		flex: 1 1 12rem;
	}

	.col-side {
		width: 100%;
		justify-content: flex-end;
	}
}
</style>
