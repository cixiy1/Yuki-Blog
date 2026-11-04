<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { canReview } from "../lib/auth";
import { splitDate } from "../lib/posts";
import {
	approvePost,
	listQueue,
	type QueueItem,
	rejectPost,
} from "../lib/review";
import { preloadVditorCore } from "../lib/vditor-preload";
import { goReview } from "../router";

const items = ref<QueueItem[]>([]);
const loading = ref(true);
const errorText = ref("");
const notice = ref("");
const busyId = ref<number | null>(null);
/** 正在写退回理由的那一条 */
const rejectingId = ref<number | null>(null);
const rejectNote = ref("");
/** 已经点过一次「通过并发布」、等着再确认的那一条 */
const confirmingId = ref<number | null>(null);

const count = computed(() => items.value.length);

/** 左侧日期柱：用提交时间，审核员按到达顺序处理 */
function dateOf(item: QueueItem): { day: string; year: string } {
	return splitDate(item.submitted_at);
}

async function load(): Promise<void> {
	loading.value = true;
	errorText.value = "";
	try {
		items.value = await listQueue();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}
}

async function onApprove(item: QueueItem): Promise<void> {
	busyId.value = item.id;
	errorText.value = "";
	try {
		await approvePost(item.id);
		items.value = items.value.filter((row) => row.id !== item.id);
		confirmingId.value = null;
		notice.value = `《${item.title}》已通过，约一分钟后上线`;
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "操作失败";
	} finally {
		busyId.value = null;
	}
}

/** 通过会直接写仓库并触发构建，列表上不给人一键滑走的机会，先转成确认态 */
function startApprove(item: QueueItem): void {
	confirmingId.value = item.id;
	rejectingId.value = null;
	errorText.value = "";
}

function cancelApprove(): void {
	confirmingId.value = null;
}

function startReject(item: QueueItem): void {
	rejectingId.value = item.id;
	confirmingId.value = null;
	rejectNote.value = "";
	errorText.value = "";
}

function cancelReject(): void {
	rejectingId.value = null;
	rejectNote.value = "";
}

async function submitReject(item: QueueItem): Promise<void> {
	const note = rejectNote.value.trim();
	if (note.length === 0) {
		errorText.value = "写一句退回理由；想逐条标建议就点开正文划词";
		return;
	}
	busyId.value = item.id;
	errorText.value = "";
	try {
		await rejectPost(item.id, note);
		items.value = items.value.filter((row) => row.id !== item.id);
		rejectingId.value = null;
		rejectNote.value = "";
		notice.value = `《${item.title}》已退回`;
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "操作失败";
	} finally {
		busyId.value = null;
	}
}

onMounted(() => {
	if (canReview.value) {
		void load();
		// 点开正文要用的 Markdown 渲染器有 3.7 MB，趁现在读列表先拉下来
		preloadVditorCore();
	} else {
		loading.value = false;
	}
});
</script>

