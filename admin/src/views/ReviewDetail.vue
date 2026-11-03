<script setup lang="ts">
/**
 * 单篇审稿页。队列里只有标题和摘要，判断不了抄袭、错字和夹带私货，
 * 所以审核必须先读全文。正文用 Vditor 的静态预览渲染——同一套渲染器，
 * 看到的和前台成稿基本一致，而且不会把用户写的标签当组件执行。
 *
 * 批注（划词写建议）挂在正文上，而不是只写一句总的退回理由：
 * 「这里改一下」作者不知道怎么改，「第三段这句数据要给出处」才可执行。
 */
import Vditor from "vditor";
import "vditor/dist/index.css";
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import { canReview } from "../lib/auth";
import { formatTime } from "../lib/posts";
import {
	addReviewNote,
	approvePost,
	deleteReviewNote,
	getQueuePost,
	type ReviewNote,
	type ReviewPost,
	rejectPost,
} from "../lib/review";
import { isDark } from "../lib/theme";
import { preloadVditorCore } from "../lib/vditor-preload";
import { go, route } from "../router";

const id = computed(() => route.value.id ?? 0);

const post = ref<ReviewPost | null>(null);
const notes = ref<ReviewNote[]>([]);
const loading = ref(true);
const rendering = ref(false);
const errorText = ref("");
const notice = ref("");
const busy = ref(false);
const rejecting = ref(false);
const rejectNote = ref("");
const bodyEl = ref<HTMLDivElement | null>(null);
/** Vditor 会把宿主元素本身变成 .vditor，所以再套一层子节点给它 */
const editorEl = ref<HTMLDivElement | null>(null);
let vditor: Vditor | null = null;

/** 划词后浮在选区上方的小按钮 */
const picker = ref({ show: false, top: 0, left: 0, quote: "" });
/** 批注输入框 */
const composing = ref(false);
const composerQuote = ref("");
const composerText = ref("");
const savingNote = ref(false);
/** 侧栏里高亮的那一条 */
const activeNote = ref<number | null>(null);
/** 有批注时通过要按两次 */
const approveAnyway = ref(false);

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
			[PROV_LABEL[kind] ?? kind, detail].filter(Boolean).join(" · ") ||
			"未标注";
		return {
			label: note ? `${label}（${note}）` : label,
			tone: PROV_TONE[kind] ?? "",
		};
	}
	return { label: "未标注", tone: "" };
});

const category = computed(() => {
	const value = post.value?.meta?.category;
	return typeof value === "string" ? value : "";
});

const wordCount = computed(() => post.value?.body.length ?? 0);
const isPending = computed(() => post.value?.status === "pending");

/**
 * 通过后真正会写进仓库的位置。
 * 不能用 row.repo_path——老数据的 repo_path 还停在早期设计（inbox/.../index.mdx），
 * 而 publishRowToRepo 实际写的是 src/content/posts/<slug>.md。
 */
const publishPath = computed(() =>
	post.value ? `src/content/posts/${post.value.slug}.md` : "",
);

function destroyEditor(): void {
	if (!vditor) return;
	try {
		vditor.destroy();
	} catch {
		// 视图已经卸下，销毁失败不影响下一次创建
	}
	vditor = null;
}

/**
 * 正文用写作页同款编辑器（Vditor 即时渲染）打开再禁用编辑：
 * 作者写的时候看到什么排版，审核读到的就是什么，划词拿到的文字与作者端一致。
 * 只读页不走 sv 模式——那是给 MDX 源码用的，行号栏没有阅读价值。
 */
