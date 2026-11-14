<script setup lang="ts">
import MindElixir, {
	DARK_THEME,
	DOWN,
	type MindElixirData,
	type NodeObj,
	RIGHT,
	SIDE,
	THEME,
} from "mind-elixir";
import { zh_CN } from "mind-elixir/i18n";
import "mind-elixir/style.css";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { MindNode } from "../lib/mindmap";
import { parseMermaid, toMermaid } from "../lib/mindmap";

const props = defineProps<{
	/** 打开时载入的已有导图；没有就是新建 */
	initial: MindNode | null;
	/** 目标块的原始 mermaid 源码：画布读不出来时退到源码编辑，至少能改 */
	initialSource?: string;
	/** 正文里 mermaid 块的总数与当前块序号（从 0 起），多块时给切换入口 */
	blockCount?: number;
	blockIndex?: number;
	/** 当前块类型：flowchart 这类画布画不了，只能改源码 */
	kind?: "mindmap" | "other";
	/** 当前块首行，让人一眼认出改的是哪一段 */
	preview?: string;
	/** true 表示正在画新的一幅，正文里已有的图不会被覆盖 */
	newMode?: boolean;
	dark: boolean;
	/** 非空表示会覆盖正文里那一块，按钮文案跟着变 */
	targetLabel: string;
	/** 需要提醒的异常情况，比如正文里那幅读不出来 */
	notice?: string;
}>();

const emit = defineEmits<{
	close: [];
	submit: [source: string];
	pick: [index: number];
	/** 从「改已有」切到「画新的一幅」 */
	create: [];
}>();

type Layout = "side" | "right" | "down";
type Mode = "canvas" | "source";

const host = ref<HTMLElement | null>(null);
const layout = ref<Layout>("side");
const canvasKey = ref(0);
/** 画布只画 mindmap；其他 mermaid 类型没有画布，直接改源码 */
const canvasable = computed(() => (props.kind ?? "mindmap") === "mindmap");
/** 只在「有目标块但画布读不出来」时退到源码；新画一张仍然是空白画布 */
const mode = ref<Mode>(
	canvasable.value && (props.initial || !props.initialSource)
		? "canvas"
		: "source",
);
const sourceText = ref(props.initialSource ?? "");
const canvasError = ref("");
const blockCount = computed(() => props.blockCount ?? 0);
const blockIndex = computed(() => props.blockIndex ?? 0);
/** 新增模式下读不到东西是正常状态，别把「用源码改」的警告挂到空白画布上；
 *  flowchart 这类本来就只有源码，也不要误报「画布读不出来」 */
const switchWarn = computed(
	() =>
		canvasable.value &&
		!props.newMode &&
		blockCount.value > 1 &&
		props.initialSource !== undefined &&
		!props.initial,
);
/** 新增模式下切回原来那块的入口文案：只有一块时不必报序号 */
const resumeLabel = computed(() =>
	props.blockCount === 1 ? "↩ 改原来那段" : `↩ 改第 ${blockIndex.value + 1} 段`,
);
let mind: MindElixir | null = null;
let seq = 0;
/** 从源码切回画布时用的临时树，优先于 props.initial */
let overrideTree: MindNode | null = null;

function directionOf(value: Layout): 0 | 1 | 2 | 3 {
	if (value === "right") return RIGHT;
	if (value === "down") return DOWN;
	return SIDE;
}

function toNodeObj(node: MindNode, isRoot = false): NodeObj {
	seq += 1;
	// root 是 mind-elixir 认的运行时标记，但没写进 NodeObj 的类型里，
	// 只能挂个交叉类型，别为了过类型检查把它删掉
	const obj: NodeObj & { root: boolean } = {
		id: `n${seq}`,
		topic: node.topic,
		root: isRoot,
		children: node.children.map((child) => toNodeObj(child)),
	};
	return obj;
}

function toMindNode(obj: NodeObj): MindNode {
	return {
		topic: String(obj.topic ?? ""),
		children: (obj.children ?? []).map(toMindNode),
	};
}

function initialData(): MindElixirData {
	const tree = overrideTree ?? props.initial;
	if (tree) return { nodeData: toNodeObj(tree, true) };
	return MindElixir.new("中心主题");
}

