<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ApiError } from "../lib/api";
import { ACTION_LABEL } from "../lib/audit";
import {
	type AdminUser,
	type AuditEntry,
	createUser,
	deleteUser,
	formatTime,
	getUser,
	patchUser,
	ROLE_LABEL,
	STATUS_LABEL,
} from "../lib/users";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
	mode: "create" | "edit";
	user?: AdminUser | null;
	selfUid?: number;
}>();
const emit = defineEmits<{
	close: [];
	saved: [AdminUser];
	deleted: [number];
}>();

const account = ref("");
const email = ref("");
const displayName = ref("");
const password = ref("");
const role = ref("user");
const status = ref("active");

const busy = ref("");
const errorText = ref("");
const notice = ref("");
const audit = ref<AuditEntry[]>([]);
const confirmingDelete = ref(false);
const deleteConfirmText = ref("");

const isEdit = computed(() => props.mode === "edit");
const target = computed(() => props.user ?? null);
/** 自己那一行：角色、状态、密码都不在这里改，后端也会拒 */
const isSelf = computed(() =>
	Boolean(target.value && props.selfUid && target.value.uid === props.selfUid),
);

function reset(): void {
	const user = props.user;
	account.value = user?.account ?? "";
	email.value = user?.email ?? "";
	displayName.value = user?.display_name ?? "";
	password.value = "";
	role.value = user?.role ?? "user";
	status.value =
		user?.status === "deleted" ? "active" : (user?.status ?? "active");
	busy.value = "";
	errorText.value = "";
	notice.value = "";
	audit.value = [];
	confirmingDelete.value = false;
	deleteConfirmText.value = "";
}

watch(
	() => [props.mode, props.user?.uid],
	() => {
		reset();
		if (isEdit.value && props.user) void loadAudit(props.user.uid);
	},
	{ immediate: true },
);

async function loadAudit(uid: number): Promise<void> {
	try {
		const data = await getUser(uid);
		audit.value = data.audit ?? [];
		// 详情接口比列表新：顺带把资料刷一遍，避免拿着旧值去 PATCH
		email.value = data.user.email;
		displayName.value = data.user.display_name;
	} catch {
		// 审计拿不到不影响编辑
	}
}

function fail(error: unknown, fallback: string): void {
	errorText.value =
		error instanceof ApiError
			? error.message
			: error instanceof Error
				? error.message
				: fallback;
}

async function submit(): Promise<void> {
	if (busy.value) return;
	errorText.value = "";
	notice.value = "";

	if (!isEdit.value) {
		busy.value = "save";
		try {
			const created = await createUser({
				account: account.value.trim(),
				email: email.value.trim(),
				display_name: displayName.value.trim() || undefined,
				password: password.value,
				role: role.value,
				status: status.value === "pending" ? "pending" : "active",
			});
			emit("saved", created);
			emit("close");
		} catch (error) {
			fail(error, "创建失败");
		} finally {
			busy.value = "";
		}
		return;
	}

	const user = target.value;
	if (!user) return;
	const patch: Record<string, string> = {};
	if (
		displayName.value.trim() &&
		displayName.value.trim() !== user.display_name
	) {
		patch.display_name = displayName.value.trim();
	}
	if (email.value.trim() && email.value.trim() !== user.email) {
		patch.email = email.value.trim();
	}
	if (!isSelf.value && role.value !== user.role) patch.role = role.value;
	if (!isSelf.value && status.value !== user.status)
		patch.status = status.value;

	if (Object.keys(patch).length === 0) {
		notice.value = "没有改动。";
		return;
	}

	busy.value = "save";
	try {
		const updated = await patchUser(user.uid, patch);
		notice.value = "已保存。";
		emit("saved", updated);
	} catch (error) {
		fail(error, "保存失败");
	} finally {
		busy.value = "";
	}
}

/** 重置密码单独走一次：它会把对方所有设备踢下线，不能混在「保存资料」里悄悄做 */
async function resetPassword(): Promise<void> {
	const user = target.value;
	if (!user || busy.value) return;
	if (password.value.length < 8) {
		errorText.value = "密码至少 8 位，且要有字母和数字。";
		return;
	}
	busy.value = "password";
	errorText.value = "";
	try {
		const updated = await patchUser(user.uid, { password: password.value });
		password.value = "";
		notice.value = "密码已重置，对方所有设备已退出登录。";
		emit("saved", updated);
	} catch (error) {
		fail(error, "重置失败");
	} finally {
		busy.value = "";
	}
}

