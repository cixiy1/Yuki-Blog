<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import EmptyState from "../components/EmptyState.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import {
	ACTION_LABEL,
	AUDIT_ACTIONS,
	type AuditEntry,
	listAudit,
} from "../lib/audit";

const rows = ref<AuditEntry[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 30;
const action = ref("");
const loading = ref(true);
const errorText = ref("");
const opened = ref<number>(0);

const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

/** 日志按到达时间扫，左侧只放 月-日 + 时分；年份占地方又几乎不变 */
const viewRows = computed(() =>
	rows.value.map((row) => ({ row, ...stampOf(row.created_at) })),
);

function stampOf(iso: string): { day: string; clock: string } {
	const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
	const date = new Date(normalized);
	if (Number.isNaN(date.getTime())) return { day: iso, clock: "" };
	const pad = (n: number): string => String(n).padStart(2, "0");
	return {
		day: `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
		clock: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
	};
}

/** 失败和删除类给红色，其余中性——一屏全是灰胶囊就分不出哪条要留意 */
function kindOf(action: string): "danger" | "" {
	return action.endsWith("_failed") || action.includes("delete")
		? "danger"
		: "";
}

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
					{{ ACTION_LABEL[item] ?? item }}
				</option>
			</select>
			<span class="filter-note">
				{{ loading ? "读取中" : `共 ${total} 条记录` }}
			</span>
		</div>

		<p v-if="errorText" class="error">{{ errorText }}</p>
		<LoadingState v-if="loading" :rows="5" />
		<EmptyState
			v-else-if="rows.length === 0"
			icon="audit"
			title="还没有操作记录"
			desc="登录、改配置、审核、发信这类动作都会落到这里，从最近的开始往上排。"
		/>

		<ul v-else class="list">
			<li v-for="item in viewRows" :key="item.row.id" class="row">
				<button
					type="button"
					class="row-head"
					:aria-expanded="opened === item.row.id"
					@click="toggle(item.row.id)"
				>
					<span class="col-time">
						<span class="t-day">{{ item.day }}</span>
						<span class="t-clock">{{ item.clock }}</span>
					</span>
					<span
						class="badge"
						:data-kind="kindOf(item.row.action)"
						:title="`${ACTION_LABEL[item.row.action] ?? item.row.action}（${item.row.action}）`"
					>
						{{ ACTION_LABEL[item.row.action] ?? item.row.action }}
					</span>
					<span class="target">{{ item.row.target ?? "—" }}</span>
					<span class="who">uid {{ item.row.actor_uid ?? "匿名" }}</span>
				</button>
				<pre v-if="opened === item.row.id" class="detail">{{ pretty(item.row.detail) || "（无附加信息）" }}</pre>
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
	width: 15rem;
	flex: none;
	height: 2.35rem;
}

.filter-note {
	margin-left: auto;
	align-self: center;
	font-size: 0.72rem;
	color: var(--fg-50);
	font-variant-numeric: tabular-nums;
}

.error {
	margin: 0 0 0.7rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: color-mix(in oklab, var(--admonitions-color-caution) 14%, transparent);
	color: var(--admonitions-color-caution);
	font-size: 0.8rem;
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
	padding: 0.62rem 1.1rem;
	border: none;
	background: transparent;
	text-align: left;
	font-size: 0.8rem;
	color: var(--fg-90);
}

.row-head:hover {
	background: var(--btn-plain-bg-hover);
}

/* 时间柱：和文章列表同一个位置、同一种算法，扫一列就知道「什么时候」 */
.col-time {
	flex: none;
	width: 2.9rem;
	display: flex;
	flex-direction: column;
	line-height: 1.25;
}

.t-day {
	font-size: 0.8rem;
	font-weight: 600;
	color: var(--fg-75);
	font-variant-numeric: tabular-nums;
}

.t-clock {
	font-size: 0.68rem;
	color: var(--fg-50);
	font-variant-numeric: tabular-nums;
}

.badge {
	flex: none;
	/* 固定宽度而不是最小宽度：标签长短不一，一列起点不齐看着像没对齐。
	   6.4rem 按最长的中文标签（6 个字）留的，再窄就把「发送测试邮件」截了 */
	width: 6.4rem;
	text-align: center;
	padding: 0.08rem 0.45rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.7rem;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.badge[data-kind="danger"] {
	background: color-mix(in oklab, var(--admonitions-color-caution) 16%, transparent);
	color: var(--admonitions-color-caution);
}

.target {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--fg-75);
}

.who {
	flex: none;
	font-size: 0.72rem;
	color: var(--fg-50);
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
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
