<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	renderShareCard,
	resolveElementImage,
	resolveSiteLogoSource,
} from "@/utils/share-card";

interface Props {
	/** 二维码指向的地址；缺省时取当前页面地址（不含查询串与 hash） */
	url?: string;
	/** 卡片标题；缺省时取当前页面的 document.title，并去掉站点名后缀 */
	title?: string;
	/** 内联样式（页面标题栏用）；默认渲染为右下角浮动按钮 */
	inline?: boolean;
	/** 卡片顶部的站点名 */
	siteTitle?: string;
	/** 卡片底部的作者名 */
	author?: string;
	avatar?: string | null;
	avatarSelector?: string | null;
}

let {
	url = "",
	title = "",
	inline = false,
	siteTitle = "",
	author = "",
	avatar = null,
	avatarSelector = null,
}: Props = $props();

let open = $state(false);
let cardImage = $state<string | null>(null);
let target = $state("");
let generating = $state(false);
let failed = $state(false);
let copied = $state(false);
let themeColor = $state("#558e88");
// 为避免重复生成，记住当前卡片对应的地址；站内切页后地址会变
let cachedFor = "";
let copyTimer: ReturnType<typeof setTimeout> | undefined;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveTarget(): string {
	if (url) return url;
	return `${window.location.origin}${window.location.pathname}`;
}

/** 页面标题：从 document.title 里剥掉「- 站点名」，卡片上只留页面自己的名字 */
function resolveHeading(): string {
	const raw = title || document.title;
	if (!siteTitle) return raw;
	const trimmed = raw
		.replace(new RegExp(`\\s*[-|–—]\\s*${escapeRegExp(siteTitle)}$`), "")
		.trim();
	return trimmed || raw;
}

function resolveDescription(heading: string): string {
	const meta = document
		.querySelector('meta[name="description"]')
		?.getAttribute("content");
	const text = (meta ?? "").trim();
	if (!text) return "";
	// 单页的描述常常就是页面名，卡片上会跟标题重复，直接丢掉
	if (text === heading) return "";
	if (text.startsWith(heading) && text.length <= heading.length + 10) return "";
	return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

async function generate(codeUrl: string) {
	generating = true;
	failed = false;
	try {
		const heading = resolveHeading();
		cardImage = await renderShareCard({
			title: heading,
			meta: window.location.host,
			description: resolveDescription(heading),
			author,
			authorLabel: i18n(I18nKey.author),
			siteTitle,
			themeColor,
			qrText: codeUrl,
			qrCaption: i18n(I18nKey.scanToOpenPage),
			logo: resolveSiteLogoSource(44),
			avatar: resolveElementImage(avatar, avatarSelector),
			cover: null,
		});
	} catch (error) {
		console.error("Failed to generate share card:", error);
		failed = true;
	} finally {
		generating = false;
	}
}

async function show() {
	target = resolveTarget();
	open = true;
	if (cachedFor !== target) {
		cardImage = null;
		cachedFor = target;
		await generate(target);
	}
}

function close() {
	open = false;
}

async function copyLink() {
	try {
		await navigator.clipboard.writeText(target);
		copied = true;
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copied = false;
		}, 2000);
	} catch {
		copied = false;
	}
}

function download() {
	if (!cardImage) return;
	const name = resolveHeading() || "page";
	const a = document.createElement("a");
	a.href = cardImage;
	a.download = `${name.replace(/[\\/:*?"<>|]+/g, "-")}.png`;
	a.rel = "noopener";
	a.click();
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === "Escape" && open) close();
}

function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.parentNode?.removeChild(node);
		},
	};
}

// 弹窗打开时锁住背景滚动
$effect(() => {
	if (!open) return;
	const previous = document.body.style.overflow;
	document.body.style.overflow = "hidden";
	return () => {
		document.body.style.overflow = previous;
	};
});

onMount(() => {
	// 主题色用于卡片上的色带与装饰圆
	const probe = document.createElement("div");
	probe.style.color = "var(--primary)";
	probe.style.display = "none";
	document.body.appendChild(probe);
	const computed = getComputedStyle(probe).color;
	document.body.removeChild(probe);
	if (computed) themeColor = computed;

	// 站内切页后地址变了，残留的弹窗要关掉，下次点击重新生成
	const onNavigate = () => {
		open = false;
	};
	document.addEventListener("swup:contentReplaced", onNavigate);
	return () => document.removeEventListener("swup:contentReplaced", onNavigate);
});
</script>

<svelte:window onkeydown={onKeydown} />

<button
	type="button"
	class="qr-trigger"
	class:qr-inline={inline}
	onclick={show}
	aria-label={i18n(I18nKey.qrCode)}
	title={i18n(I18nKey.qrCode)}
