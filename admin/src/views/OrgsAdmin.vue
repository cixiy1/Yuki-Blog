<script setup lang="ts">
/**
 * 组织：建组、拉人、审邀请。
 *
 * 三件事挤在一个页面里是有意的：建完组织紧接着就要拉人，拉完人要盯着
 * 谁还没确认，拆成三个页面反而来回跳。
 *
 * 组织信息改完会同步一次仓库文件（`config/orgs.json`），也就是一次构建：
 * 所以保存成功的提示里必须写「1–2 分钟后 /orgs/ 才更新」，否则看起来像没存上。
 */
import { computed, onMounted, ref, watch } from "vue";
import AppIcon from "../components/AppIcon.vue";
import EmptyState from "../components/EmptyState.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import { isAdmin, user } from "../lib/auth";
import {
	acceptInvite,
	createOrg,
	declineInvite,
	deleteOrg,
	getInvite,
	getOrg,
	type InviteView,
	inviteOrgMember,
	listOrgs,
	type MailOutcome,
	type OrgDetail,
	type OrgInvite,
	type OrgSummary,
	removeOrgMember,
	revokeOrgInvite,
	setOrgMemberRole,
	updateOrg,
} from "../lib/orgs";
import { route } from "../router";

const loading = ref(true);
const error = ref("");
const orgs = ref<OrgSummary[]>([]);
const myInvites = ref<OrgInvite[]>([]);
const limit = ref(50);
const selectedId = ref<number | null>(null);
const detail = ref<OrgDetail | null>(null);
const detailLoading = ref(false);

/* 新建 */
const creating = ref(false);
const draft = ref({ slug: "", name: "", description: "", cover: "" });
const saving = ref(false);
const formError = ref("");
const notice = ref("");

/* 编辑 */
const editName = ref("");
const editDesc = ref("");
const editCover = ref("");
const editSaving = ref(false);

/* 拉人 */
const inviteAccount = ref("");
const inviting = ref(false);
const inviteNote = ref("");

/* 邀请落地页 */
const inviteView = ref<InviteView | null>(null);
const inviteError = ref("");
const responding = ref(false);

const canCreate = computed(() => isAdmin.value);

const ROLE_LABEL: Record<string, string> = {
	owner: "主人",
	admin: "管理员",
	member: "成员",
};

function mailText(outcome: MailOutcome): string {
	if (outcome === "sent") return "邀请已发出，通知邮件也寄出去了。";
	if (outcome === "no_email")
		return "邀请已发出，但对方账号没填邮箱，邮件没寄。";
	if (outcome === "no_mailer")
		return "邀请已发出，站点还没配置发信通道，邮件没寄。";
	return "邀请已发出，但通知邮件发送失败。";
}

function siteText(result: { site: boolean; warning?: string }): string {
	if (result.site)
		return "站点页面已同步，等这次构建完成（1–2 分钟）就会更新。";
	return result.warning
		? `组织本身已保存；${result.warning}`
		: "组织本身已保存；站点页面没同步，等下次构建才更新。";
}

async function load(): Promise<void> {
	loading.value = true;
	error.value = "";
	try {
		const data = await listOrgs();
		orgs.value = data.orgs;
		myInvites.value = data.invites;
		limit.value = data.limit;
		if (
			selectedId.value &&
			!orgs.value.some((org) => org.id === selectedId.value)
		) {
			selectedId.value = null;
			detail.value = null;
		}
		if (selectedId.value === null && orgs.value.length > 0) {
			selectedId.value = orgs.value[0].id;
		}
	} catch (err) {
		error.value = err instanceof Error ? err.message : "读取失败";
	} finally {
		loading.value = false;
	}
}

async function openOrg(id: number): Promise<void> {
	selectedId.value = id;
	detailLoading.value = true;
	detail.value = null;
	try {
		const data = await getOrg(id);
		detail.value = data;
		editName.value = data.org.name;
		editDesc.value = data.org.description;
		editCover.value = data.org.cover;
	} catch (err) {
		error.value = err instanceof Error ? err.message : "读取组织失败";
	} finally {
		detailLoading.value = false;
	}
}