async function remove(): Promise<void> {
	const user = target.value;
	if (!user || busy.value) return;
	if (deleteConfirmText.value.trim() !== user.account) {
		errorText.value = "输入的登录名不一致";
		return;
	}
	busy.value = "delete";
	errorText.value = "";
	try {
		await deleteUser(user.uid);
		emit("deleted", user.uid);
		emit("close");
	} catch (error) {
		fail(error, "删除失败");
	} finally {
		busy.value = "";
	}
}

const title = computed(() => (isEdit.value ? "用户详情" : "新建用户"));
const auditText = computed(() =>
	audit.value.slice(0, 6).map((item) => ({
		id: item.id,
		action: item.action,
		label: ACTION_LABEL[item.action] ?? item.action,
		at: formatTime(item.created_at),
	})),
);
</script>

<template>
	<Teleport to="body">
		<div class="mask" @click.self="emit('close')">
			<aside class="panel" role="dialog" aria-modal="true">
				<header class="panel-head">
					<div>
						<h2>{{ title }}</h2>
						<p v-if="isEdit && target" class="sub">
							@{{ target.account }} · uid {{ target.uid }}
						</p>
					</div>
					<button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')">
						<AppIcon name="back" :size="16" />
					</button>
				</header>

				<div class="panel-body">
					<p v-if="notice" class="notice">{{ notice }}</p>
					<p v-if="errorText" class="error">{{ errorText }}</p>

					<template v-if="!isEdit">
						<label class="row">
							<span>登录名</span>
							<input v-model="account" class="field" placeholder="3–20 位小写字母/数字/下划线" />
						</label>
						<label class="row">
							<span>邮箱</span>
							<input v-model="email" class="field" type="email" placeholder="用于登录与找回密码" />
						</label>
						<label class="row">
							<span>昵称</span>
							<input v-model="displayName" class="field" placeholder="留空就用登录名" />
						</label>
						<label class="row">
							<span>初始密码</span>
							<input v-model="password" class="field" type="password" placeholder="至少 8 位，含字母和数字" />
						</label>
					</template>

					<template v-else-if="target">
						<label class="row">
							<span>昵称</span>
							<input v-model="displayName" class="field" />
						</label>
						<label class="row">
							<span>邮箱</span>
							<input v-model="email" class="field" type="email" />
						</label>
						<p class="hint">
							改邮箱后要重新验证；验证状态：
							{{ target.email_verified ? "已验证" : "未验证" }}
						</p>
					</template>

					<div class="grid">
						<label class="row">
							<span>角色</span>
							<select v-if="!isSelf" v-model="role" class="field">
								<option value="user">{{ ROLE_LABEL.user }}</option>
								<option value="reviewer">{{ ROLE_LABEL.reviewer }}</option>
								<option value="admin">{{ ROLE_LABEL.admin }}</option>
							</select>
							<span v-else class="ro">
								{{ ROLE_LABEL[role] ?? role }}
								<span class="lock">锁</span>
							</span>
						</label>
						<label class="row">
							<span>状态</span>
							<select v-if="!isSelf" v-model="status" class="field">
								<option value="pending">{{ STATUS_LABEL.pending }}</option>
								<option value="active">{{ STATUS_LABEL.active }}</option>
								<option value="disabled">{{ STATUS_LABEL.disabled }}</option>
							</select>
							<span v-else class="ro">
								{{ STATUS_LABEL[status] ?? status }}
								<span class="lock">锁</span>
							</span>
						</label>
					</div>
					<p v-if="isSelf" class="hint">
						这是你自己的账号：角色和状态不能在页面改，避免把自己锁在门外。要调整就换另一个管理员账号操作，或直接改库。
					</p>

					<button
						type="button"
						class="btn-primary wide"
						:disabled="busy !== ''"
						@click="submit"
					>
						{{ busy === "save" ? "保存中…" : isEdit ? "保存资料" : "创建用户" }}
					</button>

					<template v-if="isEdit && target">
						<section class="block">
							<h3>重置密码</h3>
							<p class="hint">会立刻让该用户所有设备退出登录。改完把新密码线下告诉本人。</p>
							<div class="inline">
								<input
									v-model="password"
									class="field"
									type="password"
									placeholder="新密码，至少 8 位"
								/>
								<button
									type="button"
									class="btn-regular"
									:disabled="busy !== '' || isSelf"
									@click="resetPassword"
								>
									{{ busy === "password" ? "重置中…" : "重置" }}
								</button>
							</div>
						</section>

						<section class="block">
							<h3>最近操作</h3>
							<p v-if="auditText.length === 0" class="hint">没有记录。</p>
							<ul v-else class="audit">
								<li v-for="item in auditText" :key="item.id">
									<span class="mono" :title="item.action">{{ item.label }}</span>
									<span class="dim">{{ item.at }}</span>
								</li>
							</ul>
						</section>

						<section class="block danger-zone">
							<h3>删除账号</h3>
							<p class="hint">
								软删除：账号名与邮箱会释放，本人可以重新注册；历史审计保留。
							</p>
							<button
								v-if="!confirmingDelete"
								type="button"
								class="btn-ghost danger"
								:disabled="isSelf"
								@click="confirmingDelete = true"
							>
								<AppIcon name="trash" :size="15" /> 删除这个用户
							</button>
							<template v-else>
								<p class="hint">
									输入登录名 <b>{{ target.account }}</b> 确认：
								</p>
								<div class="inline">
									<input v-model="deleteConfirmText" class="field" :placeholder="target.account" />
									<button
										type="button"
										class="btn-ghost danger"
										:disabled="busy !== ''"
										@click="remove"
									>
										{{ busy === "delete" ? "删除中…" : "确认删除" }}
									</button>
								</div>
							</template>
						</section>
					</template>
				</div>
			</aside>
		</div>
	</Teleport>
