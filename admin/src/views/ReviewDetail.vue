<script setup lang="ts">
/**
 * 单篇审稿页。队列里只有标题和摘要，判断不了抄袭、错字和夹带私货，
 * 所以审核必须先读全文。正文用 Vditor 的静态预览渲染——同一套渲染器，
 * 看到的和前台成稿基本一致，而且不会把用户写的标签当组件执行。
 */
import Vditor from "vditor";
import "vditor/dist/index.css";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { canReview } from "../lib/auth";
import { formatTime } from "../lib/posts";
import {
	approvePost,
	getQueuePost,
	type ReviewPost,
	rejectPost,
} from "../lib/review";
import { isDark } from "../lib/theme";
import { preloadVditorCore } from "../lib/vditor-preload";
import { go, route } from "../router";

const id = computed(() => route.value.id ?? 0);

const post = ref<ReviewPost | null>(null);
const loading = ref(true);
const rendering = ref(false);
const errorText = ref("");
const notice = ref("");
const busy = ref(false);
const rejecting = ref(false);
const rejectNote = ref("");
const bodyEl = ref<HTMLDivElement | null>(null);

/** 与 src/config/provenanceConfig.ts 的种类对齐；顺序决定展示文案 */
const PROV_LABEL: Record<string, string> = {
	handwritten: "本人手写",
	ghostwritten: "代笔",
	"co-written": "代笔 + 本人改写",
};

const PROV_TONE: Record<string, string> = {
	handwritten: "ok",
	ghostwritten: "warn",
	"co-written": "warn",
};

/** frontmatter 里 provenance 可能是字符串，也可能是 {kind, model, agent, note} */
const provenance = computed(() => {
	const raw = post.value?.meta?.provenance;
	if (typeof raw === "string") {
		return { label: PROV_LABEL[raw] ?? raw, tone: PROV_TONE[raw] ?? "" };
	}
	if (raw && typeof raw === "object") {
		const value = raw as Record<string, unknown>;
		const kind = typeof value.kind === "string" ? value.kind : "";
		const model = typeof value.model === "string" ? value.model : "";
		const agent = typeof value.agent === "string" ? value.agent : "";
		const note = typeof value.note === "string" ? value.note : "";
		const detail = [model, agent].filter(Boolean).join(" · ");
		const label =
			[PROV_LABEL[kind] ?? kind, detail].filter(Boolean).join(" · ") || "未标注";
		return { label: note ? `${label}（${note}）` : label, tone: PROV_TONE[kind] ?? "" };
	}
	return { label: "未标注", tone: "" };
});

const category = computed(() => {
	const value = post.value?.meta?.category;
	return typeof value === "string" ? value : "";
});

const wordCount = computed(() => post.value?.body.length ?? 0);

/**
 * 通过后真正会写进仓库的位置。
 * 不能用 row.repo_path——老数据的 repo_path 还停在早期设计（inbox/.../index.mdx），
 * 而 publishRowToRepo 实际写的是 src/content/posts/<slug>.md。
 */
const publishPath = computed(() =>
	post.value ? `src/content/posts/${post.value.slug}.md` : "",
);

async function renderBody(): Promise<void> {
	const target = bodyEl.value;
	const body = post.value?.body;
	if (!target || !body) return;
	rendering.value = true;
	try {
		await Vditor.preview(target, body, {
			mode: isDark.value ? "dark" : "light",
			cdn: "/admin/vditor",
			lang: "zh_CN",
			theme: { current: isDark.value ? "dark" : "light" },
			hljs: { style: isDark.value ? "monokai" : "github", lineNumber: true },
			math: { engine: "KaTeX" },
			anchor: 0,
		});
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "正文渲染失败";
	} finally {
		rendering.value = false;
	}
}

async function load(): Promise<void> {
	if (!canReview.value) {
		loading.value = false;
		return;
	}
	if (!id.value) {
		errorText.value = "地址里没有文章 id";
		loading.value = false;
		return;
	}
	loading.value = true;
	errorText.value = "";
	try {
		post.value = await getQueuePost(id.value);
		// 正文容器挂在「读取中」后面那个 v-else-if 分支里：
		// 先把 loading 放掉、等一轮 DOM，容器才真的存在
		loading.value = false;
		await nextTick();
		await renderBody();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}
}

