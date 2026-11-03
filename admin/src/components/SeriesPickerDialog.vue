<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { SeriesItem } from "../lib/posts";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
	/** 当前文章的系列名，空串表示还没归到系列里 */
	current: string;
	/** 当前系列序号（字符串，来自表单） */
	order: string;
	series: SeriesItem[];
	/** 本篇的 slug：算「空位」时要把自己排除，否则改自己的序号会撞自己 */
	selfSlug: string;
	loading?: boolean;
}>();

const emit = defineEmits<{ close: []; apply: [name: string, order: string] }>();

const query = ref("");
const picked = ref(props.current.trim());
const orderText = ref(props.order);
const newName = ref("");
const searchEl = ref<HTMLInputElement | null>(null);

const filtered = computed(() => {
	const keyword = query.value.trim().toLowerCase();
	if (!keyword) return props.series;
	return props.series.filter(
		(item) =>
			item.name.toLowerCase().includes(keyword) ||
			item.posts.some((post) => post.title.toLowerCase().includes(keyword)),
	);
});

const pickedItem = computed(
	() => props.series.find((item) => item.name === picked.value) ?? null,
);

/** 某个系列里已被占用的序号，本篇自己不算 */
function takenOf(name: string): number[] {
	const item = props.series.find((entry) => entry.name === name);
	if (!item) return [];
	const set = new Set<number>();
	for (const post of item.posts) {
		if (post.slug === props.selfSlug) continue;
		if (typeof post.order === "number") set.add(post.order);
	}
	return [...set].sort((a, b) => a - b);
}

/** 下一个空位：从 1 往上找第一个没被占的 */
function nextFreeOf(name: string): number {
	const taken = new Set(takenOf(name));
	let n = 1;
	while (taken.has(n)) n += 1;
	return n;
}

const taken = computed(() => takenOf(picked.value));
const suggested = computed(() => nextFreeOf(picked.value));

/** 手填的序号撞上同系列另一篇时给出名字，别让人写出两个「第 3 篇」 */
const conflict = computed(() => {
	const n = Number(orderText.value);
	if (!Number.isFinite(n) || n <= 0) return "";
	const item = pickedItem.value;
	if (!item) return "";
	const hit = item.posts.find(
		(post) => post.slug !== props.selfSlug && post.order === n,
	);
	return hit ? hit.title : "";
});

function ordersText(item: SeriesItem): string {
	const list = item.posts
		.map((post) => post.order)
		.filter((order): order is number => typeof order === "number");
	if (list.length === 0) return "未排序号";
	return `序号 ${list.slice(0, 6).join("、")}${list.length > 6 ? "…" : ""}`;
}

function pick(name: string): void {
	if (name === picked.value) return;
	picked.value = name;
	orderText.value = String(nextFreeOf(name));
}

function pickNew(): void {
	const name = newName.value.trim();
	if (!name) return;
	newName.value = "";
	pick(name);
}

function clearSeries(): void {
	emit("apply", "", "");
}

function apply(): void {
	const name = picked.value.trim();
	if (!name) {
		clearSeries();
		return;
	}
	emit("apply", name, orderText.value.trim());
}

function onEscape(event: KeyboardEvent): void {
	if (event.key === "Escape") emit("close");
}

onMounted(() => {
	void nextTick(() => searchEl.value?.focus());
	window.addEventListener("keydown", onEscape);
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onEscape);
});
</script>

