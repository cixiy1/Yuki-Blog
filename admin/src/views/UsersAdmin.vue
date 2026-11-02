<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { ApiError } from "../lib/api";
import { user as me } from "../lib/auth";
import {
	type AdminUser,
	formatTime,
	listUsers,
	patchUser,
	ROLE_LABEL,
	STATUS_LABEL,
} from "../lib/users";

const rows = ref<AdminUser[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 20;
const loading = ref(true);
const busyUid = ref(0);
const errorText = ref("");
const notice = ref("");

const query = ref("");
const roleFilter = ref("");
const statusFilter = ref("");

const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

async function refresh(resetPage = false): Promise<void> {
	if (resetPage) page.value = 1;
	loading.value = true;
	errorText.value = "";
	try {
		const data = await listUsers({
			q: query.value.trim(),
			role: roleFilter.value,
			status: statusFilter.value,
			page: page.value,
			limit,
		});
		rows.value = data.users;
		total.value = data.total;
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}
}

async function apply(uid: number, patch: { status?: string; role?: string }) {
	busyUid.value = uid;
	errorText.value = "";
	notice.value = "";
	try {
		const updated = await patchUser(uid, patch);
		const index = rows.value.findIndex((row) => row.uid === uid);
		if (index >= 0) rows.value[index] = updated;
		notice.value = `${updated.account} 已更新`;
	} catch (error) {
		errorText.value =
			error instanceof ApiError ? error.message : "更新失败，请重试";
	} finally {
		busyUid.value = 0;
	}
}

function onStatus(row: AdminUser, event: Event): void {
	const next = (event.target as HTMLSelectElement).value;
	if (next === row.status) return;
	if (
		next === "disabled" &&
		!window.confirm(`停用 ${row.account}？其所有设备会立刻掉线。`)
	) {
		(event.target as HTMLSelectElement).value = row.status;
		return;
	}
	void apply(row.uid, { status: next });
}

function onRole(row: AdminUser, event: Event): void {
	const next = (event.target as HTMLSelectElement).value;
	if (next === row.role) return;
	void apply(row.uid, { role: next });
}

function isSelf(row: AdminUser): boolean {
	return row.uid === me.value?.uid;
}

function isLocked(row: AdminUser): boolean {
	return isSelf(row) || row.role === "admin";
}

onMounted(() => void refresh());
</script>

<template>
	<div>
		<PageHeader title="用户管理" desc="改角色、停用账号。管理员账号只能改库。">
			<template #actions>
				<button type="button" class="btn-regular" @click="refresh()">
					<AppIcon name="refresh" :size="15" />
					刷新
				</button>
			</template>
		</PageHeader>

		<div class="filters">
			<input
				v-model="query"
				class="field"
				placeholder="搜登录名 / 邮箱 / 昵称"
				@keyup.enter="refresh(true)"
			/>
			<select v-model="roleFilter" class="field" @change="refresh(true)">
				<option value="">全部角色</option>
				<option value="user">普通用户</option>
				<option value="reviewer">审核员</option>
				<option value="admin">管理员</option>
			</select>
			<select v-model="statusFilter" class="field" @change="refresh(true)">
				<option value="">全部状态</option>
				<option value="pending">待验证</option>
				<option value="active">正常</option>
				<option value="disabled">已停用</option>
			</select>
			<button type="button" class="btn-primary" @click="refresh(true)">搜索</button>
		</div>

		<p v-if="notice" class="notice">{{ notice }}</p>
		<p v-if="errorText" class="error">{{ errorText }}</p>

		<div v-if="loading" class="state">读取中…</div>
		<div v-else-if="rows.length === 0" class="state">没有匹配的用户。</div>

		<div v-else class="card-base table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>用户</th>
						<th>邮箱</th>
						<th>角色</th>
						<th>状态</th>
						<th>注册</th>
						<th>最后登录</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in rows" :key="row.uid">
						<td>
							<p class="name">
								{{ row.display_name }}
								<span v-if="isSelf(row)" class="self-tag">你</span>
							</p>
							<p class="sub">@{{ row.account }} · uid {{ row.uid }}</p>
						</td>
						<td class="mono">
							{{ row.email }}
							<span v-if="!row.email_verified" class="warn">未验证</span>
						</td>
						<td>
							<select
								class="field mini"
								:value="row.role"
								:disabled="isLocked(row) || busyUid === row.uid"
								@change="onRole(row, $event)"
							>
								<option value="user">{{ ROLE_LABEL.user }}</option>
								<option value="reviewer">{{ ROLE_LABEL.reviewer }}</option>
								<option value="admin">{{ ROLE_LABEL.admin }}</option>
							</select>
						</td>
						<td>
							<select
								class="field mini"
								:value="row.status"
								:disabled="isLocked(row) || busyUid === row.uid"
								@change="onStatus(row, $event)"
							>
								<option value="pending">{{ STATUS_LABEL.pending }}</option>
								<option value="active">{{ STATUS_LABEL.active }}</option>
								<option value="disabled">{{ STATUS_LABEL.disabled }}</option>
							</select>
						</td>
						<td class="dim">{{ formatTime(row.created_at) }}</td>
						<td class="dim">{{ formatTime(row.last_login_at) }}</td>
					</tr>
				</tbody>
			</table>
		</div>

		<div class="pager">
			<span>共 {{ total }} 个用户 · 第 {{ page }} / {{ pages }} 页</span>
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
	flex-wrap: wrap;
	gap: 0.5rem;
	margin-bottom: 0.85rem;
}

.filters .field {
	width: auto;
	flex: 1 1 10rem;
	min-width: 8rem;
}

.notice {
	margin: 0 0 0.7rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: var(--btn-regular-bg);
	color: var(--btn-content);
	font-size: 0.8rem;
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

.table-wrap {
	overflow-x: auto;
	padding: 0.25rem 0.5rem;
}

.table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.8rem;
}

.table th {
	text-align: left;
	font-weight: 600;
	color: var(--fg-50);
	padding: 0.6rem 0.5rem;
	border-bottom: 1px solid var(--line-divider);
	white-space: nowrap;
}

.table td {
	padding: 0.55rem 0.5rem;
	border-bottom: 1px solid var(--line-divider);
	vertical-align: middle;
	color: var(--fg-90);
}

.table tr:last-child td {
	border-bottom: none;
}

.name {
	margin: 0;
	font-weight: 600;
	display: flex;
	align-items: center;
	gap: 0.35rem;
}

.self-tag {
	font-size: 0.65rem;
	padding: 0.05rem 0.35rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--btn-content);
}

.sub {
	margin: 0.1rem 0 0;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.mono {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.76rem;
}

.warn {
	margin-left: 0.3rem;
	font-size: 0.68rem;
	color: var(--admonitions-color-caution);
}

.dim {
	color: var(--fg-50);
	white-space: nowrap;
}

.mini {
	width: auto;
	padding: 0.25rem 0.45rem;
	font-size: 0.76rem;
	border-radius: 0.5rem;
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