function renderBody(): Promise<void> {
	const target = editorEl.value;
	const body = post.value?.body;
	if (!target || !body) {
		rendering.value = false;
		return Promise.resolve();
	}
	destroyEditor();
	target.innerHTML = "";
	rendering.value = true;

	return new Promise((resolve) => {
		let settled = false;
		const done = () => {
			if (settled) return;
			settled = true;
			rendering.value = false;
			markNotes();
			resolve();
		};
		// 渲染器没加载出来时不能一直挂在「正在渲染」
		const fallback = window.setTimeout(() => {
			vditor?.disabled();
			done();
		}, 8000);
		vditor = new Vditor(target, {
			cdn: "/admin/vditor",
			value: body,
			mode: "ir",
			lang: "zh_CN",
			theme: isDark.value ? "dark" : "classic",
			cache: { enable: false },
			toolbar: [],
			resize: { enable: false },
			counter: { enable: false },
			preview: {
				theme: { current: isDark.value ? "dark" : "light" },
				hljs: { style: isDark.value ? "monokai" : "github", lineNumber: true },
				math: { engine: "KaTeX" },
			},
			after: () => {
				// after 可能在构造函数返回前就触发，那时外层的 vditor 还是 null，
				// 推到微任务里，赋值已经完成，才禁得掉编辑
				queueMicrotask(() => {
					window.clearTimeout(fallback);
					vditor?.disabled();
					done();
				});
			},
		});
	});
}

/* ---------- 正文里的批注高亮 ---------- */

/** 正文真正落在编辑器渲染出来的 .vditor-reset 里，外层还套着编辑器骨架。
 *  Vditor 会同时建出 wysiwyg / sv / preview 几个面板，只有 ir 那份是当前可见的正文。 */
function noteRoot(): HTMLElement | null {
	return (
		bodyEl.value?.querySelector<HTMLElement>(".vditor-ir .vditor-reset") ?? null
	);
}

/**
 * 把已存在的批注标回正文。
 * 只按「第一处出现在单个文本节点里的完整匹配」处理：划词拿到的就是渲染后的可见文字，
 * 跨标签（比如加粗断开）的选区找不到就只留在右侧列表里，不做模糊匹配——
 * 高亮错地方的误导比不高亮更大。
 */
function markNotes(): void {
	const root = noteRoot();
	if (!root) return;

	for (const mark of Array.from(root.querySelectorAll("mark.yb-note"))) {
		const parent = mark.parentNode;
		if (!parent) continue;
		while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
		parent.removeChild(mark);
	}
	root.normalize();

	notes.value.forEach((note, index) => {
		const needle = note.quote.trim();
		if (!needle) return;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node = walker.nextNode() as Text | null;
		while (node) {
			const at = node.data.indexOf(needle);
			if (at >= 0) {
				const range = document.createRange();
				range.setStart(node, at);
				range.setEnd(node, at + needle.length);
				const mark = document.createElement("mark");
				mark.className = "yb-note";
				mark.dataset.noteId = String(note.id);
				mark.dataset.idx = String(index + 1);
				mark.title = note.note;
				mark.addEventListener("click", () => {
					activeNote.value = note.id;
				});
				try {
					range.surroundContents(mark);
				} catch {
					// 选区跨了元素边界：放弃这一条的高亮
				}
				return;
			}
			node = walker.nextNode() as Text | null;
		}
	});
}

/* ---------- 划词 → 写批注 ---------- */

function onBodyMouseUp(): void {
	const selection = window.getSelection();
	const root = noteRoot();
	if (!selection || selection.isCollapsed || !root) {
		picker.value.show = false;
		return;
	}
	const text = selection.toString().replace(/\s+/g, " ").trim();
	if (text.length < 2) {
		picker.value.show = false;
		return;
	}
	const anchor = selection.anchorNode;
	if (!anchor || !root.contains(anchor)) return;

	const rect = selection.getRangeAt(0).getBoundingClientRect();
	picker.value = {
		show: true,
		top: Math.max(rect.top - 42, 8),
		left: Math.min(
			Math.max(rect.left + rect.width / 2 - 48, 12),
			window.innerWidth - 120,
		),
		quote: text.slice(0, 300),
	};
}

function startCompose(): void {
	composerQuote.value = picker.value.quote;
	composerText.value = "";
	composing.value = true;
	picker.value.show = false;
	window.getSelection()?.removeAllRanges();
}

function cancelCompose(): void {
	composing.value = false;
	composerQuote.value = "";
	composerText.value = "";
}