async function onApprove(): Promise<void> {
	if (!post.value) return;
	busy.value = true;
	errorText.value = "";
	try {
		await approvePost(post.value.id);
		notice.value = `《${post.value.title}》已通过，约一分钟后上线`;
		setTimeout(() => go("/review"), 900);
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "操作失败";
	} finally {
		busy.value = false;
	}
}

async function onReject(): Promise<void> {
	if (!post.value) return;
	const note = rejectNote.value.trim();
	if (!note) {
		errorText.value = "写一句退回理由，作者才知道改什么";
		return;
	}
	busy.value = true;
	errorText.value = "";
	try {
		await rejectPost(post.value.id, note);
		notice.value = `《${post.value.title}》已退回`;
		setTimeout(() => go("/review"), 900);
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "操作失败";
	} finally {
		busy.value = false;
	}
}

/** 正文切换过深浅主题：Vditor 的预览不会自己重画，得重新渲染一遍 */
watch(isDark, () => {
	void renderBody();
});

let stopRoute: (() => void) | null = null;

onMounted(() => {
	// 直接开详情页（没有经过队列）时也得把渲染器预热上
	preloadVditorCore();
	void load();
	stopRoute = watch(id, () => void load());
});

onBeforeUnmount(() => {
	stopRoute?.();
	if (bodyEl.value) bodyEl.value.innerHTML = "";
});
</script>

<template>
	<div>
		<PageHeader title="审核稿件" desc="读完再决定；通过会写进仓库并触发构建。">
			<template #actions>
				<button type="button" class="btn-regular" @click="go('/review')">
					<AppIcon name="back" :size="15" />
					返回队列
				</button>
			</template>
		</PageHeader>

		<p v-if="errorText" class="error">{{ errorText }}</p>
		<p v-else-if="notice" class="notice">{{ notice }}</p>

		<p v-if="!canReview" class="state">审核只对审核员与管理员开放。</p>
		<p v-else-if="loading" class="state">读取中…</p>

		<div v-else-if="post" class="review">
			<article class="card-base doc">
				<header class="doc-head">
					<h1 class="doc-title">{{ post.title }}</h1>

					<div class="doc-chips">
						<span class="chip author">
							<img
								v-if="post.author_avatar"
								class="chip-avatar"
								:src="post.author_avatar"
								alt=""
							/>
							<span>{{ post.author }}</span>
							<code v-if="post.author_account">{{ post.author_account }}</code>
						</span>
						<span class="chip">提交于 {{ formatTime(post.submitted_at) }}</span>
						<span class="chip">{{ wordCount }} 字</span>
						<span v-if="category" class="chip">{{ category }}</span>
						<span v-if="post.source_link" class="chip warn">
							转载自 {{ post.source_link }}
						</span>
						<span class="chip" :class="provenance.tone">{{ provenance.label }}</span>
					</div>

					<p v-if="post.summary" class="doc-summary">{{ post.summary }}</p>

					<div v-if="post.tags.length" class="doc-tags">
						<span v-for="tag in post.tags" :key="tag" class="tag">{{ tag }}</span>
					</div>

					<p class="doc-slug">
						<code>{{ publishPath }}</code>
					</p>
				</header>

				<div class="doc-body">
					<div ref="bodyEl" class="preview" />
					<p v-if="rendering" class="state">
						正在渲染正文…（渲染器约 3 MB，首次打开要等一会儿，之后走缓存）
					</p>
					<p v-if="!rendering && wordCount === 0" class="state">
						这篇没有正文，只有标题和摘要。
					</p>
				</div>
			</article>

			<aside class="card-base side">
				<p class="side-title">审核操作</p>

				<template v-if="!rejecting">
					<button
						type="button"
						class="btn-primary full"
						:disabled="busy"
						@click="onApprove"
					>
						通过并发布
					</button>
					<button
						type="button"
						class="btn-regular full"
						:disabled="busy"
						@click="rejecting = true"
					>
						退回
					</button>
					<p class="hint">
						通过会写到 <code>{{ publishPath }}</code
						>，构建约 1 分钟后线上可见。
					</p>
				</template>

				<template v-else>
					<label class="side-label" for="reject-note">退回理由</label>
					<textarea
						id="reject-note"
						v-model="rejectNote"
						class="field area"
						rows="5"
						maxlength="200"
						placeholder="作者在「我的文章」里能看到这句，说清楚改什么"
					/>
					<div class="side-actions">
						<button
							type="button"
							class="btn-primary"
							:disabled="busy"
							@click="onReject"
						>
							确认退回
						</button>
						<button
							type="button"
							class="btn-ghost"
							:disabled="busy"
							@click="
								rejecting = false;
								rejectNote = '';
							"
						>
							取消
						</button>
					</div>
				</template>
			</aside>
		</div>
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
	padding: 1.4rem 1rem;
	text-align: center;
	font-size: 0.85rem;
	color: var(--fg-50);
}

