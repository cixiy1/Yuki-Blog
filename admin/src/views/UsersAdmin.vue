<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import EmptyState from "../components/EmptyState.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import UserEditor from "../components/UserEditor.vue";
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

/** 行首圆牌上的字：昵称首字，没有昵称就看登录名 */
function initialOf(row: AdminUser): string {
	const name = row.display_name?.trim() || row.account || "?";
	return name.slice(0, 1).toUpperCase();
}

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

/** 抽屉：新建或编辑。editing 为空表示没打开 */
const editorOpen = ref(false);
const editorMode = ref<"create" | "edit">("create");
const editing = ref<AdminUser | null>(null);

function openCreate(): void {
	editorMode.value = "create";
	editing.value = null;
	editorOpen.value = true;
}

function openEdit(row: AdminUser): void {
	editorMode.value = "edit";
	editing.value = row;
	editorOpen.value = true;
}

function onSaved(user: AdminUser): void {
	const index = rows.value.findIndex((row) => row.uid === user.uid);
	if (index >= 0) rows.value[index] = user;
	else void refresh();
	notice.value = `${user.account} 已更新`;
}

function onDeleted(uid: number): void {
	rows.value = rows.value.filter((row) => row.uid !== uid);
	total.value = Math.max(0, total.value - 1);
	notice.value = "账号已删除";
}

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

/** 已注销的账号只留一行记录，不给改也不给再删 */
function isDeleted(row: AdminUser): boolean {
	return row.status === "deleted";
}

/** 自己那一行的角色/状态不给改：后端也会拒，干脆显示成文字并说清原因 */
const SELF_LOCK_HINT = "不能改自己的角色或状态，避免把自己锁在门外";

onMounted(() => void refresh());
</script>

<template>
	<div>
		<PageHeader title="用户管理" desc="新建、改资料、停用或删除账号。管理员之间也能互相调整，只要还剩一个可用的。">
			<template #actions>
				<button type="button" class="btn-primary" @click="openCreate">
					<AppIcon name="plus" :size="15" />
					新建用户
				</button>
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
				<option value="deleted">已删除</option>
			</select>
			<button type="button" class="btn-primary" @click="refresh(true)">搜索</button>
		</div>

		<p v-if="notice" class="notice">{{ notice }}</p>
		<p v-if="errorText" class="error">{{ errorText }}</p>

		<LoadingState v-if="loading" variant="table" :rows="6" />
		<EmptyState
			v-else-if="rows.length === 0"
			icon="users"
			:title="query ? '没有匹配的用户' : '还没有其他账号'"
			desc="可以按登录名、邮箱或昵称搜，也可以直接新建一个账号。"
		/>

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
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in rows" :key="row.uid">
						<td>
							<div class="user-cell">
								<span class="avatar" :class="{ gone: isDeleted(row) }">
									{{ initialOf(row) }}
								</span>
								<div>
									<p class="name">
										{{ row.display_name }}
										<span v-if="isSelf(row)" class="self-tag">你</span>
									</p>
									<p class="sub">@{{ row.account }} · uid {{ row.uid }}</p>
								</div>
							</div>
						</td>
						<td class="mono">
							{{ row.email }}
							<span v-if="!row.email_verified" class="warn">未验证</span>
						</td>
						<td>
							<span v-if="isSelf(row) || isDeleted(row)" class="ro" :title="isDeleted(row) ? '账号已注销' : SELF_LOCK_HINT">
								{{ ROLE_LABEL[row.role] ?? row.role }}
								<span v-if="isSelf(row)" class="lock">锁</span>
							</span>
							<select
								v-else
								class="field mini"
								:value="row.role"
								:disabled="busyUid === row.uid"
								@change="onRole(row, $event)"
							>
								<option value="user">{{ ROLE_LABEL.user }}</option>
								<option value="reviewer">{{ ROLE_LABEL.reviewer }}</option>
								<option value="admin">{{ ROLE_LABEL.admin }}</option>
							</select>
						</td>
						<td>
							<span v-if="isSelf(row) || isDeleted(row)" class="ro" :title="isDeleted(row) ? '账号已注销' : SELF_LOCK_HINT">
								{{ STATUS_LABEL[row.status] ?? row.status }}
								<span v-if="isSelf(row)" class="lock">锁</span>
							</span>
							<select
								v-else
								class="field mini"
								:value="row.status"
								:disabled="busyUid === row.uid"
								@change="onStatus(row, $event)"
							>
								<option value="pending">{{ STATUS_LABEL.pending }}</option>
								<option value="active">{{ STATUS_LABEL.active }}</option>
								<option value="disabled">{{ STATUS_LABEL.disabled }}</option>
								<!-- 已注销的行只读渲染，这个选项只是防止其它路径漏进来时显示空白 -->
								<option value="deleted" disabled>{{ STATUS_LABEL.deleted }}</option>
							</select>
						</td>
						<td class="dim">{{ formatTime(row.created_at) }}</td>
						<td class="dim">{{ formatTime(row.last_login_at) }}</td>
						<td>
							<button
								type="button"
								class="btn-ghost tiny"
								:disabled="isDeleted(row)"
								@click="openEdit(row)"
							>
								详情
							</button>
						</td>
					</tr>
				</tbody>
			</table>
		</div>

		<div v-if="!loading" class="pager">
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

		<UserEditor
			v-if="editorOpen"
			:mode="editorMode"
			:user="editing"
			:self-uid="me?.uid"
			@close="editorOpen = false"
			@saved="onSaved"
			@deleted="onDeleted"
		/>
	</div>