watch(selectedId, (id) => {
	if (id) void openOrg(id);
});

async function doCreate(): Promise<void> {
	saving.value = true;
	formError.value = "";
	notice.value = "";
	try {
		const result = await createOrg({
			slug: draft.value.slug.trim(),
			name: draft.value.name.trim(),
			description: draft.value.description.trim(),
			cover: draft.value.cover.trim(),
		});
		notice.value = siteText(result.site);
		creating.value = false;
		draft.value = { slug: "", name: "", description: "", cover: "" };
		await load();
		if (result.org?.id) selectedId.value = result.org.id;
	} catch (err) {
		formError.value = err instanceof Error ? err.message : "创建失败";
	} finally {
		saving.value = false;
	}
}

async function doSaveOrg(): Promise<void> {
	if (!detail.value) return;
	editSaving.value = true;
	formError.value = "";
	notice.value = "";
	try {
		const result = await updateOrg(detail.value.org.id, {
			name: editName.value.trim(),
			description: editDesc.value.trim(),
			cover: editCover.value.trim(),
		});
		notice.value = siteText(result.site);
		await openOrg(detail.value.org.id);
		await load();
	} catch (err) {
		formError.value = err instanceof Error ? err.message : "保存失败";
	} finally {
		editSaving.value = false;
	}
}

async function doDelete(): Promise<void> {
	if (!detail.value) return;
	const org = detail.value.org;
	if (
		!window.confirm(
			`删掉「${org.name}」？成员与邀请会一起没掉，文章上的 org 字段会变成没有归属。`,
		)
	) {
		return;
	}
	editSaving.value = true;
	try {
		const result = await deleteOrg(org.id);
		notice.value = siteText(result.site);
		selectedId.value = null;
		detail.value = null;
		await load();
	} catch (err) {
		formError.value = err instanceof Error ? err.message : "删除失败";
	} finally {
		editSaving.value = false;
	}
}

async function doInvite(): Promise<void> {
	if (!detail.value) return;
	const account = inviteAccount.value.trim();
	if (!account) return;
	inviting.value = true;
	inviteNote.value = "";
	formError.value = "";
	try {
		const result = await inviteOrgMember(detail.value.org.id, account);
		inviteNote.value = mailText(result.mail);
		inviteAccount.value = "";
		detail.value = {
			...detail.value,
			members: result.members,
			invites: result.invites,
		};
	} catch (err) {
		formError.value = err instanceof Error ? err.message : "邀请失败";
	} finally {
		inviting.value = false;
	}
}

async function doRemove(uid: number, name: string): Promise<void> {
	if (!detail.value) return;
	if (
		!window.confirm(`把 ${name} 移出这个组织？他之后就看不到组内的私密文章了。`)
	)
		return;
	try {
		const result = await removeOrgMember(detail.value.org.id, uid);
		detail.value = {
			...detail.value,
			members: result.members,
			invites: result.invites,
		};
		await load();
	} catch (err) {
		formError.value = err instanceof Error ? err.message : "移除失败";
	}
}

async function doRole(uid: number, role: "admin" | "member"): Promise<void> {
	if (!detail.value) return;
	try {
		const result = await setOrgMemberRole(detail.value.org.id, uid, role);
		detail.value = { ...detail.value, members: result.members };
	} catch (err) {
		formError.value = err instanceof Error ? err.message : "改角色失败";
	}
}

async function doRevoke(inviteId: number): Promise<void> {
	if (!detail.value) return;
	try {
		const result = await revokeOrgInvite(detail.value.org.id, inviteId);
		detail.value = { ...detail.value, invites: result.invites };
	} catch (err) {
		formError.value = err instanceof Error ? err.message : "撤回失败";
	}
}