<template>
	<div>
		<PageHeader
			title="审核队列"
			desc="点标题或「看正文」先读全文，再决定通过或退回；通过即写入仓库并触发构建。"
		>
			<template #actions>
				<button
					type="button"
					class="btn-regular"
					:disabled="loading || !canReview"
					@click="load()"
				>
					<AppIcon name="refresh" :size="15" />
					刷新
				</button>
			</template>
		</PageHeader>

		<p v-if="errorText" class="error">{{ errorText }}</p>
		<p v-else-if="notice" class="notice">{{ notice }}</p>

		<p v-if="!canReview" class="state">审核队列只对审核员与管理员开放。</p>
		<p v-else-if="loading" class="state">读取中…</p>
		<p v-else-if="count === 0" class="state">
			没有待审的稿子。有人提交后会出现在这里。
		</p>

		<ul v-else class="queue card-base">
			<li v-for="item in items" :key="item.id" class="row">
				<div class="col-date">
					<span class="date-day">{{ dateOf(item).day }}</span>
					<span class="date-year">{{ dateOf(item).year }}</span>
				</div>

				<div class="col-main">
					<h2 class="row-title">
						<button type="button" class="title-btn" @click="goReview(item.id)">
							{{ item.title }}
							<AppIcon name="eye" :size="14" />
						</button>
					</h2>
					<p class="row-meta">
						<span>{{ item.author }}</span>
						<span>·</span>
						<span>{{ item.body_len }} 字</span>
						<span>·</span>
						<code>/posts/{{ item.slug }}/</code>
					</p>
					<p v-if="item.summary" class="row-summary">{{ item.summary }}</p>

					<div v-if="rejectingId === item.id" class="reject-box">
						<input
							v-model="rejectNote"
							class="field"
							maxlength="200"
							placeholder="退回理由，作者在「我的文章」里能看到"
							@keyup.enter="submitReject(item)"
						/>
						<div class="reject-actions">
							<button
								type="button"
								class="btn-primary"
								:disabled="busyId === item.id"
								@click="submitReject(item)"
							>
								确认退回
							</button>
							<button type="button" class="btn-ghost" @click="cancelReject()">
								取消
							</button>
						</div>
					</div>
				</div>

				<div v-if="rejectingId !== item.id" class="row-actions">
					<button
						type="button"
						class="btn-regular act"
						@click="goReview(item.id)"
					>
						<AppIcon name="eye" :size="15" />
						看正文
					</button>
					<button
						type="button"
						class="btn-regular act"
						:disabled="busyId === item.id"
						@click="startReject(item)"
					>
						退回
					</button>
					<template v-if="confirmingId === item.id">
						<button type="button" class="btn-ghost act" @click="cancelApprove()">
							取消
						</button>
						<button
							type="button"
							class="btn-primary act"
							:disabled="busyId === item.id"
							@click="onApprove(item)"
						>
							{{ busyId === item.id ? "发布中…" : "确认发布" }}
						</button>
					</template>
					<button
						v-else
						type="button"
						class="btn-primary act"
						:disabled="busyId === item.id"
						@click="startApprove(item)"
					>
						通过并发布
					</button>
				</div>
			</li>
		</ul>
	</div>
</template>

<style scoped>
.error {
	margin: 0 0 0.7rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: color-mix(in oklab, var(--admonitions-color-caution) 14%, transparent);
	color: var(--admonitions-color-caution);
	font-size: 0.8rem;
}

.notice {
	margin: 0 0 0.7rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: color-mix(in oklab, var(--admonitions-color-tip) 14%, transparent);
	color: var(--admonitions-color-tip);
	font-size: 0.8rem;
}

.state {
	padding: 2rem 1rem;
	text-align: center;
	font-size: 0.85rem;
	color: var(--fg-50);
}

.queue {
	margin: 0;
	padding: 0;
	list-style: none;
	overflow: hidden;
}

.row {
	display: flex;
	align-items: flex-start;
	gap: 1rem;
	padding: 0.95rem 1.15rem;
	transition: background-color 0.15s ease;
}

.row + .row {
	border-top: 1px solid var(--line-divider);
}

.row:hover {
	background: var(--btn-plain-bg-hover);
}

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

.row-title {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 600;
	line-height: 1.45;
	color: var(--fg-90);
}

.title-btn {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	margin: 0;
	padding: 0;
	border: none;
	background: none;
	font: inherit;
	color: inherit;
	text-align: left;
	cursor: pointer;
}

.title-btn:hover {
	color: var(--accent-text);
}

.row-meta {
	margin: 0;
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.35rem;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.row-meta code {
	font-size: 0.7rem;
}

.row-summary {
	margin: 0;
	font-size: 0.8rem;
	line-height: 1.6;
	color: var(--content-meta);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.row-actions {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	flex: none;
	padding-top: 0.05rem;
}

.act {
	padding: 0.32rem 0.68rem;
	font-size: 0.78rem;
}

.reject-box {
	margin-top: 0.6rem;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.reject-actions {
	display: flex;
	gap: 0.4rem;
}

@media (max-width: 700px) {
	.row {
		flex-direction: column;
		align-items: stretch;
	}

	.row-actions {
		justify-content: flex-start;
	}
}
</style>