</template>

<style scoped>
.filters {
	display: flex;
	flex-wrap: wrap;
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
	flex: 1 1 10rem;
	min-width: 8rem;
	height: 2.35rem;
}

.filters .btn-primary {
	height: 2.35rem;
}

.notice {
	margin: 0 0 0.7rem;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
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

.table-wrap {
	overflow-x: auto;
	padding: 0;
	/* 表格自己的圆角不能把滚动条切掉 */
	-webkit-overflow-scrolling: touch;
}

.table {
	width: 100%;
	/* 窄屏别硬挤：列一压缩，「管理员」会竖排、「245」会被裁成「24」。
	   给个下限，装不下就横向滚 */
	min-width: 46rem;
	border-collapse: collapse;
	font-size: 0.82rem;
}

.table td {
	padding: 0.7rem 0.9rem;
	border-bottom: 1px solid var(--line-divider);
	vertical-align: middle;
	color: var(--fg-90);
	white-space: nowrap;
}

.table th {
	text-align: left;
	font-weight: 600;
	color: var(--fg-50);
	padding: 0.7rem 0.9rem;
	background: rgba(0, 0, 0, 0.03);
	border-bottom: 1px solid var(--line-divider);
	white-space: nowrap;
}

/* 深色下换中性白：带色相的底在纯黑卡片上会变成一条发绿的横带 */
:root.dark .table th {
	background: rgba(255, 255, 255, 0.05);
}

.table tbody tr {
	transition: background-color 0.12s ease;
}

.table tbody tr:hover {
	background: var(--btn-plain-bg-hover);
}

.table tr:last-child td {
	border-bottom: none;
}

.user-cell {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

/* 圆牌用主题色淡淡铺一层：整列都是「已注销用户」时，靠它才能一行一行扫下去 */
.avatar {
	flex: none;
	display: inline-grid;
	place-items: center;
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 999px;
	background: color-mix(in oklab, var(--primary) 13%, var(--btn-regular-bg));
	color: var(--accent-text);
	font-size: 0.78rem;
	font-weight: 700;
}

.avatar.gone {
	background: var(--btn-regular-bg);
	color: var(--fg-50);
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
	color: var(--fg-90);
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

/* 自己那一行：不摆一个点不动的下拉，直接写文字并标出为什么 */
.ro {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	font-size: 0.78rem;
	color: var(--fg-75);
	cursor: help;
}

.lock {
	font-size: 0.62rem;
	padding: 0.02rem 0.3rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-50);
}

.tiny {
	padding: 0.2rem 0.5rem;
	font-size: 0.74rem;
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