async function respond(token: string, agree: boolean): Promise<void> {
	responding.value = true;
	inviteError.value = "";
	try {
		if (agree) {
			const result = await acceptInvite(token);
			inviteView.value = null;
			inviteToken.value = "";
			notice.value = `已加入「${result.name}」。`;
			await load();
			if (result.slug) {
				const hit = orgs.value.find((org) => org.slug === result.slug);
				if (hit) selectedId.value = hit.id;
			}
		} else {
			await declineInvite(token);
			inviteView.value = null;
			inviteToken.value = "";
			notice.value = "已拒绝这次邀请。";
			await load();
		}
	} catch (err) {
		inviteError.value = err instanceof Error ? err.message : "处理失败";
	} finally {
		responding.value = false;
	}
}

/** 落地页用的 token：地址是 #/orgs/invite/<token>，接受/拒绝后清空 */
const inviteToken = ref(route.value.inviteToken ?? "");

async function loadInvite(token: string): Promise<void> {
	inviteError.value = "";
	inviteView.value = null;
	try {
		inviteView.value = await getInvite(token);
	} catch (err) {
		inviteError.value = err instanceof Error ? err.message : "这张邀请打不开";
	}
}

/** 落地页之外的入口：等我处理的邀请列表点同意/忽略（票就在列表里带回来了） */
function respondByInvite(invite: OrgInvite, agree: boolean): void {
	if (!invite.token) return;
	void respond(invite.token, agree);
}

onMounted(async () => {
	await load();
	if (inviteToken.value) await loadInvite(inviteToken.value);
});

watch(
	() => route.value.inviteToken,
	async (token) => {
		inviteToken.value = token ?? "";
		if (token) await loadInvite(token);
	},
);

/** 我自己的邀请在前，别人的组织列表在后；过期的不显示（服务端已过滤） */
const pendingCount = computed(() => myInvites.value.length);
const meUid = computed(() => user.value?.uid ?? 0);
</script>