</template>

<style scoped>
.mask {
	position: fixed;
	inset: 0;
	z-index: 60;
	background: rgb(0 0 0 / 0.36);
	display: flex;
	justify-content: flex-end;
}

.panel {
	width: min(26rem, 100vw);
	height: 100%;
	background: var(--card-bg);
	border-left: 1px solid var(--line-divider);
	display: flex;
	flex-direction: column;
	box-shadow: -12px 0 32px rgb(0 0 0 / 0.12);
}

.panel-head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 1rem 1.1rem 0.8rem;
	border-bottom: 1px solid var(--line-divider);
}

.panel-head h2 {
	margin: 0;
	font-size: 1.02rem;
}

.sub {
	margin: 0.15rem 0 0;
	font-size: 0.75rem;
	color: var(--fg-50);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.icon-btn {
	border: 0;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 0.55rem;
	display: grid;
	place-items: center;
	cursor: pointer;
}

/* 关闭按钮用返回图标，转 180° 就是「收起」 */
.icon-btn :deep(svg) {
	transform: rotate(180deg);
}

.panel-body {
	flex: 1;
	min-height: 0;
	overflow: auto;
	padding: 1rem 1.1rem 2rem;
	display: flex;
	flex-direction: column;
	gap: 0.7rem;
}

.row {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	font-size: 0.78rem;
	color: var(--fg-75);
}

.row .field {
	height: 2.3rem;
}

/* 自己那行不能改：渲染成只读块，别做成看起来能点的灰下拉 */
.ro {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	height: 2.3rem;
	padding: 0 0.7rem;
	border-radius: 0.6rem;
	background: var(--btn-plain-bg-hover);
	color: var(--fg-75);
	font-size: 0.82rem;
}

.lock {
	padding: 0.02rem 0.28rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.62rem;
}

.grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 0.6rem;
}

.wide {
	width: 100%;
	height: 2.35rem;
	margin-top: 0.2rem;
}

.hint {
	margin: 0;
	font-size: 0.73rem;
	line-height: 1.6;
	color: var(--fg-50);
}

.notice {
	margin: 0;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.78rem;
}

.error {
	margin: 0;
	padding: 0.45rem 0.7rem;
	border-radius: 0.6rem;
	background: color-mix(in oklab, var(--admonitions-color-caution) 14%, transparent);
	color: var(--admonitions-color-caution);
	font-size: 0.78rem;
}

.block {
	margin-top: 0.6rem;
	padding-top: 0.8rem;
	border-top: 1px solid var(--line-divider);
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.block h3 {
	margin: 0;
	font-size: 0.82rem;
}

.inline {
	display: flex;
	gap: 0.4rem;
}

.inline .field {
	flex: 1;
	height: 2.2rem;
}

.inline .btn-regular {
	height: 2.2rem;
	white-space: nowrap;
}

.audit {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
}

.audit li {
	display: flex;
	justify-content: space-between;
	gap: 0.6rem;
	font-size: 0.72rem;
}

.mono {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	color: var(--fg-75);
}

.dim {
	color: var(--fg-50);
	white-space: nowrap;
}

.danger-zone h3 {
	color: var(--admonitions-color-caution);
}

.danger {
	color: var(--admonitions-color-caution);
}
</style>
