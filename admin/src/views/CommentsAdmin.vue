<script setup lang="ts">
/**
 * 评论管理：审内容、删评论。
 *
 * 评论不走构建，新评论进 D1 就能在站点上出现（先审后发时通过审核即显示）。
 * 开关（是否开启、先审后发、允许游客等）统一放在「站点设置 → 评论」，
 * 这里只留一个跳转，免得同一个开关有两处入口。
 */
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import { api } from "../lib/api";
import { isAdmin } from "../lib/auth";
import { go } from "../router";

interface AdminComment {
	id: number;
	target: string;
	parent_id: number | null;
	name: string;
	uid: number | null;
	email_hint: string | null;
	body_md: string;
	status: string;
	is_admin: boolean;
	created_at: string;
	reviewed_at: string | null;
}

// 「全部」放最前：它是默认页签，排在末尾像是补上去的
const TABS: Array<{ key: string; label: string }> = [
	{ key: "all", label: "全部" },
	{ key: "pending", label: "待审" },
	{ key: "approved", label: "已通过" },
	{ key: "rejected", label: "已拒绝" },
];

const STATUS_LABEL: Record<string, string> = {
	pending: "待审",
	approved: "已通过",
	rejected: "已拒绝",
};

const rows = ref<AdminComment[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
// 默认「全部」：先发后审是默认模式，待审里没东西，落在空列表上会让人以为没评论
const status = ref("all");
const targetQuery = ref("");
const loading = ref(false);
const errorText = ref("");
const note = ref("");
const busyId = ref(0);
const opened = ref(0);

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

function formatTime(value: string): string {
	const at = new Date(value);
	if (Number.isNaN(at.getTime())) return value;
	return at.toLocaleString("zh-CN", { hour12: false });
}

/** 从 target 反推到站点上的地址，审核时点一下能看到那条评论长什么样 */
function linkOf(target: string): string {
	if (target.startsWith("dynamic:")) return target.slice("dynamic:".length);
	if (target === "guestbook") return "/guestbook/";
	return `/posts/${target}/`;
}

async function load(keepPage = false): Promise<void> {
	if (!keepPage) page.value = 1;
	loading.value = true;
	errorText.value = "";
	try {
		const params = new URLSearchParams({
			status: status.value,
			page: String(page.value),
		});
		if (targetQuery.value.trim())
			params.set("target", targetQuery.value.trim());
		const data = await api.get<{ items: AdminComment[]; total: number }>(
			`/api/admin/comments?${params.toString()}`,
		);
		rows.value = data.items;
		total.value = data.total;
	} catch (err) {
		errorText.value = err instanceof Error ? err.message : "读取评论失败";
	} finally {
		loading.value = false;
	}
}

function switchTab(key: string): void {
	if (status.value === key) return;
	status.value = key;
	void load();
}

async function setStatus(row: AdminComment, next: string): Promise<void> {
	busyId.value = row.id;
	errorText.value = "";
	try {
		await api.post(`/api/admin/comments/${row.id}/status`, { status: next });
		if (status.value === "all") {
			row.status = next;
		} else {
			rows.value = rows.value.filter((item) => item.id !== row.id);
			total.value = Math.max(0, total.value - 1);
		}
		note.value = `已${STATUS_LABEL[next] ?? "更新"}，站点上立即生效。`;
	} catch (err) {
		errorText.value = err instanceof Error ? err.message : "操作失败";
	} finally {
		busyId.value = 0;
	}
}

async function remove(row: AdminComment): Promise<void> {
	if (!window.confirm("删除这条评论及其回复？不可恢复。")) return;
	busyId.value = row.id;
	try {
		await api.delete(`/api/admin/comments/${row.id}`);
		rows.value = rows.value.filter((item) => item.id !== row.id);
		total.value = Math.max(0, total.value - 1);
		note.value = "已删除。";
	} catch (err) {
		errorText.value = err instanceof Error ? err.message : "删除失败";
	} finally {
		busyId.value = 0;
	}
}

/** 开关统一在「站点设置 → 评论」里改，这里点了直接落到那一组 */
function openSettings(): void {
	go("/settings/comments");
}

onMounted(() => void load());
</script>

<template>
	<div>
		<PageHeader
			title="评论"
			desc="评论存在 D1，通过审核后站点上立即可见，不需要重新构建。"
		>
			<template #actions>
				<button
					v-if="isAdmin"
					type="button"
					class="btn-regular"
					@click="openSettings()"
				>
					<AppIcon name="admin" :size="15" />
					评论设置
				</button>
				<button type="button" class="btn-regular" @click="load()">
					<AppIcon name="refresh" :size="15" />
					刷新
				</button>
			</template>
		</PageHeader>

		<div class="filters">
			<div class="tabs">
				<button
					v-for="tab in TABS"
					:key="tab.key"
					type="button"
					class="tab"
					:class="{ on: status === tab.key }"
					@click="switchTab(tab.key)"
				>
					{{ tab.label }}
				</button>
			</div>
			<input
				v-model="targetQuery"
				class="field search"
				placeholder="按文章 slug / 说说筛选，回车"
				@keyup.enter="load()"
			/>
		</div>

		<p v-if="note" class="note">{{ note }}</p>
		<p v-if="errorText" class="error">{{ errorText }}</p>
		<LoadingState v-if="loading" :rows="4" />
		<div v-else-if="rows.length === 0" class="state">这一类里没有评论。</div>

		<ul v-else class="list">
			<li v-for="row in rows" :key="row.id" class="row">
				<div class="row-head">
					<span class="badge" :data-status="row.status">
						{{ STATUS_LABEL[row.status] ?? row.status }}
					</span>
					<span class="name">{{ row.name }}</span>
					<span v-if="row.is_admin" class="badge tiny">站长</span>
					<span v-if="row.uid === null" class="badge tiny">游客</span>
					<span v-if="row.parent_id" class="badge tiny">回复 #{{ row.parent_id }}</span>
					<span class="target">{{ row.target }}</span>
					<span class="time">{{ formatTime(row.created_at) }}</span>
				</div>

				<pre class="body" :class="{ open: opened === row.id }" @click="opened = opened === row.id ? 0 : row.id">{{ row.body_md }}</pre>

				<div class="row-foot">
					<a class="link" :href="linkOf(row.target)" target="_blank" rel="noopener">
						看页面
					</a>
					<span v-if="row.email_hint" class="hint">{{ row.email_hint }}</span>
					<span class="spacer" />
					<button
						v-if="row.status !== 'approved'"
						type="button"
						class="btn-ghost mini"
						:disabled="busyId === row.id"
						@click="setStatus(row, 'approved')"
					>
						通过
					</button>
					<button
						v-if="row.status !== 'rejected'"
						type="button"
						class="btn-ghost mini"
						:disabled="busyId === row.id"
						@click="setStatus(row, 'rejected')"
					>
						拒绝
					</button>
					<button
						type="button"
						class="btn-ghost mini danger"
						:disabled="busyId === row.id"
						@click="remove(row)"
					>
						删除
					</button>
				</div>
			</li>
		</ul>

		<div v-if="!loading" class="pager">
			<span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span>
			<div class="pager-actions">
				<button
					type="button"
					class="btn-ghost"
					:disabled="page <= 1"
					@click="page -= 1; load(true)"
				>
					上一页
				</button>
				<button
					type="button"
					class="btn-ghost"
					:disabled="page >= pages"
					@click="page += 1; load(true)"
				>
					下一页
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.filters {
	display: flex;
	gap: 0.5rem;
	padding: 0.7rem;
	margin-bottom: 1rem;
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	background: var(--card-bg);
	align-items: center;
	flex-wrap: wrap;
}

.tabs {
	display: flex;
	gap: 0.2rem;
}

.tab {
	padding: 0.28rem 0.7rem;
	border: none;
	border-radius: 999px;
	background: transparent;
	color: var(--fg-50);
	font-size: 0.78rem;
	cursor: pointer;
	font-family: inherit;
}

.tab:hover {
	background: var(--btn-plain-bg-hover);
}

.tab.on {
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-weight: 600;
}

.search {
	flex: 1 1 12rem;
	min-width: 0;
}

.note {
	margin: 0 0 0.8rem;
	font-size: 0.78rem;
	color: var(--fg-50);
}

.error {
	margin: 0 0 0.8rem;
	font-size: 0.78rem;
	color: var(--admonitions-color-caution);
}

.state {
	padding: 2.5rem 0;
	text-align: center;
	font-size: 0.82rem;
	color: var(--fg-50);
}

.list {
	list-style: none;
	margin: 0;
	padding: 0;
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	background: var(--card-bg);
	overflow: hidden;
}

.row {
	border-top: 1px solid var(--line-divider);
}

.row:first-child {
	border-top: none;
}

.row-head {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.65rem 0.9rem 0.35rem;
	font-size: 0.8rem;
	color: var(--fg-90);
	flex-wrap: wrap;
}

.badge {
	flex: none;
	padding: 0.08rem 0.45rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.7rem;
	font-weight: 600;
}

.badge[data-status="pending"] {
	background: var(--primary);
	color: #fff;
}

.badge.tiny {
	font-size: 0.66rem;
	font-weight: 500;
	color: var(--fg-50);
}

.name {
	font-weight: 600;
}

.target {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--fg-50);
	font-size: 0.74rem;
}

