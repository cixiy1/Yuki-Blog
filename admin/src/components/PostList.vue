<script setup lang="ts">
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
 *
 * 封面与阅读量：封面用构建期解析好的地址（见 src/pages/api/post-index.json.ts），
 * 阅读量来自外部计数服务、异步补上——拿不到就不显示，不影响列表本身。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { loadPostViews } from "../lib/post-views";
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
		/** 拿阅读量。阅读量接口要 reviewer 权限，普通作者的列表别去撞 403 */
		showMetrics?: boolean;
		/** 日期取哪个字段：草稿看改动时间，已发布看发布时间 */
		dateField?: "updated_at" | "published_at";
		/** 标签最多显示几个，多出来的折成 +N */
		maxTags?: number;
		/** 工具条左侧计数，如「23 篇」；留空不渲染 */
		countText?: string;
		/** 工具条里的排序说明，如「按发布时间倒序」 */
		sortText?: string;
	}>(),
	{
		showStatus: false,
		showMetrics: true,
		dateField: "updated_at",
		maxTags: 4,
	},
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

/* ---------------- 阅读量 ---------------- */

const views = ref<Record<string, number>>({});
let viewsAbort: AbortController | null = null;

const slugKey = computed(() => props.items.map((post) => post.slug).join(","));

watch(
	slugKey,
	() => {
		viewsAbort?.abort();
		if (!props.showMetrics) {
			views.value = {};
			return;
		}
		const controller = new AbortController();
		viewsAbort = controller;
		void loadPostViews(
			props.items.map((post) => post.slug),
			controller.signal,
		).then((data) => {
			// 列表换了（或组件已卸载）就别再覆盖，否则数字会串到别的文章上
			if (!controller.signal.aborted) views.value = data;
		});
	},
	{ immediate: true },
);

onBeforeUnmount(() => viewsAbort?.abort());

function formatCount(value: number | undefined): string {
	if (!value || !Number.isFinite(value) || value <= 0) return "";
	if (value < 1000) return String(value);
	if (value < 10000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
	return `${(value / 10000).toFixed(1).replace(/\.0$/, "")}万`;
}

/* ---------------- 封面 ---------------- */

/** 加载失败的封面记一笔，回落到占位块，别留个破图图标在那儿 */
const brokenCovers = reactive(new Set<string>());

function coverOf(post: PostSummary): string {
	if (brokenCovers.has(post.slug)) return "";
	return (post.cover ?? "").trim();
}

/**
 * 没有封面的文章占多数（22 篇里只有 1 篇写了 image）。统一灰块会让列表变闷，
 * 一整块淡底加居中一个字又像加载失败——这里按 slug 取色相做「海报」：
 * 斜纹肌理 + 压在右下角被裁掉一角的首字，铺满整块，不当内容看。
 *
 * 色相不铺满 0-360，只取主题色 ±52° 的九档：整列是同一个调子，差异只够分卡片。
 */
function coverHue(slug: string): string {
	let hash = 0;
	for (let i = 0; i < slug.length; i += 1) {
		hash = (hash * 31 + slug.charCodeAt(i)) % 360;
	}
	const shift = ((hash % 9) - 4) * 13;
	return `calc(var(--hue, 180) + ${shift})`;
}

function initialOf(title: string): string {
	const text = (title ?? "").trim();
	return text ? text.slice(0, 1).toUpperCase() : "·";
}

/* ---------------- 行数据 ---------------- */

interface Row {
	post: PostSummary;
	day: string;
	year: string;
	tags: string[];
	more: number;
	editLabel: string;
	views: string;
	comments: string;
}

/* 网格卡片窄，四个标签排不下会把 +N 挤到单独一行，少放一个 */
const tagLimit = computed(() =>
	view.value === "grid" ? Math.max(1, props.maxTags - 1) : props.maxTags,
);

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
			tags: all.slice(0, tagLimit.value),
			more: Math.max(0, all.length - tagLimit.value),
			editLabel:
				post.origin === "repo"
					? "编辑"
					: isEditable(post.status)
						? "编辑"
						: "查看",
			views: props.showMetrics ? formatCount(views.value[post.slug]) : "",
			comments: formatCount(post.comments),
		};
	}),
);
</script>

