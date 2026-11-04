<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "./AppIcon.vue";

/**
 * 页面预览：把线上已发布的文章页塞进 iframe，按桌面 / 平板 / 手机三种宽度看效果。
 *
 * 为什么不在编辑器里渲染：MDX 里的 `<ClassSchedule />`、`<SiteStats />` 是 Astro 组件，
 * 要过一次构建才有 HTML。Vditor 的 markdown 预览只能把 `import …` 当正文段落，组件是空标签，
 * 看不到任何效果——这类文章只能看真实页面。
 */
const props = defineProps<{ url: string; title?: string }>();
const emit = defineEmits<{ close: [] }>();

type Device = "desktop" | "tablet" | "phone";

const DEVICES: Array<{ key: Device; label: string; width: number }> = [
	{ key: "desktop", label: "桌面", width: 1280 },
	{ key: "tablet", label: "平板", width: 768 },
	{ key: "phone", label: "手机", width: 390 },
];

const device = ref<Device>("desktop");
/** 换 key 才会真的重新请求，直接改 src 命中缓存看不出变化 */
const frameKey = ref(0);
const state = ref<"loading" | "ok" | "missing" | "error">("loading");
const errorText = ref("");

const width = computed(
	() => DEVICES.find((item) => item.key === device.value)?.width ?? 1280,
);

/** 先探一下地址存不存在：404 直接说「还没上线」，别把 404 页面当正文给别人看 */
async function probe(): Promise<void> {
	state.value = "loading";
	errorText.value = "";
	try {
		let res = await fetch(props.url, { method: "HEAD", redirect: "follow" });
		// 静态资源对 HEAD 一般没问题，个别中间层会回 405
		if (res.status === 405)
			res = await fetch(props.url, { redirect: "follow" });
		if (res.status === 404) {
			state.value = "missing";
			return;
		}
		if (!res.ok && res.status !== 0) {
			state.value = "error";
			errorText.value = `HTTP ${res.status}`;
			return;
		}
		state.value = "ok";
		frameKey.value += 1;
	} catch (error) {
		state.value = "error";
		errorText.value = error instanceof Error ? error.message : "读取失败";
	}
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape") emit("close");
}

onMounted(() => {
	window.addEventListener("keydown", onKeydown);
	void probe();
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
	<div class="pp-mask" @click.self="emit('close')">
		<div class="pp-dialog" role="dialog" aria-modal="true" aria-label="页面预览">
			<header class="pp-head">
				<div class="pp-devices" role="tablist" aria-label="预览宽度">
					<button
						v-for="item in DEVICES"
						:key="item.key"
						type="button"
						class="pp-device"
						:class="{ on: device === item.key }"
						@click="device = item.key"
					>
						{{ item.label }}
					</button>
				</div>
				<code class="pp-url">{{ url }}</code>
				<div class="pp-actions">
					<button
						type="button"
						class="pp-icon"
						title="重新加载"
						aria-label="重新加载"
						@click="probe()"
					>
						<AppIcon name="refresh" :size="15" />
					</button>
					<a
						class="pp-icon"
						:href="url"
						target="_blank"
						rel="noreferrer"
						title="在新标签打开"
						aria-label="在新标签打开"
					>
						<AppIcon name="external" :size="15" />
					</a>
					<button
						type="button"
						class="pp-icon"
						title="关闭"
						aria-label="关闭预览"
						@click="emit('close')"
					>
						<AppIcon name="close" :size="15" />
					</button>
				</div>
			</header>

			<p class="pp-note">
				显示的是线上已发布的版本，保存后约 1–2 分钟才会更新。
			</p>

			<div class="pp-stage">
				<div class="pp-frame" :style="{ width: `${width}px` }">
					<iframe
						v-if="state === 'ok'"
						:key="frameKey"
						:src="url"
						:title="title || '页面预览'"
					/>
					<div v-else-if="state === 'loading'" class="pp-empty">载入中…</div>
					<div v-else-if="state === 'missing'" class="pp-empty">
						<p class="pp-empty-title">线上还没有这个地址</p>
						<p class="pp-empty-hint">
							文章可能还没发布，或者刚改过 slug。保存后等构建跑完再看。
						</p>
					</div>
					<div v-else class="pp-empty">
						<p class="pp-empty-title">读取失败</p>
						<p class="pp-empty-hint">{{ errorText }}</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.pp-mask {
	position: fixed;
	inset: 0;
	z-index: 220;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2.5vh 2vw;
	background: rgb(0 0 0 / 45%);
	backdrop-filter: blur(2px);
}

.pp-dialog {
	display: flex;
	flex-direction: column;
	width: min(84rem, 96vw);
	height: min(52rem, 95vh);
	overflow: hidden;
	background: var(--card-bg);
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
}

.pp-head {
	display: flex;
	flex: none;
	align-items: center;
	gap: 0.6rem;
	padding: 0.5rem 0.7rem;
	border-bottom: 1px solid var(--line-divider);
}

.pp-devices {
	display: flex;
	flex: none;
	gap: 0.15rem;
}

.pp-device {
	padding: 0.3rem 0.66rem;
	border: 1px solid transparent;
	border-radius: 0.5rem;
	background: transparent;
	color: var(--fg-50);
	font-size: 0.76rem;
	cursor: pointer;
}

.pp-device:hover {
	color: var(--fg-90);
}

.pp-device.on {
	border-color: var(--line-divider);
	background: var(--btn-regular-bg);
	color: var(--fg-90);
}

.pp-url {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	color: var(--fg-50);
	font-size: 0.72rem;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.pp-actions {
	display: flex;
	flex: none;
	gap: 0.1rem;
}

.pp-icon {
	display: grid;
	place-items: center;
	width: 1.9rem;
	height: 1.9rem;
	border: none;
	border-radius: 0.5rem;
	background: transparent;
	color: var(--fg-50);
	cursor: pointer;
}

.pp-icon:hover {
	background: var(--btn-regular-bg);
	color: var(--fg-90);
}

.pp-note {
	flex: none;
	margin: 0;
	padding: 0.45rem 0.85rem;
	border-bottom: 1px solid var(--line-divider);
	color: var(--fg-50);
	font-size: 0.74rem;
}

.pp-stage {
	display: flex;
	flex: 1;
	align-items: stretch;
	justify-content: center;
	min-height: 0;
	padding: 0.7rem;
	overflow: auto;
	background: var(--page-bg);
}

.pp-frame {
	display: flex;
	flex: none;
	max-width: 100%;
	overflow: hidden;
	border: 1px solid var(--line-divider);
	border-radius: 0.6rem;
	background: var(--card-bg);
}

.pp-frame iframe {
	display: block;
	width: 100%;
	height: 100%;
	border: none;
}

.pp-empty {
	display: flex;
	flex: 1;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.35rem;
	padding: 2rem 1.5rem;
	text-align: center;
}

.pp-empty-title {
	margin: 0;
	color: var(--fg-90);
	font-size: 0.9rem;
}

.pp-empty-hint {
	margin: 0;
	max-width: 26rem;
	color: var(--fg-50);
	font-size: 0.78rem;
	line-height: 1.7;
}
</style>