.time {
	flex: none;
	font-size: 0.74rem;
	color: var(--fg-50);
	white-space: nowrap;
}

.body {
	margin: 0;
	padding: 0 0.9rem 0.5rem;
	font-family: inherit;
	font-size: 0.82rem;
	line-height: 1.6;
	color: var(--fg-75);
	white-space: pre-wrap;
	word-break: break-word;
	max-height: 4.4rem;
	overflow: hidden;
	cursor: pointer;
}

.body.open {
	max-height: none;
}

.row-foot {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0 0.9rem 0.6rem;
	font-size: 0.74rem;
}

.link {
	color: var(--fg-50);
	text-decoration: underline;
	text-underline-offset: 2px;
}

.hint {
	color: var(--fg-50);
	font-family: ui-monospace, SFMono-Regular, monospace;
	font-size: 0.7rem;
}

.spacer {
	flex: 1;
}

.btn-ghost.mini {
	padding: 0.18rem 0.55rem;
	font-size: 0.74rem;
}

.btn-ghost.mini.danger {
	color: var(--admonitions-color-caution);
}

.pager {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	margin-top: 0.8rem;
	font-size: 0.78rem;
	color: var(--fg-50);
}

.pager-actions {
	display: flex;
	gap: 0.3rem;
}
</style>