async function saveNote(): Promise<void> {
	const note = composerText.value.trim();
	if (!composerQuote.value || !note) {
		errorText.value = "先选中一段原文，再写一句建议";
		return;
	}
	savingNote.value = true;
	errorText.value = "";
	try {
		const created = await addReviewNote(id.value, composerQuote.value, note);
		notes.value = [...notes.value, created];
		cancelCompose();
		await nextTick();
		markNotes();
		activeNote.value = created.id;
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败";
	} finally {
		savingNote.value = false;
	}
}

async function removeNote(note: ReviewNote): Promise<void> {
	if (!window.confirm("删掉这条批注？")) return;
	try {
		await deleteReviewNote(id.value, note.id);
		notes.value = notes.value.filter((row) => row.id !== note.id);
		await nextTick();
		markNotes();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "删除失败";
	}
}

/** 点侧栏的批注，滚到正文里对应的位置 */
function focusNote(note: ReviewNote): void {
	activeNote.value = note.id;
	const mark = bodyEl.value?.querySelector<HTMLElement>(
		`mark[data-note-id="${note.id}"]`,
	);
	mark?.scrollIntoView({ behavior: "smooth", block: "center" });
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
		const detail = await getQueuePost(id.value);
		post.value = detail;
		notes.value = detail.notes ?? [];
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
	if (notes.value.length > 0 && !approveAnyway.value) {
		approveAnyway.value = true;
		errorText.value = `还有 ${notes.value.length} 条批注没处理，确实要通过的话再点一次`;
		return;
	}
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
	if (!note && notes.value.length === 0) {
		errorText.value = "写一句总的退回理由，或者在正文里划词标几条建议";
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

/** 正文切换过深浅主题：Vditor 的实例不会自己换肤，得整个重建 */
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
	destroyEditor();
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

					<p v-if="post.status === 'pending'" class="doc-hint">
						选中正文里的一段话，可以就那段写一条建议。
					</p>
					<p v-else class="doc-hint warn">
						这篇当前状态是「{{ post.status }}」，批注仍可查看，但已不在待审队列里。
					</p>
				</header>

				<div class="doc-body">
					<div
						ref="bodyEl"
						class="review-editor"
						@mouseup="onBodyMouseUp"
					>
						<div ref="editorEl" class="editor-host" />
					</div>
					<p v-if="rendering" class="state">
						正在渲染正文…（渲染器约 3 MB，首次打开要等一会儿，之后走缓存）
					</p>
					<p v-else-if="wordCount === 0" class="state">
						这篇没有正文，只有标题和摘要。
					</p>
				</div>
			</article>

			<button
				v-if="picker.show"
				type="button"
				class="picker"
				:style="{ top: `${picker.top}px`, left: `${picker.left}px` }"
				@mousedown.prevent
				@click="startCompose"
			>
				<AppIcon name="plus" :size="14" />
				添加批注
			</button>

			<aside class="side card-base">
				<p class="side-title">审核操作</p>

				<template v-if="!rejecting">
					<button
						type="button"
						class="btn-regular full"
						:disabled="busy || !isPending"
						@click="rejecting = true"
					>
						打回修改
					</button>
					<button
						type="button"
						class="btn-primary full"
						:disabled="busy || !isPending"
						@click="onApprove"
					>
						{{ approveAnyway ? "确认通过" : "通过并发布" }}
					</button>
					<p class="hint">
						通过会写到 <code>{{ publishPath }}</code
						>，构建约 1 分钟后线上可见。
					</p>
				</template>

				<template v-else>
					<label class="side-label" for="reject-note">打回理由</label>
					<textarea
						id="reject-note"
						v-model="rejectNote"
						class="field area"
						rows="4"
						maxlength="200"
						:placeholder="
							notes.length
								? '可以留空：已写的批注会一并给作者看'
								: '作者在「我的文章」里能看到这句，说清楚改什么'
						"
					/>
					<div class="side-actions">
						<button
							type="button"
							class="btn-primary"
							:disabled="busy"
							@click="onReject"
						>
							确认打回
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
					<p class="hint">
						{{ notes.length }} 条批注会随打回一起给作者，理由是总评，可留空。
					</p>
				</template>

				<div class="side-split" />

				<p class="side-title">
					批注
					<span class="count">{{ notes.length }}</span>
				</p>

				<div v-if="composing" class="composer">
					<p class="composer-quote">「{{ composerQuote }}」</p>
					<textarea
						v-model="composerText"
						class="field area"
						rows="3"
						maxlength="300"
						placeholder="这段要怎么改：补出处、删掉、换个说法…"
					/>
					<div class="side-actions">
						<button
							type="button"
							class="btn-primary"
							:disabled="savingNote"
							@click="saveNote"
						>
							保存批注
						</button>
						<button type="button" class="btn-ghost" @click="cancelCompose">
							取消
						</button>
					</div>
				</div>

				<p v-if="!composing && notes.length === 0" class="hint">
					还没有批注。选中正文里的一段话即可添加。
				</p>

				<ul v-if="notes.length" class="notes">
					<li
						v-for="(note, index) in notes"
						:key="note.id"
						class="note"
						:class="{ on: activeNote === note.id }"
						@click="focusNote(note)"
					>
						<p class="note-quote">
							<span class="note-index">{{ index + 1 }}</span>
							{{ note.quote }}
						</p>
						<p class="note-text">{{ note.note }}</p>
						<div class="note-foot">
							<span>{{ note.reviewer }}</span>
							<button
								type="button"
								class="note-del"
								title="删除这条批注"
								@click.stop="removeNote(note)"
							>
								<AppIcon name="trash" :size="13" />
							</button>
						</div>
					</li>
				</ul>
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
	grid-template-columns: minmax(0, 1fr) 17rem;
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

.doc-hint {
	margin: 0.55rem 0 0;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.doc-hint.warn {
	color: var(--admonitions-color-caution);
}

.doc-body {
	padding-top: 1.2rem;
}

/* 编辑器骨架铺在卡片里：去掉 Vditor 自带的边框、底色、工具栏和固定高度，
   只留正文本身，读起来才像一篇文章而不是一个输入框 */
.review-editor :deep(.vditor) {
	height: auto !important;
	border: none;
	border-radius: 0;
	background: transparent;
}

.review-editor :deep(.vditor-toolbar),
.review-editor :deep(.vditor-resize) {
	display: none;
}

/* 只读页跟整页一起滚，编辑器内部不再另出一根滚动条 */
.review-editor :deep(.vditor-content) {
	height: auto !important;
	overflow: visible;
	background: transparent;
}

.review-editor :deep(.vditor-ir .vditor-reset) {
	/* Vditor 会给这个 pre 写内联 padding: 10px 35px，普通规则盖不住，
	   留着就是正文整体右缩 35px、左边空一块 */
	padding: 0 !important;
	background: transparent;
}

/* Vditor 把「不可编辑」画成 30% 透明 + 禁用光标，那是给编辑器的禁用态；
   审核员是要读，不是看一个置灰的框 */
.review-editor :deep(.vditor-ir pre.vditor-reset[contenteditable="false"]) {
	opacity: 1;
	cursor: auto;
}

/* ir 模式会把 # 、- 这类 Markdown 标记浮在正文里，写的时候有用，读的时候是噪音 */
.review-editor :deep(.vditor-ir .vditor-ir__marker) {
	display: none !important;
}

/* marker 藏了，块级伪元素还在（标题左边挂的「H1」「H2」） */
.review-editor :deep(.vditor-ir__node[data-marker]::before),
.review-editor :deep(.vditor-ir__node[data-marker]::after) {
	content: none !important;
}

/* 字号、行距与写作页的 .editor 保持一致，同一篇文章在两边读起来是同一个样子 */
.review-editor :deep(.vditor-reset) {
	font-size: 0.9rem;
	line-height: 1.7;
	color: var(--fg-90);
	padding: 0 !important;
}

.review-editor :deep(.vditor-reset img) {
	max-width: 100%;
	border-radius: 0.5rem;
}

.review-editor :deep(.vditor-reset pre) {
	border-radius: 0.6rem;
	/* 长代码行自己横向滚动，不然会把整页撑出横向滚动条 */
	overflow-x: auto;
	max-width: 100%;
}

.review-editor :deep(.vditor-reset table) {
	max-width: 100%;
	overflow-x: auto;
}

/* 批注高亮：黄色底 + 右上角序号，和 WPS 的批注是一个意思 */
.review-editor :deep(mark.yb-note) {
	position: relative;
	background: color-mix(in oklab, var(--admonitions-color-caution) 26%, transparent);
	color: inherit;
	border-radius: 0.2rem;
	padding: 0 0.1rem;
	cursor: pointer;
	box-decoration-break: clone;
}

.review-editor :deep(mark.yb-note::after) {
	content: attr(data-idx);
	position: absolute;
	top: -0.6rem;
	right: -0.45rem;
	min-width: 0.9rem;
	height: 0.9rem;
	padding: 0 0.15rem;
	border-radius: 999px;
	background: var(--admonitions-color-caution);
	color: var(--card-bg);
	font-size: 0.6rem;
	line-height: 0.9rem;
	text-align: center;
	font-weight: 600;
}

/* 划词后浮出来的「添加批注」 */
.picker {
	position: fixed;
	z-index: 40;
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.3rem 0.6rem;
	border: none;
	border-radius: 0.55rem;
	background: var(--primary);
	color: var(--card-bg);
	font-size: 0.75rem;
	cursor: pointer;
	box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

:root.dark .picker {
	color: rgba(0, 0, 0, 0.75);
}

.side {
	position: sticky;
	top: 0;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	padding: 0.9rem 0.95rem 1rem;
	max-height: calc(100vh - 2rem);
	overflow-y: auto;
}

.side-title {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	margin: 0;
	font-size: 0.78rem;
	font-weight: 600;
	color: var(--fg-90);
}

.side-title .count {
	padding: 0 0.35rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-50);
	font-size: 0.68rem;
	font-weight: 500;
}

.side-split {
	height: 1px;
	margin: 0.35rem 0 0.1rem;
	background: var(--line-divider);
}

.side-label {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.full {
	width: 100%;
}

.area {
	min-height: 5rem;
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

.composer {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	padding: 0.5rem;
	border-radius: 0.6rem;
	background: var(--btn-regular-bg);
}

.composer-quote {
	margin: 0;
	font-size: 0.72rem;
	line-height: 1.6;
	color: var(--fg-75);
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.notes {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.note {
	padding: 0.5rem 0.55rem;
	border-radius: 0.55rem;
	border: 1px solid var(--line-divider);
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.note:hover {
	background: var(--btn-plain-bg-hover);
}

.note.on {
	border-color: var(--primary);
	background: color-mix(in oklab, var(--primary) 8%, transparent);
}

.note-quote {
	margin: 0;
	font-size: 0.72rem;
	line-height: 1.6;
	color: var(--fg-50);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.note-index {
	display: inline-block;
	margin-right: 0.25rem;
	padding: 0 0.25rem;
	border-radius: 0.3rem;
	background: color-mix(in oklab, var(--admonitions-color-caution) 24%, transparent);
	color: var(--admonitions-color-caution);
	font-size: 0.64rem;
	font-weight: 600;
}

.note-text {
	margin: 0.3rem 0 0;
	font-size: 0.78rem;
	line-height: 1.65;
	color: var(--fg-90);
}

.note-foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 0.3rem;
	font-size: 0.66rem;
	color: var(--fg-50);
}

.note-del {
	display: grid;
	place-items: center;
	padding: 0.1rem;
	border: none;
	border-radius: 0.35rem;
	background: none;
	color: var(--fg-50);
	cursor: pointer;
}

.note-del:hover {
	background: var(--btn-regular-bg);
	color: var(--admonitions-color-caution);
}

@media (max-width: 900px) {
	.review {
		grid-template-columns: minmax(0, 1fr);
	}

	.side {
		position: static;
		order: -1;
		max-height: none;
	}

	.doc {
		padding: 1.1rem 1rem 1.3rem;
	}
}
</style>