<template>
	<div class="orgs">
		<PageHeader
			title="组织"
			desc="组织决定「谁能看我的文章」与「谁跟我一起改」。成员要自己点同意才算加入。"
		>
			<template #actions>
				<button
					v-if="canCreate"
					type="button"
					class="btn btn-primary"
					@click="creating = !creating"
				>
					<AppIcon name="plus" />
					新建组织
				</button>
			</template>
		</PageHeader>

		<p v-if="notice" class="orgs-note">{{ notice }}</p>
		<p v-if="error" class="orgs-note is-warn">{{ error }}</p>

		<!-- 邀请落地页：邮件里那个链接直接落到这里 -->
		<div v-if="inviteToken" class="orgs-card invite-card">
			<h2>你被邀请加入一个组织</h2>
			<template v-if="inviteView">
				<p class="invite-org">{{ inviteView.org.name }}</p>
				<p class="invite-meta">
					{{ inviteView.inviter }} 邀请 · {{ inviteView.expires_at.slice(0, 10) }} 前有效
				</p>
				<p v-if="!inviteView.mine" class="orgs-note is-warn">
					这张邀请不是发给当前账号的。
				</p>
				<p v-else-if="inviteView.expired" class="orgs-note is-warn">
					邀请已过期，请对方重新发一次。
				</p>
				<p v-else-if="inviteView.status !== 'pending'" class="orgs-note">
					这张邀请已经处理过了（{{ inviteView.status }}）。
				</p>
				<div v-if="inviteView.mine && !inviteView.expired && inviteView.status === 'pending'" class="invite-actions">
					<button type="button" class="btn btn-primary" :disabled="responding" @click="respond(inviteToken, true)">
						同意加入
					</button>
					<button type="button" class="btn" :disabled="responding" @click="respond(inviteToken, false)">
						拒绝
					</button>
				</div>
			</template>
			<p v-else-if="inviteError" class="orgs-note is-warn">{{ inviteError }}</p>
			<LoadingState v-else variant="block" :rows="2" label="读取邀请" />
		</div>

		<!-- 等我处理的邀请 -->
		<div v-if="pendingCount > 0 && !inviteToken" class="orgs-card">
			<h2>等你确认的邀请 <span class="orgs-count">{{ pendingCount }}</span></h2>
			<ul class="invite-list">
				<li v-for="invite in myInvites" :key="invite.id">
					<div class="invite-line">
						<span class="invite-who">{{ invite.org_name }}</span>
						<span class="orgs-sub">
							{{ invite.inviter || "管理员" }} 邀请 · {{ invite.expires_at.slice(0, 10) }} 前有效
						</span>
					</div>
					<div class="invite-actions">
						<button type="button" class="btn btn-primary" :disabled="responding" @click="respondByInvite(invite, true)">
							同意
						</button>
						<button type="button" class="btn" :disabled="responding" @click="respondByInvite(invite, false)">
							忽略
						</button>
					</div>
				</li>
			</ul>
			<p class="orgs-sub">「忽略」等于拒绝，对方会看到这张邀请已处理。</p>
		</div>

		<!-- 新建 -->
		<div v-if="creating && canCreate" class="orgs-card">
			<h2>新建组织</h2>
			<div class="orgs-form">
				<label>
					<span>地址（slug）</span>
					<input v-model="draft.slug" class="field" placeholder="embodied-ai" />
					<span class="orgs-hint">只能小写字母、数字与短横线，建好之后不能改：文章 frontmatter 用它指组织。</span>
				</label>
				<label>
					<span>名称</span>
					<input v-model="draft.name" class="field" placeholder="具身智能" />
				</label>
				<label>
					<span>简介</span>
					<textarea v-model="draft.description" class="field" rows="2" placeholder="一句话说明这个组在做什么（120 字内）" />
				</label>
				<label>
					<span>封面</span>
					<input v-model="draft.cover" class="field" placeholder="/assets/… 或 https://…（可留空）" />
				</label>
			</div>
			<p v-if="formError" class="orgs-note is-warn">{{ formError }}</p>
			<div class="orgs-actions">
				<button type="button" class="btn btn-primary" :disabled="saving" @click="doCreate">
					{{ saving ? "创建中…" : "创建" }}
				</button>
				<button type="button" class="btn" @click="creating = false">取消</button>
			</div>
		</div>

		<LoadingState v-if="loading" variant="list" :rows="3" label="读取组织" />

		<template v-else>
			<EmptyState
				v-if="orgs.length === 0"
				title="还没有组织"
				desc="组织把一组文章和一组人绑在一起：组内成员能读你设为「组织可见」的文章，也能被整组邀请一起改稿。"
				icon="users"
			/>

			<div v-else class="orgs-layout">
				<ul class="orgs-list">
					<li v-for="org in orgs" :key="org.id">
						<button
							type="button"
							class="org-row"
							:class="{ on: org.id === selectedId }"
							@click="openOrg(org.id)"
						>
							<span class="org-name">{{ org.name }}</span>
							<span class="orgs-sub">
								{{ org.members }} 人 · {{ org.myRole ? ROLE_LABEL[org.myRole] : "非成员" }}
							</span>
						</button>
					</li>
				</ul>

				<div class="org-detail">
					<LoadingState v-if="detailLoading" variant="block" :rows="3" label="读取成员" />
					<template v-else-if="detail">
						<div class="orgs-card">
							<div class="org-head">
								<h2>{{ detail.org.name }}</h2>
								<code class="org-slug">org:{{ detail.org.slug }}</code>
							</div>
							<template v-if="detail.canManage">
								<div class="orgs-form">
									<label>
										<span>名称</span>
										<input v-model="editName" class="field" />
									</label>
									<label>
										<span>简介</span>
										<textarea v-model="editDesc" class="field" rows="2" />
									</label>
									<label>
										<span>封面</span>
										<input v-model="editCover" class="field" placeholder="/assets/… 或 https://…" />
									</label>
								</div>
								<div class="orgs-actions">
									<button type="button" class="btn btn-primary" :disabled="editSaving" @click="doSaveOrg">
										{{ editSaving ? "保存中…" : "保存" }}
									</button>
									<button
										v-if="isAdmin"
										type="button"
										class="btn is-danger"
										:disabled="editSaving"
										@click="doDelete"
									>
										删除组织
									</button>
								</div>
							</template>
							<p v-else class="orgs-sub">
								你不是这个组织的管理者，只能看成员名单。
							</p>
						</div>

						<div class="orgs-card">
							<h2>
								成员 <span class="orgs-count">{{ detail.members.length }} / {{ detail.limit }}</span>
							</h2>
							<ul class="org-members">
								<li v-for="member in detail.members" :key="member.uid">
									<span class="member-avatar">
										<img v-if="member.avatar_url" :src="member.avatar_url" alt="" />
										<AppIcon v-else name="users" />
									</span>
									<span class="member-name">
										{{ member.display_name || member.account }}
										<span class="orgs-sub">@{{ member.account }}</span>
									</span>
									<span class="member-role">{{ ROLE_LABEL[member.role] || member.role }}</span>
									<span v-if="detail.canManage && member.role !== 'owner' && member.uid !== meUid" class="member-ops">
										<button
											type="button"
											class="btn btn-mini"
											@click="doRole(member.uid, member.role === 'admin' ? 'member' : 'admin')"
										>
											{{ member.role === "admin" ? "取消管理员" : "设为管理员" }}
										</button>
										<button type="button" class="btn btn-mini is-danger" @click="doRemove(member.uid, member.display_name || member.account)">
											移出
										</button>
									</span>
								</li>
							</ul>

							<template v-if="detail.canManage">
								<div class="invite-box">
									<input
										v-model="inviteAccount"
										class="field"
										placeholder="对方的登录名，如 yukiho"
										@keyup.enter="doInvite"
									/>
									<button type="button" class="btn btn-primary" :disabled="inviting" @click="doInvite">
										{{ inviting ? "发送中…" : "邀请" }}
									</button>
								</div>
								<p class="orgs-hint">
									邀请会发一封邮件，对方在站内点「同意」才进组；名额上限 {{ detail.limit }} 人。
								</p>
								<p v-if="inviteNote" class="orgs-note">{{ inviteNote }}</p>
							</template>
						</div>

						<div v-if="detail.canManage && detail.invites.length > 0" class="orgs-card">
							<h2>已邀请，等对方确认 <span class="orgs-count">{{ detail.invites.length }}</span></h2>
							<ul class="invite-list">
								<li v-for="invite in detail.invites" :key="invite.id">
									<div class="invite-line">
										<span class="invite-who">{{ invite.display_name || invite.account }}</span>
										<span class="orgs-sub">@{{ invite.account }} · {{ invite.expires_at.slice(0, 10) }} 前有效</span>
									</div>
									<button type="button" class="btn btn-mini" @click="doRevoke(invite.id)">撤回</button>
								</li>
							</ul>
						</div>

						<div class="orgs-card">
							<h2>怎么用</h2>
							<ul class="orgs-tips">
								<li>
									<strong>文章归属</strong>：编辑页「访问控制 → 所属组织」选这里，文章会出现在
									<code>/orgs/{{ detail.org.slug }}/</code>。
								</li>
								<li>
									<strong>组织可见</strong>：可见范围选「指定用户」，勾上这个组织，组内成员才能读。
								</li>
								<li>
									<strong>整组共创</strong>：文章编辑页的「协作」面板里可以按组织一次邀请全组。
								</li>
							</ul>
						</div>
					</template>
				</div>
			</div>
		</template>
	</div>