function create(data?: MindElixirData): void {
	if (!host.value) return;
	const next = data ?? initialData();
	const base = props.dark ? DARK_THEME : THEME;
	mind = new MindElixir({
		el: host.value,
		direction: directionOf(layout.value),
		editable: true,
		contextMenu: { locale: zh_CN },
		toolBar: false,
		keypress: true,
		allowUndo: true,
		// 画布底色跟卡片同色：管理端不出现灰底，层次靠节点描边
		theme: {
			...base,
			cssVar: { ...base.cssVar, "--bgcolor": "var(--card-bg)" },
		},
	});
	mind.init(next);
	// 等 layout 落位再量尺寸：init 当下量到的是空容器，要等一帧
	window.requestAnimationFrame(() => {
		fit();
		window.setTimeout(fit, 120);
	});
}

/** 按容器大小把图缩放到大致填满，免得小图缩在中间像一粒芝麻 */
function fit(): void {
	if (!mind || !host.value) return;
	const canvas = host.value.querySelector<HTMLElement>(".map-canvas");
	if (!canvas) return;
	const boxWidth = host.value.clientWidth;
	const boxHeight = host.value.clientHeight;
	if (boxWidth === 0 || boxHeight === 0) return;

	// 当前 rect 是缩放后的，除以 scaleVal 还原成实际排版尺寸
	const current = mind.scaleVal || 1;
	const rect = canvas.getBoundingClientRect();
	const width = rect.width / current;
	const height = rect.height / current;
	if (width < 1 || height < 1) return;

	const want = Math.min(boxWidth / width, boxHeight / height) * 0.78;
	// 下限别卡太高：手机上画布只有三百多像素，硬留 0.7 会把图顶出屏幕
	mind.scale(Math.max(0.25, Math.min(1.35, want)));
	mind.toCenter();
}

/** 换布局要重建：mind-elixir 的 direction 只在初始化时读 */
function pickLayout(value: Layout): void {
	if (value === layout.value) return;
	const data = mind?.getData();
	// getData 会把旧的 direction 一起带回来，init 会拿它盖掉构造参数，必须改写
	if (data) data.direction = directionOf(value);
	layout.value = value;
	mind?.destroy();
	mind = null;
	canvasKey.value += 1;
	void nextTick(() => create(data));
}

function onEscape(event: KeyboardEvent): void {
	if (event.key === "Escape") emit("close");
}

/** 画布 / 源码互切：源码能读成树才允许回画布，读不出来就留在源码里改 */
function switchMode(next: Mode): void {
	if (next === mode.value) return;
	// flowchart 这类块没有画布，切过去只会得到一张空图
	if (next === "canvas" && !canvasable.value) return;
	if (next === "source") {
		// 画布上的改动先落回源码，别一换模式就丢
		if (mind) sourceText.value = toMermaid(toMindNode(mind.getData().nodeData));
		mind?.destroy();
		mind = null;
		mode.value = "source";
		canvasError.value = "";
		return;
	}

	const tree = parseMermaid(sourceText.value);
	if (!tree) {
		canvasError.value = "这段源码画布读不出来，先照着源码改，或重画一张。";
		return;
	}
	overrideTree = tree;
	canvasError.value = "";
	mode.value = "canvas";
	canvasKey.value += 1;
	void nextTick(() => create());
}

/** 转屏或改窗口大小后容器变了，重新贴合一次，否则图会贴在右侧切掉一半 */
function onResize(): void {
	fit();
}

onMounted(() => {
	if (mode.value === "canvas") void nextTick(() => create());
	window.addEventListener("keydown", onEscape);
	window.addEventListener("resize", onResize);
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onEscape);
	window.removeEventListener("resize", onResize);
	mind?.destroy();
	mind = null;
});

const canSubmit = computed(() =>
	mode.value === "source" ? sourceText.value.trim().length > 0 : true,
);

function submit(): void {
	if (mode.value === "source") {
		const text = sourceText.value.trim();
		if (!text) return;
		emit("submit", text);
		return;
	}
	if (!mind) return;
	emit("submit", toMermaid(toMindNode(mind.getData().nodeData)));
}
</script>