<template>
	<div class="post-block">
		<div class="list-bar">
			<span v-if="countText" class="bar-count">{{ countText }}</span>
			<span
				v-if="countText && sortText"
				class="bar-divider"
				aria-hidden="true"
			></span>
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
					<AppIcon :name="option.icon" :size="15" />
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
				<div
					class="col-cover"
					:class="{ placeholder: !coverOf(row.post) }"
					:style="`--cover-hue: ${coverHue(row.post.slug)}`"
				>
					<img
						v-if="coverOf(row.post)"
						:src="coverOf(row.post)"
						:alt="row.post.title"
						loading="lazy"
						@error="brokenCovers.add(row.post.slug)"
					/>
					<span v-else class="cover-mark" aria-hidden="true">{{
						initialOf(row.post.title)
					}}</span>
				</div>

				<div class="col-main">
					<h2 class="post-title" :title="row.post.title">
						{{ row.post.title }}
					</h2>
					<p v-if="row.post.summary" class="post-summary">
						{{ row.post.summary }}
					</p>
					<p
						v-if="row.post.status === 'rejected' && row.post.review_note"
						class="post-note"
					>
						退回理由：{{ row.post.review_note }}
					</p>
					<div class="tag-row">
						<span v-for="tag in row.tags" :key="tag" class="tag">#{{ tag }}</span>
						<span v-if="row.more" class="tag-more">+{{ row.more }}</span>
					</div>
				</div>

				<div class="col-date">
					<span class="date-day">{{ row.day }}</span>
					<span class="date-year">{{ row.year }}</span>
					<template v-if="row.views || row.comments">
						<span class="date-dot" aria-hidden="true">/</span>
						<span v-if="row.views" class="metric" :title="`${row.views} 次阅读`">
							<AppIcon name="eye" :size="12" />
							{{ row.views }}
						</span>
						<span
							v-if="row.comments"
							class="metric"
							:title="`${row.comments} 条评论`"
						>
							<AppIcon name="comment" :size="12" />
							{{ row.comments }}
						</span>
					</template>
				</div>

				<div class="col-side">
					<!-- 列表视图里日期柱放不下指标，挪到按钮左侧，跟操作同一组 -->
					<span v-if="row.views || row.comments" class="metric-row">
						<span v-if="row.views" class="metric" :title="`${row.views} 次阅读`">
							<AppIcon name="eye" :size="12" />
							{{ row.views }}
						</span>
						<span
							v-if="row.comments"
							class="metric"
							:title="`${row.comments} 条评论`"
						>
							<AppIcon name="comment" :size="12" />
							{{ row.comments }}
						</span>
					</span>

					<div v-if="showStatus || row.post.source_link" class="badges">
						<span v-if="showStatus" class="badge" :data-status="row.post.status">
							{{ STATUS_LABEL[row.post.status] ?? row.post.status }}
						</span>
						<span v-if="row.post.source_link" class="badge repost">转载</span>
					</div>

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
/* ---------- 工具条：左边计数，右边视图切换 ---------- */

/* 列表长起来以后工具条跟着滚出视野，视图切换就够不着了。贴顶、白底、加一条细线 */
.list-bar {
	position: sticky;
	top: 0;
	z-index: 3;
	display: flex;
	align-items: center;
	gap: 0.55rem;
	margin: 0 0 0.5rem;
	padding: 0.5rem 0;
	min-height: 2.1rem;
	/* 必须不透明：半透明 + 毛玻璃下卡片文字会透上来，看起来像糊了一层 */
	background: var(--page-bg);
	border-bottom: 1px solid var(--line-divider);
}

.bar-count {
	font-size: 0.8rem;
	font-weight: 650;
	color: var(--fg-90);
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.01em;
}

.bar-divider {
	width: 1px;
	height: 0.7rem;
	background: var(--line-divider);
}

.bar-note {
	font-size: 0.72rem;
	color: var(--fg-50);
}

/* 凹槽 + 白底浮起：比三个并排的图标按钮更像一个控件 */
.view-switch {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: 1px;
	padding: 0.15rem;
	border-radius: 9px;
	background: var(--btn-regular-bg);
}

.view-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.55rem;
	padding: 0;
	border: none;
	border-radius: 7px;
	background: transparent;
	color: var(--fg-50);
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease,
		box-shadow 0.15s ease;
}

.view-btn:hover {
	color: var(--fg-90);
}

.view-btn.on {
	background: var(--card-bg);
	color: var(--accent-text);
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
}

.post-list {
	margin: 0;
	padding: 0;
	list-style: none;
}

/* ---------- 封面 ---------- */

.col-cover {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
	background: var(--btn-regular-bg);
}

.col-cover img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
	transition: transform 0.45s cubic-bezier(0.2, 0, 0, 1);
}

.post-item:hover .col-cover img {
	transform: scale(1.035);
}

/* 无封面：淡色渐变 + 斜纹 + 右下角切掉一角的首字，读起来像一张海报而不是空块。
   色相跨度收在主题色附近 ±30°，色度压得很低——22 张卡各走一个色相会变成糖果盘，
   收窄之后整列读起来是同一个调子，差异只够分辨 */