</template>

<style scoped>
.orgs {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.orgs-card {
	border: 1px solid var(--line-divider);
	border-radius: 0.9rem;
	padding: 1.1rem 1.25rem;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.orgs-card h2 {
	margin: 0;
	font-size: 1rem;
	font-weight: 700;
	color: var(--fg-90);
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.orgs-count {
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--primary);
	background: color-mix(in srgb, var(--primary) 12%, transparent);
	border-radius: 999px;
	padding: 0.05rem 0.5rem;
}

.orgs-note {
	margin: 0;
	font-size: 0.82rem;
	line-height: 1.7;
	color: var(--fg-70);
	background: color-mix(in srgb, var(--primary) 8%, transparent);
	border-radius: 0.6rem;
	padding: 0.5rem 0.75rem;
}

.orgs-note.is-warn {
	color: var(--fg-90);
	background: color-mix(in srgb, #e06c75 14%, transparent);
}

.orgs-sub {
	font-size: 0.75rem;
	color: var(--fg-50);
}

.orgs-hint {
	margin: 0;
	font-size: 0.75rem;
	line-height: 1.7;
	color: var(--fg-50);
}

.orgs-form {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
	gap: 0.75rem;
}

.orgs-form label {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	font-size: 0.78rem;
	color: var(--fg-70);
}

.orgs-actions {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.orgs-layout {
	display: grid;
	grid-template-columns: minmax(12rem, 16rem) 1fr;
	gap: 1rem;
	align-items: start;
}

@media (max-width: 900px) {
	.orgs-layout {
		grid-template-columns: 1fr;
	}
}

.orgs-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.org-row {
	width: 100%;
	text-align: left;
	border: 1px solid transparent;
	border-radius: 0.7rem;
	background: transparent;
	padding: 0.55rem 0.7rem;
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	cursor: pointer;
	transition: background 0.15s ease, border-color 0.15s ease;
}

.org-row:hover {
	background: color-mix(in srgb, var(--primary) 7%, transparent);
}

.org-row.on {
	border-color: var(--line-divider);
	background: color-mix(in srgb, var(--primary) 10%, transparent);
}

.org-name {
	font-size: 0.88rem;
	font-weight: 600;
	color: var(--fg-90);
}

.org-detail {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	min-width: 0;
}

.org-head {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	flex-wrap: wrap;
}

.org-slug {
	font-size: 0.72rem;
	color: var(--fg-50);
	background: color-mix(in srgb, var(--fg-90) 6%, transparent);
	border-radius: 0.4rem;
	padding: 0.1rem 0.4rem;
}

.org-members,
.invite-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
}

.org-members li,
.invite-list li {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	padding: 0.55rem 0;
	border-bottom: 1px dashed var(--line-divider);
	flex-wrap: wrap;
}

.org-members li:last-child,
.invite-list li:last-child {
	border-bottom: none;
}

.member-avatar {
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 999px;
	overflow: hidden;
	display: flex;
	align-items: center;
	justify-content: center;
	background: color-mix(in srgb, var(--primary) 12%, transparent);
	color: var(--primary);
	flex-shrink: 0;
}

.member-avatar img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.member-name {
	flex: 1;
	min-width: 0;
	font-size: 0.85rem;
	color: var(--fg-90);
	display: flex;
	flex-direction: column;
	gap: 0.05rem;
}

.member-role {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.member-ops {
	display: flex;
	gap: 0.35rem;
}

.invite-line {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
}

.invite-who {
	font-size: 0.85rem;
	font-weight: 600;
	color: var(--fg-90);
}

.invite-box {
	display: flex;
	gap: 0.5rem;
	align-items: center;
	flex-wrap: wrap;
}

.invite-actions {
	display: flex;
	gap: 0.5rem;
}

.invite-card {
	max-width: 34rem;
}

.invite-org {
	margin: 0;
	font-size: 1.05rem;
	font-weight: 700;
	color: var(--primary);
}

.invite-meta {
	margin: 0;
	font-size: 0.78rem;
	color: var(--fg-50);
}

.orgs-tips {
	margin: 0;
	padding-left: 1.1rem;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	font-size: 0.82rem;
	line-height: 1.75;
	color: var(--fg-70);
}

.btn-mini {
	font-size: 0.72rem;
	padding: 0.2rem 0.5rem;
}
</style>
