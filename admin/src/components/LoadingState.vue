<script setup lang="ts">
/**
 * 统一的加载占位。
 *
 * 原来每个页面都只写一行灰字「读取中…」：切过去先看到一块空白，
 * 数据到了内容才忽然长出来，页面往下跳一截，也分不清是在加载还是本来就空。
 * 这里用骨架屏——按内容的形状先把位置占好，数据到了原地替换，布局不跳。
 *
 * variant 对应三种页面形状：
 * - list  列表（文章、评论、审计）：缩略块 + 两行文字 + 右侧小胶囊
 * - table 表格（用户管理）：一行表头 + 若干行等宽单元格
 * - grid  网格（媒体库）：与缩略图同宽的方块阵
 * - form  表单（站点设置）：左侧标签 + 右侧输入框，一行一组
 * - doc   编辑器 / 正文（写作页、审核详情）：标题 + 工具条 + 一个大内容框
 * - block 纯段落（其它整块内容）：标题 + 若干段落行
 */
interface Props {
	variant?: "list" | "table" | "grid" | "form" | "doc" | "block";
	/** 占位行数（grid 为方块个数），按真实内容的常见条数给 */
	rows?: number;
	label?: string;
}

withDefaults(defineProps<Props>(), {
	variant: "list",
	rows: 4,
	label: "读取中",
});

/** 行宽写死成一组固定值：每次渲染随机的话，骨架自己会抖 */
const LIST_WIDTHS: number[] = [62, 48, 70, 55, 44, 66];
const BLOCK_WIDTHS: number[] = [100, 94, 88, 100, 72];
/** 表格各列权重：名称列最宽，状态两列最窄 */
const TABLE_COLUMNS: number[] = [2.2, 3.2, 1.1, 1.1, 1.4];

function listWidth(index: number): string {
	return `${LIST_WIDTHS[index % LIST_WIDTHS.length]}%`;
}

function blockWidth(index: number): string {
	return `${BLOCK_WIDTHS[index % BLOCK_WIDTHS.length]}%`;
}
</script>

<template>
	<div class="sk" :class="`sk--${variant}`" role="status" :aria-label="label">
		<div class="sk-head">
			<span class="sk-dots" aria-hidden="true">
				<i />
				<i />
				<i />
			</span>
			<span class="sk-word">{{ label }}</span>
		</div>

		<div v-if="variant === 'list'" class="sk-rows" aria-hidden="true">
			<div v-for="n in rows" :key="n" class="sk-item">
				<span class="sk-thumb" />
				<span class="sk-lines">
					<span class="sk-bar" :style="{ width: listWidth(n - 1) }" />
					<span class="sk-bar dim" :style="{ width: listWidth(n + 2) }" />
				</span>
				<span class="sk-chip" />
			</div>
		</div>

		<div v-else-if="variant === 'table'" class="sk-table" aria-hidden="true">
			<div class="sk-tr head">
				<span
					v-for="(weight, i) in TABLE_COLUMNS"
					:key="i"
					class="sk-bar dim"
					:style="{ flex: weight }"
				/>
			</div>
			<div v-for="n in rows" :key="n" class="sk-tr">
				<span class="sk-cell">
					<span class="sk-bar" :style="{ width: listWidth(n) }" />
				</span>
				<span class="sk-bar" style="flex: 3.2" />
				<span class="sk-bar dim" style="flex: 1.1" />
				<span class="sk-bar dim" style="flex: 1.1" />
				<span class="sk-bar dim" style="flex: 1.4" />
			</div>
		</div>

		<div v-else-if="variant === 'grid'" class="sk-grid" aria-hidden="true">
			<span v-for="n in rows" :key="n" class="sk-tile">
				<i class="sk-fill" />
				<i class="sk-line" />
			</span>
		</div>

		<div v-else-if="variant === 'form'" class="sk-form" aria-hidden="true">
			<span class="sk-bar title" />
			<div v-for="n in rows" :key="n" class="sk-frow">
				<span class="sk-bar dim label" />
				<span class="sk-input" />
			</div>
		</div>

		<div v-else-if="variant === 'doc'" class="sk-doc" aria-hidden="true">
			<span class="sk-bar title" />
			<div class="sk-toolbar">
				<i v-for="n in 8" :key="n" class="sk-tool" />
			</div>
			<div class="sk-pane">
				<span
					v-for="n in rows"
					:key="n"
					class="sk-bar"
					:style="{ width: blockWidth(n - 1) }"
				/>
			</div>
		</div>

		<div v-else class="sk-block" aria-hidden="true">
			<span class="sk-bar title" />
			<span
				v-for="n in rows"
				:key="n"
				class="sk-bar"
				:style="{ width: blockWidth(n - 1) }"
			/>
		</div>
	</div>
</template>

<style scoped>
.sk {
	/* 慢一点再露出来：接口快的时候根本看不见它，不会闪一下又消失 */
	animation: sk-in 0.24s ease 0.12s both;
}

.sk-head {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	margin-bottom: 0.85rem;
	min-height: 1rem;
}

.sk-dots {
	display: inline-flex;
	gap: 0.2rem;
}

.sk-dots i {
	width: 0.3rem;
	height: 0.3rem;
	border-radius: 999px;
	background: var(--primary);
	animation: sk-pulse 1.1s ease-in-out infinite;
}

.sk-dots i:nth-child(2) {
	animation-delay: 0.16s;
}

.sk-dots i:nth-child(3) {
	animation-delay: 0.32s;
}

.sk-word {
	font-size: 0.72rem;
	letter-spacing: 0.02em;
	color: var(--fg-50);
}

