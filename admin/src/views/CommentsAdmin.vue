<script setup lang="ts">
/**
 * 评论管理。
 *
 * 评论不走构建：新评论进 D1 就能在站点上出现（先审后发时通过审核即显示）。
 * 这个页面同时管两件事——审内容、改开关。开关改完立刻生效，不用等部署。
 */
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { api } from "../lib/api";
import { isAdmin } from "../lib/auth";

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

interface CommentSettings {
	enabled: boolean;
	requireApproval: boolean;
	allowGuest: boolean;
	maxLength: number;
	rateSeconds: number;
}

const TABS: Array<{ key: string; label: string }> = [
	{ key: "pending", label: "待审" },
	{ key: "approved", label: "已通过" },
	{ key: "rejected", label: "已拒绝" },
	{ key: "all", label: "全部" },
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

const settingsOpen = ref(false);
const config = ref<CommentSettings>({
	enabled: true,
	requireApproval: false,
	allowGuest: true,
	maxLength: 2000,
	rateSeconds: 20,
});
const configIssues = ref("");
const savingConfig = ref(false);

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

async function openSettings(): Promise<void> {
	settingsOpen.value = true;
	configIssues.value = "";
	try {
		const data = await api.get<{ config: CommentSettings }>(
			"/api/admin/comments/config",
		);
		config.value = { ...data.config };
	} catch (err) {
		configIssues.value = err instanceof Error ? err.message : "读取设置失败";
	}
}

async function saveSettings(): Promise<void> {
	savingConfig.value = true;
	configIssues.value = "";
	try {
		const data = await api.put<{ config: CommentSettings }>(
			"/api/admin/comments/config",
			{ ...config.value },
		);
		config.value = { ...data.config };
		settingsOpen.value = false;
		note.value = "设置已保存，下一次打开页面就按新规则走。";
	} catch (err) {
		configIssues.value = err instanceof Error ? err.message : "保存失败";
	} finally {
		savingConfig.value = false;
	}
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
		<div v-if="loading" class="state">读取中…</div>
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

		<div class="pager">
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

		<div v-if="settingsOpen" class="mask" @click.self="settingsOpen = false">
			<div class="dialog" role="dialog" aria-modal="true" aria-label="评论设置">
				<header class="dialog-head">
					<p class="dialog-title">评论设置</p>
					<button
						type="button"
						class="close"
						title="关闭"
						@click="settingsOpen = false"
					>
						<AppIcon name="close" :size="14" />
					</button>
				</header>

				<div class="dialog-body">
					<label class="switch-row">
						<input v-model="config.enabled" type="checkbox" />
						<span>
							<strong>开启评论</strong>
							<small>关掉后全站评论区隐藏，已有评论保留。</small>
						</span>
					</label>
					<label class="switch-row">
						<input v-model="config.requireApproval" type="checkbox" />
						<span>
							<strong>先审后发</strong>
							<small>默认关闭：评论发出即显示。打开后新评论进待审，通过才显示。</small>
						</span>
					</label>
					<label class="switch-row">
						<input v-model="config.allowGuest" type="checkbox" />
						<span>
							<strong>允许游客评论</strong>
							<small>关掉后必须登录才能发言。</small>
						</span>
					</label>

					<div class="number-row">
						<label>
							<span>正文长度上限</span>
							<input v-model.number="config.maxLength" type="number" min="1" max="5000" />
						</label>
						<label>
							<span>两次发言最小间隔（秒）</span>
							<input v-model.number="config.rateSeconds" type="number" min="0" max="600" />
						</label>
					</div>

					<p v-if="configIssues" class="error">{{ configIssues }}</p>
				</div>

				<footer class="dialog-foot">
					<button type="button" class="btn-ghost" @click="settingsOpen = false">
						取消
					</button>
					<button
						type="button"
						class="btn-primary"
						:disabled="savingConfig"
						@click="saveSettings()"
					>
						{{ savingConfig ? "保存中…" : "保存" }}
					</button>
				</footer>
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

/* ---------- 设置弹窗 ---------- */

.mask {
	position: fixed;
	inset: 0;
	z-index: 60;
	display: grid;
	place-items: center;
	padding: 1rem;
	background: color-mix(in oklab, #000 45%, transparent);
}

.dialog {
	width: min(32rem, 100%);
	max-height: 90vh;
	display: flex;
	flex-direction: column;
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	background: var(--card-bg);
	overflow: hidden;
}

.dialog-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.85rem 1rem;
	border-bottom: 1px solid var(--line-divider);
}

.dialog-title {
	margin: 0;
	font-size: 0.9rem;
	font-weight: 600;
	color: var(--fg-90);
}

.close {
	padding: 0.2rem;
	border: none;
	background: none;
	color: var(--fg-50);
	cursor: pointer;
}

.dialog-body {
	padding: 0.9rem 1rem;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.85rem;
}

.switch-row {
	display: flex;
	align-items: flex-start;
	gap: 0.55rem;
	font-size: 0.8rem;
	color: var(--fg-90);
	cursor: pointer;
}

.switch-row input {
	margin-top: 0.15rem;
}

.switch-row span {
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
}

.switch-row small {
	color: var(--fg-50);
	font-size: 0.74rem;
	font-weight: 400;
}

.number-row {
	display: flex;
	gap: 0.8rem;
	flex-wrap: wrap;
}

.number-row label {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	font-size: 0.76rem;
	color: var(--fg-50);
	flex: 1 1 10rem;
}

.number-row input {
	padding: 0.35rem 0.55rem;
	border: 1px solid var(--line-divider);
	border-radius: 0.4rem;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.8rem;
	font-family: inherit;
}

.dialog-foot {
	display: flex;
	justify-content: flex-end;
	gap: 0.5rem;
	padding: 0.75rem 1rem;
	border-top: 1px solid var(--line-divider);
}
</style>
