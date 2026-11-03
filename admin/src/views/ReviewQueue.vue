<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { canReview } from "../lib/auth";
import { formatTime } from "../lib/posts";
import {
	approvePost,
	listQueue,
	type QueueItem,
	rejectPost,
} from "../lib/review";

const items = ref<QueueItem[]>([]);
const loading = ref(true);
const errorText = ref("");
const notice = ref("");
const busyId = ref<number | null>(null);
/** 正在写退回理由的那一条 */
const rejectingId = ref<number | null>(null);
const rejectNote = ref("");

const count = computed(() => items.value.length);

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
		notice.value = `《${item.title}》已通过，约一分钟后上线`;
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "操作失败";
	} finally {
		busyId.value = null;
	}
}

function startReject(item: QueueItem): void {
	rejectingId.value = item.id;
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
		errorText.value = "写一句退回理由，作者才知道改什么";
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
	if (canReview.value) void load();
	else loading.value = false;
});
</script>

<template>
	<div>
		<PageHeader
			title="审核队列"
			desc="待审投稿，通过即写入仓库并触发构建；退回要写理由。"
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

		<ul v-else class="list">
			<li v-for="item in items" :key="item.id" class="row card-base">
				<div class="row-main">
					<p class="row-title">{{ item.title }}</p>
					<p class="row-meta">
						<span>{{ item.author }}</span>
						<span>·</span>
						<code>/posts/{{ item.slug }}/</code>
						<span>·</span>
						<span>提交于 {{ formatTime(item.submitted_at) }}</span>
						<span>·</span>
						<span>{{ item.body_len }} 字</span>
					</p>
					<p v-if="item.summary" class="row-note">{{ item.summary }}</p>

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
						class="btn-primary"
						:disabled="busyId === item.id"
						@click="onApprove(item)"
					>
						通过并发布
					</button>
					<button
						type="button"
						class="btn-regular"
						:disabled="busyId === item.id"
						@click="startReject(item)"
					>
						退回
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

.list {
	margin: 0;
	padding: 0;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
}

.row {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.85rem 1rem;
}

.row-main {
	min-width: 0;
	flex: 1;
}

.row-title {
	margin: 0;
	font-size: 0.9rem;
	font-weight: 600;
	color: var(--fg-90);
}

.row-meta {
	margin: 0.2rem 0 0;
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.3rem;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.row-meta code {
	font-size: 0.7rem;
}

.row-note {
	margin: 0.35rem 0 0;
	font-size: 0.78rem;
	color: var(--fg-75);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.row-actions {
	display: flex;
	gap: 0.4rem;
	flex: none;
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
