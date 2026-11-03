<script setup lang="ts">
interface PreviewOption {
	value: string;
	label: string;
	/** 卡片上的短标签，缺省用 label */
	short?: string;
}

defineProps<{
	value: string;
	options: PreviewOption[];
}>();

const emit = defineEmits<{ (event: "select", value: string): void }>();
</script>

<template>
	<div class="picker">
		<button
			v-for="opt in options"
			:key="opt.value"
			type="button"
			:class="['tile', { on: opt.value === value }]"
			:aria-pressed="opt.value === value"
			:title="opt.label"
			@click="emit('select', opt.value)"
		>
			<!-- 缩略图照真实首页摆：顶栏 + 左窄栏 + 右内容，只变壁纸范围与卡片透明度 -->
			<span class="frame" :class="`m-${opt.value}`">
				<span class="wall" />
				<span class="nav" />
				<span class="body">
					<span class="side" />
					<span class="main">
						<span class="card" />
						<span class="card" />
					</span>
				</span>
			</span>
			<span class="label">{{ opt.short ?? opt.label }}</span>
		</button>
	</div>
</template>

<style scoped>
.picker {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 0.4rem;
	width: 100%;
}

@media (max-width: 720px) {
	.picker {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

.tile {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	padding: 0.28rem;
	background: none;
	border: 1px solid transparent;
	border-radius: 0.6rem;
	cursor: pointer;
	text-align: left;
	transition: background 0.15s ease, border-color 0.15s ease;
}

.tile:hover {
	background: var(--btn-plain-bg-hover);
}

.tile.on {
	border-color: var(--primary);
	background: color-mix(in srgb, var(--primary) 8%, transparent);
}

/* 预览画布：底色 = 页面底色，壁纸与卡片都是里面的一层 */
.frame {
	position: relative;
	display: block;
	height: 5rem;
	overflow: hidden;
	border: 1px solid var(--line-divider);
	border-radius: 0.375rem;
	background: var(--card-bg);
}

/* 壁纸：用主题色相压一条渐变，不依赖具体图片，深浅色都成立 */
.wall {
	position: absolute;
	inset: 0;
	background: linear-gradient(
		140deg,
		oklch(0.72 0.11 var(--hue)) 0%,
		oklch(0.54 0.1 calc(var(--hue) + 18)) 55%,
		oklch(0.36 0.07 calc(var(--hue) - 12)) 100%
	);
}

.nav {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	height: 0.72rem;
	background: rgba(255, 255, 255, 0.45);
}

.body {
	position: absolute;
	inset: 0.8rem 0.35rem 0.35rem;
	display: grid;
	grid-template-columns: 32% 1fr;
	gap: 0.22rem;
}

.side,
.card {
	border-radius: 0.15rem;
	background: var(--card-bg);
	box-shadow: 0 0 0 1px var(--line-divider);
}

.main {
	display: grid;
	grid-template-rows: 1fr 1fr;
	gap: 0.22rem;
}

/* ---- 顶部横幅：壁纸只在页面顶部一条，正文区在它下面 ---- */
.m-banner .wall {
	inset: 0 0 auto 0;
	height: 44%;
}

.m-banner .nav {
	height: 0.62rem;
	background: rgba(255, 255, 255, 0.22);
}

/* 正文从壁纸下沿开始，卡片实色 */
.m-banner .body {
	top: 50%;
}

/* ---- 全屏壁纸：铺满整屏，卡片基本实色，浮在壁纸上 ---- */
.m-fullscreen .nav {
	background: rgba(255, 255, 255, 0.28);
}

.m-fullscreen .side,
.m-fullscreen .card {
	background: color-mix(in srgb, var(--card-bg) 90%, transparent);
}

/* ---- 覆盖透明：铺满整屏，卡片明显半透明，壁纸透上来 ---- */
.m-overlay .nav {
	background: transparent;
}

.m-overlay .side,
.m-overlay .card {
	background: color-mix(in srgb, var(--card-bg) 46%, transparent);
}

/* ---- 纯色背景：没有壁纸层，页面底色 + 实色卡片 ---- */
.m-none .wall {
	display: none;
}

.m-none .nav {
	background: var(--card-bg);
	box-shadow: 0 1px 0 var(--line-divider);
}

.label {
	font-size: 0.75rem;
	line-height: 1.2;
	color: var(--fg-75);
	text-align: center;
}

.tile.on .label {
	color: var(--accent-text);
	font-weight: 600;
}
</style>