/* ---- 骨架块 ---- */
.sk-bar,
.sk-thumb,
.sk-chip {
	position: relative;
	display: block;
	background: var(--skeleton-bg);
	overflow: hidden;
}

.sk-bar {
	height: 0.62rem;
	border-radius: 999px;
}

.sk-bar.dim {
	height: 0.5rem;
	opacity: 0.75;
}

.sk-bar.title {
	width: 38%;
	height: 1rem;
	margin-bottom: 0.3rem;
}

/* 扫光：浅色下是一道白，深色下是更亮一档的白，靠明度差滚过去。
   所有骨架件共用同一道，速度一致才不像几个动画各跑各的 */
.sk-bar::after,
.sk-thumb::after,
.sk-chip::after {
	content: "";
	position: absolute;
	inset: 0;
	transform: translateX(-100%);
	background: linear-gradient(
		90deg,
		transparent,
		var(--skeleton-sheen),
		transparent
	);
	animation: sk-sweep 1.5s cubic-bezier(0.45, 0, 0.25, 1) infinite;
}

/* ---- list ---- */
.sk-rows {
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
}

.sk-item {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	padding: 0.85rem 0.95rem;
	border: 1px solid var(--line-divider);
	border-radius: 0.9rem;
}

.sk-thumb {
	flex: none;
	width: 2.4rem;
	height: 2.4rem;
	border-radius: 0.7rem;
}

.sk-lines {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
	min-width: 0;
}

.sk-chip {
	flex: none;
	width: 3.2rem;
	height: 0.62rem;
	border-radius: 999px;
	opacity: 0.75;
}

/* ---- table ---- */
.sk-table {
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	overflow: hidden;
}

.sk-tr {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.8rem 0.95rem;
	border-bottom: 1px solid var(--line-divider);
}

.sk-tr:last-child {
	border-bottom: none;
}

.sk-tr.head {
	padding: 0.62rem 0.95rem;
	background: var(--btn-regular-bg);
}

.sk-tr.head .sk-bar {
	height: 0.45rem;
}

.sk-cell {
	flex: 2.2;
	display: flex;
	align-items: center;
	gap: 0.6rem;
	min-width: 0;
}

.sk-cell::before {
	content: "";
	flex: none;
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 999px;
	background: var(--skeleton-bg);
}

/* ---- grid ---- */
/* 形状照 MediaGrid 的真实卡片来：1px 描边 + 0.45rem 内边距 + 方形缩略 + 一行文件名 */
.sk-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
	gap: 0.7rem;
}

.sk-tile {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	padding: 0.45rem;
	border: 1px solid var(--line-divider);
	border-radius: 0.6rem;
}

.sk-tile .sk-fill {
	position: relative;
	display: block;
	aspect-ratio: 1;
	border-radius: 0.4rem;
	background: var(--skeleton-bg);
	overflow: hidden;
}

.sk-tile .sk-line {
	display: block;
	width: 62%;
	height: 0.5rem;
	margin-top: 0.1rem;
	border-radius: 999px;
	background: var(--skeleton-bg);
}

.sk-tile .sk-fill::after {
	content: "";
	position: absolute;
	inset: 0;
	transform: translateX(-100%);
	background: linear-gradient(
		90deg,
		transparent,
		var(--skeleton-sheen),
		transparent
	);
	animation: sk-sweep 1.5s cubic-bezier(0.45, 0, 0.25, 1) infinite;
}

/* ---- form ---- */
/* 站点设置的每一项都在白卡片里，骨架也要有那张卡，否则加载完会突然多出一圈描边 */
.sk-form {
	padding: 1.1rem 1.25rem;
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	max-width: 46rem;
}

.sk-form .sk-bar.title {
	margin-bottom: 1.1rem;
}

.sk-frow {
	display: flex;
	align-items: center;
	gap: 1.2rem;
	padding: 0.55rem 0;
}

.sk-frow + .sk-frow {
	border-top: 1px solid var(--line-divider);
}

.sk-frow .label {
	flex: none;
	width: 6.5rem;
}

.sk-input {
	flex: 1;
	height: 2.35rem;
	border-radius: 0.75rem;
	border: 1px solid var(--line-divider);
	max-width: 30rem;
}

/* ---- doc ---- */
.sk-doc .sk-bar.title {
	width: 46%;
	height: 1.15rem;
	margin-bottom: 0.9rem;
}

.sk-toolbar {
	display: flex;
	gap: 0.45rem;
	margin-bottom: 0.9rem;
}

.sk-tool {
	width: 1.7rem;
	height: 1.7rem;
	border-radius: 0.45rem;
	background: var(--skeleton-bg);
}

.sk-pane {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	min-height: 17rem;
	padding: 1.2rem;
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
}

/* ---- block ---- */
.sk-block {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
}

.sk-block .sk-bar.title + .sk-bar {
	margin-top: 0.35rem;
}

@keyframes sk-sweep {
	to {
		transform: translateX(100%);
	}
}

@keyframes sk-pulse {
	0%,
	100% {
		opacity: 0.25;
		transform: scale(0.8);
	}
	40% {
		opacity: 1;
		transform: scale(1);
	}
}

@keyframes sk-in {
	from {
		opacity: 0;
	}
	to {
		opacity: 1;
	}
}

@media (prefers-reduced-motion: reduce) {
	.sk {
		animation: none;
	}

	.sk-bar::after,
	.sk-dots i {
		animation: none;
	}

	.sk-dots i {
		opacity: 0.6;
	}

	.sk-bar::after {
		display: none;
	}
}
</style>