<template>
	<div class="sp-mask" @click.self="emit('close')">
		<div class="sp-dialog" role="dialog" aria-modal="true" aria-label="选择系列">
			<header class="sp-head">
				<div>
					<p class="sp-title">选择系列</p>
					<p class="sp-tip">
						分组按名字精确匹配，从列表里点比手打稳。
					</p>
				</div>
				<button type="button" class="sp-x" title="关闭" @click="emit('close')">
					✕
				</button>
			</header>

			<div class="sp-body">
				<div class="sp-left">
					<input
						ref="searchEl"
						v-model="query"
						class="field sp-search"
						placeholder="搜索系列或文章标题"
					/>

					<div class="sp-list">
						<p v-if="loading" class="sp-empty">读取系列…</p>
						<template v-else>
							<button
								type="button"
								class="sp-row sp-row-none"
								:class="{ on: picked === '' }"
								@click="pick('')"
							>
								<span class="sp-name">不属于任何系列</span>
							</button>
							<button
								v-for="item in filtered"
								:key="item.name"
								type="button"
								class="sp-row"
								:class="{ on: picked === item.name }"
								@click="pick(item.name)"
							>
								<span class="sp-name">{{ item.name }}</span>
								<span class="sp-meta">
									{{ item.posts.length }} 篇 · {{ ordersText(item) }}
								</span>
							</button>
							<p v-if="!filtered.length" class="sp-empty">
								没有匹配的系列，下面直接新建一个。
							</p>
						</template>
					</div>

					<div class="sp-new">
						<input
							v-model="newName"
							class="field"
							placeholder="新建系列名"
							@keydown.enter.prevent="pickNew"
						/>
						<button
							type="button"
							class="sp-new-btn"
							:disabled="!newName.trim()"
							@click="pickNew"
						>
							<AppIcon name="plus" :size="13" />
							新建
						</button>
					</div>
				</div>

				<div class="sp-right">
					<p class="sp-detail-title">{{ picked || "未选择系列" }}</p>

					<ul v-if="pickedItem" class="sp-posts">
						<li v-for="post in pickedItem.posts" :key="post.slug">
							<span class="sp-order">{{ post.order ?? "—" }}</span>
							<span class="sp-ptitle">{{ post.title }}</span>
							<span v-if="post.slug === selfSlug" class="sp-self">本篇</span>
						</li>
					</ul>
					<p v-else-if="picked" class="sp-detail-hint">
						新系列，本篇是第一篇。
					</p>
					<p v-else class="sp-detail-hint">
						选左边一个系列，或用下面的输入框新建。
					</p>

					<p v-if="taken.length" class="sp-taken">
						已占用：{{ taken.join("、") }}
					</p>
				</div>
			</div>

			<footer class="sp-foot">
				<div class="sp-order-box">
					<span class="sp-order-label">系列序号</span>
					<input
						v-model="orderText"
						class="field sp-order-input"
						type="number"
						min="1"
						:disabled="!picked"
						placeholder="—"
						@keydown.enter.prevent="apply"
					/>
					<button
						v-if="picked && String(suggested) !== orderText"
						type="button"
						class="sp-fill"
						@click="orderText = String(suggested)"
					>
						用 {{ suggested }}
					</button>
					<span v-if="conflict" class="sp-warn">已被《{{ conflict }}》占用</span>
				</div>
				<div class="sp-actions">
					<button type="button" class="btn-ghost" @click="clearSeries">
						不归属系列
					</button>
					<button type="button" class="btn-ghost" @click="emit('close')">
						取消
					</button>
					<button type="button" class="btn-primary" @click="apply">确定</button>
				</div>
			</footer>
		</div>
	</div>
</template>

<style scoped>
.sp-mask {
	position: fixed;
	inset: 0;
	z-index: 200;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2vh 2vw;
	background: rgb(0 0 0 / 45%);
	backdrop-filter: blur(2px);
}

.sp-dialog {
	display: flex;
	flex-direction: column;
	width: min(46rem, 96vw);
	max-height: min(34rem, 90vh);
	overflow: hidden;
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
}

.sp-head {
	display: flex;
	flex: none;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.85rem 1rem;
	border-bottom: 1px solid var(--line-divider);
}

.sp-title {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 600;
	color: var(--fg-90);
}

