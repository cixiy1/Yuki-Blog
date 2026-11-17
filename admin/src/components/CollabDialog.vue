<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { ApiError } from "../lib/api";
import {
	type CollabMember,
	getCollab,
	inviteCollab,
	revokeCollab,
} from "../lib/collab";
import AppIcon from "./AppIcon.vue";

/**
 * 协作名单。
 *
 * 只做一件事：把这一篇的编辑权借给谁、借给过谁、还能收回谁。
 * 邀请按登录名精确匹配——昵称会重名，登录名不会。
 */
const props = defineProps<{ slug: string; canManage: boolean }>();
const emit = defineEmits<{ close: []; changed: [count: number] }>();

const members = ref<CollabMember[]>([]);
const limit = ref(8);
const loading = ref(true);
const busy = ref(false);
const errorText = ref("");
const account = ref("");
const inputEl = ref<HTMLInputElement | null>(null);

const canInvite = computed(
	() => props.canManage && members.value.length < limit.value && !busy.value,
);

async function load(): Promise<void> {
	loading.value = true;
	errorText.value = "";
	try {
		const state = await getCollab(props.slug);
		members.value = state.members;
		limit.value = state.limit;
	} catch (err) {
		errorText.value = err instanceof ApiError ? err.message : "读不到协作名单";
	} finally {
		loading.value = false;
	}
}

async function onInvite(): Promise<void> {
	const name = account.value.trim();
	if (!name || busy.value) return;
	busy.value = true;
	errorText.value = "";
	try {
		const result = await inviteCollab(props.slug, name);
		members.value = result.members;
		account.value = "";
		emit("changed", result.members.length);
	} catch (err) {
		errorText.value = err instanceof ApiError ? err.message : "邀请失败";
	} finally {
		busy.value = false;
	}
}

async function onRevoke(member: CollabMember): Promise<void> {
	if (busy.value) return;
	busy.value = true;
	errorText.value = "";
	try {
		const result = await revokeCollab(props.slug, member.uid);
		members.value = result.members;
		emit("changed", result.members.length);
	} catch (err) {
		errorText.value = err instanceof ApiError ? err.message : "移除失败";
	} finally {
		busy.value = false;
	}
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape") emit("close");
}

onMounted(async () => {
	window.addEventListener("keydown", onKeydown);
	await load();
	await nextTick();
	inputEl.value?.focus();
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function who(member: CollabMember): string {
	return member.display_name || member.account;
}
</script>

<template>
	<div class="cl-mask" @click.self="emit('close')">
		<div class="cl-dialog" role="dialog" aria-modal="true" aria-label="协作">
			<div class="cl-head">
				<div>
					<h2 class="cl-title">协作</h2>
					<p class="cl-tip">
						名单里的人能改这一篇的正文与属性，但删文章、改可见范围、邀请别人都不行。
					</p>
				</div>
				<button type="button" class="cl-x" aria-label="关闭" @click="emit('close')">
					<AppIcon name="close" :size="16" />
				</button>
			</div>

			<div v-if="canManage" class="cl-invite">
				<input
					ref="inputEl"
					v-model="account"
					class="cl-input"
					type="text"
					placeholder="对方的登录名"
					:disabled="!canInvite"
					@keydown.enter.prevent="onInvite"
				/>
				<button
					type="button"
					class="btn-primary"
					:disabled="!canInvite || !account.trim()"
					@click="onInvite"
				>
					邀请
				</button>
			</div>

			<p v-if="errorText" class="cl-error">{{ errorText }}</p>

			<div class="cl-body">
				<p v-if="loading" class="cl-empty">读取中…</p>
				<p v-else-if="members.length === 0" class="cl-empty">
					还没有协作者。邀请之后，对方在「我的文章」里就能看到这一篇。
				</p>
				<ul v-else class="cl-list">
					<li v-for="member in members" :key="member.uid" class="cl-row">
						<span class="cl-avatar">
							<img
								v-if="member.avatar_url"
								:src="member.avatar_url"
								:alt="who(member)"
							/>
							<span v-else>{{ who(member).slice(0, 1) }}</span>
						</span>
						<span class="cl-text">
							<span class="cl-name">{{ who(member) }}</span>
							<span class="cl-account">@{{ member.account }} · uid {{ member.uid }}</span>
						</span>
						<button
							v-if="canManage"
							type="button"
							class="btn-ghost danger"
							:disabled="busy"
							@click="onRevoke(member)"
						>
							移除
						</button>
					</li>
				</ul>
			</div>

			<div class="cl-foot">
				<span>{{ members.length }} / {{ limit }}</span>
				<span v-if="!canManage">名单只有作者与管理员能改</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
.cl-mask {
	position: fixed;
	inset: 0;
	z-index: 200;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2vh 2vw;
	background: rgb(0 0 0 / 45%);
	backdrop-filter: blur(2px);
}

.cl-dialog {
	display: flex;
	flex-direction: column;
	width: min(30rem, 96vw);
	max-height: min(32rem, 90vh);
	overflow: hidden;
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
}

.cl-head {
	display: flex;
	flex: none;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.85rem 1rem;
	border-bottom: 1px solid var(--line-divider);
}

.cl-title {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 600;
	color: var(--fg-90);
}

.cl-tip {
	margin: 0.2rem 0 0;
	font-size: 0.72rem;
	line-height: 1.6;
	color: var(--fg-50);
}

.cl-x {
	display: grid;
	flex: none;
	width: 1.9rem;
	height: 1.9rem;
	place-items: center;
	border: 0;
	border-radius: var(--radius-md);
	background: transparent;
	color: var(--fg-50);
	cursor: pointer;
}

.cl-x:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.cl-invite {
	display: flex;
	flex: none;
	gap: 0.4rem;
	padding: 0.7rem 1rem;
	border-bottom: 1px solid var(--line-divider);
}

.cl-input {
	flex: 1;
	min-width: 0;
	padding: 0.4rem 0.6rem;
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-md);
	background: var(--btn-plain-bg);
	font-size: 0.8rem;
	color: var(--fg-90);
}

.cl-input:focus {
	outline: 2px solid color-mix(in oklab, var(--primary) 55%, transparent);
	outline-offset: 1px;
}

.cl-error {
	margin: 0.55rem 1rem 0;
	font-size: 0.75rem;
	color: var(--admonitions-color-caution);
}

.cl-body {
	flex: 1;
	min-height: 6rem;
	overflow-y: auto;
	padding: 0.35rem 0;
}

.cl-empty {
	margin: 0;
	padding: 1.5rem 1rem;
	font-size: 0.78rem;
	line-height: 1.7;
	color: var(--fg-50);
	text-align: center;
}

.cl-list {
	list-style: none;
	margin: 0;
	padding: 0;
}

.cl-row {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	padding: 0.45rem 1rem;
}

.cl-avatar {
	display: grid;
	flex: none;
	width: 1.75rem;
	height: 1.75rem;
	place-items: center;
	overflow: hidden;
	border-radius: 50%;
	background: var(--btn-regular-bg);
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--fg-75);
}

.cl-avatar img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.cl-text {
	display: flex;
	flex-direction: column;
	gap: 0.05rem;
	min-width: 0;
}

.cl-name {
	font-size: 0.82rem;
	font-weight: 600;
	color: var(--fg-90);
}

.cl-account {
	font-size: 0.68rem;
	color: var(--fg-50);
}

.cl-row .btn-ghost {
	margin-left: auto;
}

.cl-foot {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.5rem 1rem;
	border-top: 1px solid var(--line-divider);
	font-size: 0.68rem;
	color: var(--fg-50);
}
</style>