<template>
	<div class="mm-mask" @click.self="emit('close')">
		<div
			class="mm-dialog"
			role="dialog"
			aria-modal="true"
			:aria-label="canvasable ? '思维导图' : 'mermaid 图表'"
		>
			<header class="mm-head">
				<div class="mm-title-box">
					<p class="mm-title">
						{{ canvasable ? "思维导图" : "mermaid 图表" }}
					</p>
					<p v-if="canvasable" class="mm-tip">
						Tab 加子节点 · Enter 加同级 · Shift+Enter 加到前面 ·
						Ctrl+Enter 加父节点 · F2 改名 · Delete 删除 · 拖拽换层级
					</p>
					<p v-else class="mm-tip">
						{{ preview || "这段 mermaid" }} · 画布只能画 mindmap，这里直接改源码
					</p>
				</div>
				<div class="mm-tools">
					<div
						v-if="!newMode && blockCount > 1"
						class="mm-seg"
						role="group"
						aria-label="导图块"
					>
						<button
							type="button"
							:disabled="blockIndex === 0"
							title="上一段"
							@click="emit('pick', blockIndex - 1)"
						>
							◀
						</button>
						<span class="mm-count">{{ blockIndex + 1 }} / {{ blockCount }}</span>
						<button
							type="button"
							:disabled="blockIndex >= blockCount - 1"
							title="下一段"
							@click="emit('pick', blockIndex + 1)"
						>
							▶
						</button>
					</div>
					<button
						v-if="!newMode && blockCount > 0"
						type="button"
						class="mm-pill"
						@click="emit('create')"
					>
						＋ 新建一幅
					</button>
					<button
						v-else-if="newMode && blockCount > 0"
						type="button"
						class="mm-pill"
						@click="emit('pick', blockIndex)"
					>
						{{ resumeLabel }}
					</button>
					<div
						v-if="canvasable"
						class="mm-seg"
						role="group"
						aria-label="编辑方式"
					>
						<button
							v-for="item in [
								{ key: 'canvas', label: '画布' },
								{ key: 'source', label: '源码' },
							]"
							:key="item.key"
							type="button"
							:class="{ on: mode === item.key }"
							@click="switchMode(item.key as Mode)"
						>
							{{ item.label }}
						</button>
					</div>
					<div v-if="mode === 'canvas'" class="mm-seg" role="group" aria-label="布局">
						<button
							v-for="item in [
								{ key: 'side', label: '两侧' },
								{ key: 'right', label: '向右' },
								{ key: 'down', label: '向下' },
							]"
							:key="item.key"
							type="button"
							:class="{ on: layout === item.key }"
							@click="pickLayout(item.key as Layout)"
						>
							{{ item.label }}
						</button>
					</div>
					<button type="button" class="mm-x" title="关闭" @click="emit('close')">
						✕
					</button>
				</div>
			</header>

			<div
				v-if="mode === 'canvas'"
				:key="canvasKey"
				ref="host"
				class="mm-canvas"
			/>
			<textarea
				v-else
				v-model="sourceText"
				class="mm-source"
				spellcheck="false"
				aria-label="mermaid 源码"
			/>

			<p v-if="canvasError" class="mm-error">{{ canvasError }}</p>

			<footer class="mm-foot">
				<p v-if="notice" class="mm-hint mm-warn">{{ notice }}</p>
				<p v-else-if="switchWarn" class="mm-hint mm-warn">
					这一块画布读不出来，先用源码改；保存仍会替换原来那一块。
				</p>
				<p v-else-if="mode === 'source'" class="mm-hint">
					直接改下面的 mermaid 源码，保存后整块替换回正文。
				</p>
				<p v-else-if="newMode && blockCount > 0" class="mm-hint">
					新导图会追加到正文末尾，已有的
					{{ blockCount }} 段不动。
				</p>
				<p v-else class="mm-hint">
					插入后是 <code>```mermaid</code> 代码块，站点构建时渲染成图，深浅色自动跟随。
				</p>
				<div class="mm-actions">
					<button type="button" class="btn-ghost" @click="emit('close')">取消</button>
					<button
						type="button"
						class="btn-primary"
						:disabled="!canSubmit"
						@click="submit"
					>
						{{ targetLabel || "插入正文" }}
					</button>
				</div>
			</footer>
		</div>
	</div>
</template>

<style scoped>
.mm-mask {
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

.mm-dialog {
	display: flex;
	flex-direction: column;
	width: min(80rem, 96vw);
	height: min(52rem, 92vh);
	overflow: hidden;
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
}

.mm-head {
	display: flex;
	flex: none;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.85rem 1rem;
	border-bottom: 1px solid var(--line-divider);
}

.mm-title {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 600;
	color: var(--fg-90);
}

.mm-tip {
	margin: 0.2rem 0 0;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.mm-tools {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex: none;
}

.mm-seg {
	display: flex;
	align-items: center;
	padding: 0.12rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
}

.mm-seg button {
	padding: 0.22rem 0.6rem;
	border: none;
	border-radius: 999px;
	background: transparent;
	color: var(--fg-75);
	font-size: 0.74rem;
	cursor: pointer;
}

.mm-seg button.on {
	background: var(--card-bg);
	color: var(--fg-90);
	box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
}

.mm-seg button:disabled {
	opacity: 0.35;
	cursor: default;
}

.mm-count {
	display: flex;
	align-items: center;
	justify-content: center;
	/* 位数变化时（9/10）整组不跟着挪，数字用等宽的 */
	min-width: 2.6rem;
	color: var(--fg-50);
	font-size: 0.72rem;
	font-variant-numeric: tabular-nums;
	line-height: 1;
}

/* 「新建一幅」和它的反向入口：和分段控件长得像，但不是选中态 */
.mm-pill {
	padding: 0.26rem 0.7rem;
	border: 1px solid var(--line-divider);
	border-radius: 999px;
	background: transparent;
	color: var(--fg-75);
	font-size: 0.74rem;
	cursor: pointer;
}

.mm-pill:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.mm-source {
	flex: 1;
	min-height: 0;
	padding: 1rem 1.15rem;
	border: none;
	outline: none;
	resize: none;
	background: var(--card-bg);
	color: var(--fg-90);
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
	font-size: 0.82rem;
	line-height: 1.65;
	tab-size: 2;
	white-space: pre;
	overflow: auto;
}

.mm-error {
	margin: 0;
	padding: 0.5rem 1rem;
	border-top: 1px solid var(--line-divider);
	color: var(--admonitions-color-caution);
	font-size: 0.74rem;
}

.mm-x {
	width: 1.9rem;
	height: 1.9rem;
	border: none;
	border-radius: 999px;
	background: transparent;
	color: var(--fg-50);
	cursor: pointer;
}

.mm-x:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.mm-canvas {
	flex: 1;
	min-height: 0;
	position: relative;
	background: var(--card-bg);
}

.mm-foot {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.7rem 1rem;
	border-top: 1px solid var(--line-divider);
}

.mm-hint {
	margin: 0;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.mm-hint code {
	font-size: 0.7rem;
}

.mm-warn {
	color: var(--admonitions-color-caution);
}

.mm-actions {
	display: flex;
	flex: none;
	gap: 0.5rem;
}

/* 窄屏：快捷键提示和说明都收掉，把高度留给画布 */
@media (max-width: 640px) {
	.mm-tip,
	.mm-hint:not(.mm-warn) {
		display: none;
	}

	.mm-head,
	.mm-foot {
		padding: 0.6rem 0.75rem;
	}

	.mm-dialog {
		width: 96vw;
		height: 88vh;
	}

	/* 工具条比 390px 宽：标题独占一行，按钮整组换行，别被挤成竖排单字 */
	.mm-head {
		flex-wrap: wrap;
	}

	.mm-title-box {
		flex: 1 1 100%;
		min-width: 0;
	}

	.mm-title {
		white-space: nowrap;
	}

	.mm-tools {
		flex: 1 1 100%;
		flex-wrap: wrap;
		justify-content: flex-start;
		row-gap: 0.3rem;
	}

	.mm-pill {
		padding: 0.2rem 0.5rem;
		font-size: 0.7rem;
	}
}
</style>