.sp-tip {
	margin: 0.2rem 0 0;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.sp-x {
	width: 1.9rem;
	height: 1.9rem;
	border: none;
	border-radius: 999px;
	background: transparent;
	color: var(--fg-50);
}

.sp-x:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.sp-body {
	display: grid;
	grid-template-columns: 1.15fr 1fr;
	flex: 1;
	min-height: 0;
}

.sp-left {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	min-height: 0;
	padding: 0.75rem;
	border-right: 1px solid var(--line-divider);
}

.sp-search {
	font-size: 0.78rem;
	padding: 0.4rem 0.6rem;
}

.sp-list {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	flex: 1;
	min-height: 8rem;
	overflow-y: auto;
}

.sp-row {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 0.1rem;
	padding: 0.4rem 0.55rem;
	border: 1px solid transparent;
	border-radius: 0.6rem;
	background: transparent;
	text-align: left;
}

.sp-row:hover {
	background: var(--btn-plain-bg-hover);
}

.sp-row.on {
	background: var(--tab-on-bg);
	border-color: color-mix(in oklab, var(--primary) 40%, transparent);
}

.sp-name {
	font-size: 0.8rem;
	font-weight: 600;
	color: var(--fg-90);
}

.sp-row.on .sp-name {
	color: var(--accent-text);
}

.sp-meta {
	font-size: 0.66rem;
	color: var(--fg-50);
}

.sp-row-none .sp-name {
	font-weight: 500;
	color: var(--fg-50);
}

.sp-empty {
	margin: 0.4rem 0;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.sp-new {
	display: flex;
	flex: none;
	gap: 0.35rem;
	padding-top: 0.5rem;
	border-top: 1px solid var(--line-divider);
}

.sp-new .field {
	font-size: 0.78rem;
	padding: 0.35rem 0.55rem;
}

.sp-new-btn {
	display: inline-flex;
	flex: none;
	align-items: center;
	gap: 0.2rem;
	padding: 0 0.6rem;
	border: none;
	border-radius: 0.55rem;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.75rem;
	font-weight: 600;
}

.sp-new-btn:hover {
	background: var(--btn-regular-bg-hover);
}

.sp-new-btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.sp-right {
	display: flex;
	flex-direction: column;
	min-height: 0;
	padding: 0.75rem;
	gap: 0.4rem;
}

.sp-detail-title {
	margin: 0;
	font-size: 0.8rem;
	font-weight: 600;
	color: var(--fg-90);
}

.sp-detail-hint {
	margin: 0;
	font-size: 0.72rem;
	line-height: 1.6;
	color: var(--fg-50);
}

.sp-posts {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	margin: 0;
	padding: 0;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	list-style: none;
}

.sp-posts li {
	display: flex;
	align-items: baseline;
	gap: 0.4rem;
	padding: 0.2rem 0;
	font-size: 0.74rem;
	color: var(--fg-75);
}

.sp-order {
	flex: none;
	min-width: 1.4rem;
	padding: 0 0.25rem;
	border-radius: 0.28rem;
	background: var(--license-block-bg);
	color: var(--fg-50);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.66rem;
	text-align: center;
}

.sp-ptitle {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sp-self {
	flex: none;
	font-size: 0.62rem;
	color: var(--accent-text);
}

.sp-taken {
	margin: 0;
	font-size: 0.66rem;
	color: var(--fg-50);
}

.sp-foot {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.7rem 1rem;
	border-top: 1px solid var(--line-divider);
}

.sp-order-box {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	min-width: 0;
}

.sp-order-label {
	flex: none;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.sp-order-input {
	width: 4.2rem;
	padding: 0.3rem 0.45rem;
	font-size: 0.78rem;
}

.sp-fill {
	flex: none;
	padding: 0.16rem 0.45rem;
	border: 1px dashed var(--line-color);
	border-radius: 999px;
	background: transparent;
	color: var(--fg-75);
	font-size: 0.68rem;
}

.sp-fill:hover {
	border-color: var(--primary);
	color: var(--accent-text);
}

.sp-warn {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 0.68rem;
	color: var(--admonitions-color-caution);
}

.sp-actions {
	display: flex;
	flex: none;
	gap: 0.4rem;
}

/* 窄屏：两栏叠成一栏，右栏的篇目列表缩到三行高 */
@media (max-width: 640px) {
	.sp-body {
		grid-template-columns: 1fr;
		overflow-y: auto;
	}

	.sp-left {
		border-right: none;
		border-bottom: 1px solid var(--line-divider);
	}

	.sp-right {
		max-height: 11rem;
	}

	.sp-foot {
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.sp-warn {
		display: none;
	}
}
</style>