.review {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 15rem;
	gap: 1rem;
	align-items: start;
}

.doc {
	padding: 1.5rem 1.6rem 1.8rem;
	min-width: 0;
}

.doc-head {
	padding-bottom: 1rem;
	border-bottom: 1px solid var(--line-divider);
}

.doc-title {
	margin: 0;
	font-size: 1.35rem;
	font-weight: 700;
	line-height: 1.35;
	color: var(--fg-90);
	letter-spacing: -0.01em;
}

.doc-chips {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem;
	margin-top: 0.6rem;
}

.chip {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	padding: 0.14rem 0.5rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-75);
	font-size: 0.72rem;
	line-height: 1.6;
	/* 代笔声明可能带模型名和备注，窄屏必须能换行，否则整页横向滚动 */
	max-width: 100%;
	flex-wrap: wrap;
	overflow-wrap: anywhere;
}

.chip code {
	font-size: 0.68rem;
	color: var(--fg-50);
}

.chip-avatar {
	width: 1.1rem;
	height: 1.1rem;
	border-radius: 999px;
	object-fit: cover;
}

.chip.ok {
	background: color-mix(in oklab, var(--admonitions-color-tip) 16%, transparent);
	color: var(--admonitions-color-tip);
}

.chip.warn {
	background: color-mix(
		in oklab,
		var(--admonitions-color-caution) 16%,
		transparent
	);
	color: var(--admonitions-color-caution);
}

.doc-summary {
	margin: 0.7rem 0 0;
	font-size: 0.83rem;
	line-height: 1.75;
	color: var(--fg-75);
}

.doc-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
	margin-top: 0.55rem;
}

.tag {
	padding: 0.1rem 0.45rem;
	border-radius: 0.4rem;
	border: 1px solid var(--line-divider);
	color: var(--fg-50);
	font-size: 0.7rem;
}

.doc-slug {
	margin: 0.6rem 0 0;
	font-size: 0.7rem;
	color: var(--fg-50);
}

.doc-slug code {
	font-size: 0.7rem;
}

.doc-body {
	padding-top: 1.2rem;
}

/* Vditor 预览自己不设宽度，跟着容器走；字号按正文字号收一档 */
.preview :deep(.vditor-reset) {
	font-size: 0.95rem;
	line-height: 1.85;
	color: var(--fg-90);
	padding: 0;
}

.preview :deep(.vditor-reset img) {
	max-width: 100%;
	border-radius: 0.5rem;
}

.preview :deep(.vditor-reset pre) {
	border-radius: 0.6rem;
	/* 长代码行自己横向滚动，不然会把整页撑出横向滚动条 */
	overflow-x: auto;
	max-width: 100%;
}

.preview :deep(.vditor-reset table) {
	max-width: 100%;
	overflow-x: auto;
}

.side {
	position: sticky;
	top: 0;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	padding: 0.9rem 0.95rem 1rem;
}

.side-title {
	margin: 0;
	font-size: 0.78rem;
	font-weight: 600;
	color: var(--fg-90);
}

.side-label {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.full {
	width: 100%;
}

.area {
	min-height: 6rem;
	resize: vertical;
	font-size: 0.78rem;
	line-height: 1.6;
}

.side-actions {
	display: flex;
	gap: 0.4rem;
}

.hint {
	margin: 0.1rem 0 0;
	font-size: 0.7rem;
	line-height: 1.65;
	color: var(--fg-50);
}

.hint code {
	font-size: 0.66rem;
	word-break: break-all;
}

@media (max-width: 900px) {
	.review {
		grid-template-columns: minmax(0, 1fr);
	}

	.side {
		position: static;
		order: -1;
	}

	.doc {
		padding: 1.1rem 1rem 1.3rem;
	}
}
</style>
