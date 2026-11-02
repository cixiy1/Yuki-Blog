<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import {
	ACTION_LABEL,
	AUDIT_ACTIONS,
	type AuditEntry,
	listAudit,
} from "../lib/audit";
import { formatTime } from "../lib/users";

const rows = ref<AuditEntry[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 30;
const action = ref("");
const loading = ref(true);
const errorText = ref("");
const opened = ref<number>(0);

const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

async function refresh(resetPage = false): Promise<void> {
	if (resetPage) page.value = 1;
	loading.value = true;
	errorText.value = "";
	try {
		const data = await listAudit(action.value, page.value, limit);
		rows.value = data.logs;
		total.value = data.total;
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}
}

function toggle(id: number): void {
	opened.value = opened.value === id ? 0 : id;
}

function pretty(detail: string | null): string {
	if (!detail) return "";
	try {
		return JSON.stringify(JSON.parse(detail), null, 2);
	} catch {
		return detail;
	}
}

onMounted(() => void refresh());
</script>

<template>
	<div>
		<PageHeader title="审计日志" desc="登录、改密、管理操作都记在这里。">
			<template #actions>
				<button type="button" class="btn-regular" @click="refresh()">
					<AppIcon name="refresh" :size="15" />
					刷新
				</button>
			</template>
		</PageHeader>

		<div class="filters">
			<select v-model="action" class="field" @change="refresh(true)">
				<option value="">全部动作</option>
				<option v-for="item in AUDIT_ACTIONS" :key="item" :value="item">
					{{ ACTION_LABEL[item] ?? item }}（{{ item }}）
				</option>
			</select>
		</div>

		<p v-if="errorText" class="error">{{ errorText }}</p>
		<div v-if="loading" class="state">读取中…</div>
		<div v-else-if="rows.length === 0" class="state">还没有记录。</div>

		<ul v-else class="list">
			<li v-for="row in rows" :key="row.id" class="row">
				<button type="button" class="row-head" @click="toggle(row.id)">
					<span class="badge">{{ ACTION_LABEL[row.action] ?? row.action }}</span>
					<span class="target">{{ row.target ?? "—" }}</span>
					<span class="who">uid {{ row.actor_uid ?? "匿名" }}</span>
					<span class="time">{{ formatTime(row.created_at) }}</span>
				</button>
				<pre v-if="opened === row.id" class="detail">{{ pretty(row.detail) || "（无附加信息）" }}</pre>
			</li>
		</ul>

		<div class="pager">
			<span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span>
			<div class="pager-actions">
				<button
					type="button"
					class="btn-ghost"
					:disabled="page <= 1"
					@click="page -= 1; refresh()"
				>
					上一页
				</button>
				<button
					type="button"
					class="btn-ghost"
					:disabled="page >= pages"
					@click="page += 1; refresh()"
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
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	box-shadow: var(--card-shadow);
}

.filters .field {
	width: auto;
	flex: 1 1 14rem;
	max-width: 22rem;
	height: 2.35rem;
}

.error {
	margin: 0 0 0.7rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: color-mix(in oklab, var(--admonitions-color-caution) 14%, transparent);
	color: var(--admonitions-color-caution);
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
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	box-shadow: var(--card-shadow);
	overflow: hidden;
}

.row {
	padding: 0;
	border-top: 1px solid var(--line-divider);
}

.row:first-child {
	border-top: none;
}

.row-head {
	display: flex;
	align-items: center;
	gap: 0.7rem;
	width: 100%;
	padding: 0.65rem 0.9rem;
	border: none;
	background: transparent;
	text-align: left;
	font-size: 0.8rem;
	color: var(--fg-90);
}

.row-head:hover {
	background: var(--btn-plain-bg-hover);
}

.badge {
	flex: none;
	padding: 0.08rem 0.45rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--btn-content);
	font-size: 0.7rem;
	font-weight: 600;
}

.target {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.who,
.time {
	flex: none;
	font-size: 0.74rem;
	color: var(--fg-50);
	white-space: nowrap;
}

.detail {
	margin: 0;
	padding: 0.6rem 0.9rem 0.8rem;
	border-top: 1px solid var(--line-divider);
	background: var(--license-block-bg);
	font-size: 0.74rem;
	line-height: 1.6;
	overflow-x: auto;
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