.col-cover.placeholder {
	background:
		radial-gradient(
			110% 120% at 14% -10%,
			oklch(0.987 0.014 var(--cover-hue, 200)) 0%,
			transparent 58%
		),
		linear-gradient(
			148deg,
			oklch(0.966 0.024 var(--cover-hue, 200)) 0%,
			oklch(0.936 0.04 var(--cover-hue, 200)) 100%
		);
}

.col-cover.placeholder::before {
	content: "";
	position: absolute;
	inset: 0;
	background: repeating-linear-gradient(
		118deg,
		oklch(0.6 0.11 var(--cover-hue, 200)) 0 1px,
		transparent 1px 8px
	);
	opacity: 0.07;
	pointer-events: none;
}

/* 深色下彩色底会发脏（暗红、暗棕），底色走中性，色相只留在首字上 */
:root.dark .col-cover.placeholder {
	background:
		radial-gradient(
			110% 120% at 14% -10%,
			rgba(255, 255, 255, 0.07) 0%,
			transparent 60%
		),
		linear-gradient(148deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018));
}

:root.dark .col-cover.placeholder::before {
	background-image: repeating-linear-gradient(
		118deg,
		rgba(255, 255, 255, 0.7) 0 1px,
		transparent 1px 8px
	);
	opacity: 0.05;
}

.cover-mark {
	position: absolute;
	right: 0.55rem;
	bottom: -0.5rem;
	font-size: 3rem;
	font-weight: 800;
	line-height: 1;
	letter-spacing: -0.06em;
	color: oklch(0.54 0.13 var(--cover-hue, 200));
	opacity: 0.24;
	user-select: none;
}

:root.dark .cover-mark {
	color: oklch(0.82 0.09 var(--cover-hue, 200));
	opacity: 0.26;
}

/* ---------- 列表视图：整份一个容器，行间只留分隔线 ---------- */

.post-list[data-view="list"] {
	overflow: hidden;
}

.post-list[data-view="list"] .post-item {
	position: relative;
	display: grid;
	grid-template-columns: 3.1rem 2.9rem minmax(0, 1fr) auto;
	grid-template-areas: "cover date main side";
	gap: 0.9rem;
	padding: 0.85rem 1.15rem;
	cursor: pointer;
	transition: background-color 0.15s ease;
}

/* 悬停时左边缘亮一道强调色，扫读时知道光标停在哪一行 */
.post-list[data-view="list"] .post-item::before {
	content: "";
	position: absolute;
	left: 0;
	top: 0.5rem;
	bottom: 0.5rem;
	width: 2px;
	border-radius: 0 2px 2px 0;
	background: var(--primary);
	opacity: 0;
	transition: opacity 0.15s ease;
}

.post-list[data-view="list"] .post-item:hover::before,
.post-list[data-view="list"] .post-item:focus-within::before {
	opacity: 1;
}

.post-list[data-view="list"] .post-item + .post-item {
	border-top: 1px solid var(--line-divider);
}

.post-list[data-view="list"] .post-item:hover,
.post-list[data-view="list"] .post-item:focus-within {
	background: var(--btn-plain-bg-hover);
}

.post-list[data-view="list"] .col-cover {
	grid-area: cover;
	aspect-ratio: 1 / 1;
	border-radius: 7px;
	align-self: center;
}

.post-list[data-view="list"] .cover-mark {
	right: 0.18rem;
	bottom: -0.16rem;
	font-size: 1.5rem;
}

.post-list[data-view="list"] .col-date {
	flex-direction: column;
	justify-content: center;
	align-self: center;
}

/* ---------- 瀑布 / 网格：每篇一张独立卡片 ---------- */

.post-list[data-view="masonry"] {
	columns: 3 20rem;
	column-gap: 0.75rem;
}

.post-list[data-view="masonry"] .post-item {
	break-inside: avoid;
	margin: 0 0 0.75rem;
}

.post-list[data-view="grid"] {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr));
	gap: 0.75rem;
}

.post-list[data-view="masonry"] .post-item,
.post-list[data-view="grid"] .post-item {
	position: relative;
	display: grid;
	/* main 行撑满，日期与操作贴底——同排卡片底边就能对齐 */
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas:
		"cover cover"
		"main main"
		"date side";
	grid-template-rows: auto 1fr auto;
	gap: 0.55rem 0.6rem;
	padding: 0.9rem 1rem;
	border: 1px solid var(--line-divider);
	border-radius: 12px;
	background: var(--card-bg);
	cursor: pointer;
	transition:
		transform 0.18s ease,
		border-color 0.18s ease,
		box-shadow 0.18s ease;
}