>
	<Icon icon="material-symbols:qr-code" />
	{#if inline}<span>{i18n(I18nKey.qrCode)}</span>{/if}
</button>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="qr-overlay" use:portal onclick={close}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="qr-dialog"
			role="dialog"
			aria-modal="true"
			aria-label={i18n(I18nKey.qrCode)}
			onclick={(event) => event.stopPropagation()}
		>
			<button
				type="button"
				class="qr-close"
				onclick={close}
				aria-label={i18n(I18nKey.close)}
			>
				<Icon icon="material-symbols:close-rounded" />
			</button>

			<div class="qr-card">
				{#if cardImage}
					<img src={cardImage} alt={resolveHeading()} width="850" />
				{:else if failed}
					<p class="qr-error">{i18n(I18nKey.qrCodeFailed)}</p>
				{:else}
					<span class="qr-spinner" aria-hidden="true">
						<Icon icon="svg-spinners:ring-resize" />
					</span>
				{/if}
			</div>

			<p class="qr-url" title={target}>{target}</p>

			<div class="qr-actions">
				<button type="button" class="qr-btn" onclick={copyLink}>
					<Icon
						icon={copied
							? "material-symbols:check"
							: "material-symbols:content-copy-rounded"}
					/>
					<span>{copied ? i18n(I18nKey.copied) : i18n(I18nKey.copyLink)}</span>
				</button>
				<button
					type="button"
					class="qr-btn qr-btn-primary"
					onclick={download}
					disabled={!cardImage}
				>
					<Icon icon="material-symbols:download" />
					<span>{i18n(I18nKey.savePoster)}</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.qr-trigger {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		padding: 0.25rem;
		border: 1px solid rgb(0 0 0 / 10%);
		border-radius: 1rem;
		background-color: var(--card-bg);
		backdrop-filter: blur(12px);
		color: var(--primary);
		font-size: 1.6rem;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.qr-trigger:hover {
		background-color: var(--btn-card-bg-hover);
		color: var(--primary);
		box-shadow: var(--shadow-button);
	}

	.qr-trigger:active {
		transform: scale(0.9);
	}

	:global(.dark) .qr-trigger {
		border-color: rgb(255 255 255 / 15%);
	}

	:global(.dark) .qr-trigger:hover {
		background-color: var(--btn-card-bg-hover);
		box-shadow: var(--shadow-button-dark);
	}

	.qr-inline {
		width: auto;
		height: 2rem;
		gap: 0.3rem;
		padding: 0 0.7rem;
		border-radius: 0.75rem;
		font-size: 0.8rem;
	}

	.qr-inline :global(svg) {
		font-size: 1.05rem;
	}

	@media (max-width: 768px) {
		.qr-trigger:not(.qr-inline) {
			width: 2.6rem;
			height: 2.6rem;
			font-size: 1.4rem;
		}

		.qr-inline {
			height: 1.75rem;
			font-size: 0.75rem;
		}
	}

	.qr-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background-color: rgb(0 0 0 / 60%);
		backdrop-filter: blur(4px);
		animation: qr-fade 0.18s ease-out;
	}

	.qr-dialog {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		width: min(94vw, 26rem);
		max-height: 92vh;
		padding: 0.85rem;
		border-radius: 1.25rem;
		background-color: var(--card-bg);
		box-shadow: 0 20px 50px rgb(0 0 0 / 25%);
		overflow-y: auto;
		animation: qr-pop 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
	}

	.qr-close {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 999px;
		background-color: rgb(0 0 0 / 45%);
		color: #fff;
		font-size: 1.05rem;
		cursor: pointer;
		transition: background-color 0.2s ease;
	}

	.qr-close:hover {
		background-color: rgb(0 0 0 / 62%);
	}

	.qr-card {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 12rem;
		border-radius: 0.85rem;
		background-color: #f4f6f7;
		overflow: hidden;
	}

	.qr-card img {
		display: block;
		width: 100%;
		height: auto;
	}

	.qr-spinner {
		display: inline-flex;
		color: var(--primary);
		font-size: 1.6rem;
	}

	.qr-error {
		margin: 0;
		padding: 0 1rem;
		color: var(--content-meta);
		font-size: 0.8rem;
		text-align: center;
	}

	.qr-url {
		margin: 0;
		overflow: hidden;
		padding: 0.4rem 0.6rem;
		border-radius: 0.55rem;
		background-color: var(--btn-regular-bg);
		color: var(--content-meta);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.7rem;
		line-height: 1.4;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.qr-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.55rem;
	}

	.qr-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		height: 2.4rem;
		border-radius: 0.75rem;
		background-color: var(--btn-regular-bg);
		color: var(--content-meta);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.qr-btn:hover {
		background-color: var(--btn-regular-bg-hover);
	}

	.qr-btn:active {
		transform: scale(0.97);
	}

	.qr-btn :global(svg) {
		font-size: 1.05rem;
	}

	.qr-btn-primary {
		background-color: var(--primary);
		color: #fff;
	}

	.qr-btn-primary:hover {
		background-color: var(--primary);
		filter: brightness(0.92);
	}

	.qr-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	@keyframes qr-fade {
		from {
			opacity: 0;
		}
	}

	@keyframes qr-pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.97);
		}
	}
</style>