/* 卡片封面贴到上、左、右三边，用负 margin 抵消内边距。
   比例 2.4:1——管理端看的是文章，封面是辅助，16:9 一屏就只剩两行卡片 */
.post-list[data-view="masonry"] .col-cover,
.post-list[data-view="grid"] .col-cover {
	grid-area: cover;
	margin: -0.9rem -1rem 0.15rem;
	aspect-ratio: 2.4 / 1;
	border-radius: 11px 11px 0 0;
}

.post-list[data-view="masonry"] .post-item:hover,
.post-list[data-view="grid"] .post-item:hover,
.post-list[data-view="masonry"] .post-item:focus-within,
.post-list[data-view="grid"] .post-item:focus-within {
	transform: translateY(-2px);
	border-color: color-mix(in oklab, var(--primary) 34%, var(--line-divider));
	box-shadow: 0 10px 22px -16px rgba(0, 0, 0, 0.5);
}

/* ---------- 三块内容 ---------- */

.col-date {
	grid-area: date;
	display: flex;
	flex-direction: row;
	align-items: baseline;
	gap: 0.3rem;
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

.date-dot {
	font-size: 0.66rem;
	color: var(--fg-30);
}

.metric {
	display: inline-flex;
	align-items: center;
	gap: 0.16rem;
	font-size: 0.66rem;
	color: var(--fg-50);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

/*
 * 指标在两处渲染：卡片视图跟日期同一行，列表视图放按钮左侧。用 CSS 二选一显示，
 * 别在模板里写两套 v-if 分支。
 */
.metric-row {
	display: none;
	align-items: center;
	gap: 0.5rem;
}

.post-list[data-view="list"] .metric-row {
	display: inline-flex;
	margin-right: 0.35rem;
	padding-right: 0.6rem;
	border-right: 1px solid var(--line-divider);
}

.post-list[data-view="list"] .col-date .date-dot,
.post-list[data-view="list"] .col-date .metric {
	display: none;
}

.col-main {
	grid-area: main;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.34rem;
}

.post-title {
	margin: 0;
	font-size: 0.98rem;
	font-weight: 700;
	line-height: 1.45;
	color: var(--fg-90);
	letter-spacing: -0.012em;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	transition: color 0.15s ease;
}

.post-item:hover .post-title {
	color: var(--accent-text);
}

.post-summary {
	margin: 0;
	font-size: 0.78rem;
	line-height: 1.7;
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
	margin-top: 0.1rem;
	min-height: 1.1rem;
}

.tag {
	font-size: 0.65rem;
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
	gap: 0.45rem;
}

/* ---------- 状态徽章：卡片视图里浮在封面左上角 ---------- */

.badges {
	display: flex;
	align-items: center;
	gap: 0.28rem;
}

.post-list[data-view="masonry"] .badges,
.post-list[data-view="grid"] .badges {
	position: absolute;
	top: 0.55rem;
	left: 0.55rem;
	z-index: 2;
}

.badge {
	white-space: nowrap;
	font-size: 0.65rem;
	font-weight: 600;
	line-height: 1.6;
	padding: 0 0.42rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
}

.badge[data-status="pending"] {
	background: color-mix(
		in oklab,
		var(--admonitions-color-warning) 20%,
		var(--card-bg)
	);
	color: var(--admonitions-color-warning);
}

/* 已发布是常态，不上色——一屏全是绿徽章，真正要处理的待审/退回反而看不出 */
.badge[data-status="published"] {
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	color: var(--fg-50);
	padding: 0 calc(0.42rem - 1px);
}

.badge[data-status="rejected"] {
	background: color-mix(
		in oklab,
		var(--admonitions-color-caution) 18%,
		var(--card-bg)
	);
	color: var(--admonitions-color-caution);
}

.badge.repost {
	background: color-mix(
		in oklab,
		var(--admonitions-color-note) 18%,
		var(--card-bg)
	);
	color: var(--admonitions-color-note);
}

/* 浮在封面上时给一道投影，压在浅色海报上也分得清边界 */
.post-list[data-view="masonry"] .badge,
.post-list[data-view="grid"] .badge {
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
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
	padding: 0.28rem 0.62rem;
	font-size: 0.74rem;
}

.row-actions .btn-ghost {
	padding: 0.28rem 0.45rem;
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

	/* 窄屏列表视图一行放不下封面，卡片视图里本来就有，这里直接省掉 */
	.post-list[data-view="list"] .col-cover {
		display: none;
	}

	.post-list[data-view="list"] .col-side {
		justify-content: flex-end;
	}
}
</style>
