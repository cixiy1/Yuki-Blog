<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { toQrDataUrl } from "@/utils/qr-code";

interface Props {
	/** 二维码指向的地址；缺省时取当前页面地址（不含查询串与 hash） */
	url?: string;
	/** 弹窗标题；缺省时取当前页面的 document.title */
	title?: string;
	/** 内联样式（页面标题栏用）；默认渲染为右下角浮动按钮 */
	inline?: boolean;
}

let { url = "", title = "", inline = false }: Props = $props();

let open = $state(false);
let dataUrl = $state<string | null>(null);
let target = $state("");
let heading = $state("");
let generating = $state(false);
let failed = $state(false);
let copied = $state(false);
// 为避免重复生成，记住当前 dataUrl 对应的地址；站点切换页面后地址会变
let cachedFor = "";
let copyTimer: ReturnType<typeof setTimeout> | undefined;

function resolveTarget(): string {
	if (url) return url;
	return `${window.location.origin}${window.location.pathname}`;
}

async function generate(codeUrl: string) {
	generating = true;
	failed = false;
	try {
		// 与文章分享海报共用同一套二维码外观，见 @/utils/qr-code
		dataUrl = await toQrDataUrl(codeUrl, 720);
	} catch (error) {
		console.error("Failed to generate QR code:", error);
		failed = true;
	} finally {
		generating = false;
	}
}

async function show() {
	target = resolveTarget();
	heading = title || document.title;
	open = true;
	if (cachedFor !== target) {
		dataUrl = null;
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
	if (!dataUrl) return;
	const a = document.createElement("a");
	a.href = dataUrl;
	a.download = `${(heading || "page").replace(/[\\/:*?"<>|]+/g, "-")}.png`;
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

			<div class="qr-head">
				<p class="qr-title">{heading}</p>
				<p class="qr-hint">{i18n(I18nKey.qrCodeHint)}</p>
			</div>

			<div class="qr-frame" class:is-loading={generating || failed}>
				{#if dataUrl}
					<img src={dataUrl} alt={heading} width="720" height="720" />
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
					disabled={!dataUrl}
				>
					<Icon icon="material-symbols:download" />
					<span>{i18n(I18nKey.saveQrCode)}</span>
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
			display: none;
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
		gap: 0.9rem;
		width: min(92vw, 20rem);
		max-height: 90vh;
		padding: 1.1rem 1.1rem 1rem;
		border-radius: 1.25rem;
		background-color: var(--card-bg);
		box-shadow: 0 20px 50px rgb(0 0 0 / 25%);
		animation: qr-pop 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
	}

	.qr-close {
		position: absolute;
		top: 0.55rem;
		right: 0.55rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 999px;
		color: var(--content-meta);
		font-size: 1.15rem;
		cursor: pointer;
		transition: background-color 0.2s ease;
	}

	.qr-close:hover {
		background-color: var(--btn-regular-bg-hover);
		color: var(--primary);
	}

	.qr-head {
		padding-right: 1.9rem;
	}

	.qr-title {
		margin: 0;
		overflow: hidden;
		color: rgb(0 0 0 / 88%);
		font-size: 0.95rem;
		font-weight: 600;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.dark) .qr-title {
		color: rgb(255 255 255 / 92%);
	}

	.qr-hint {
		margin: 0.25rem 0 0;
		color: var(--content-meta);
		font-size: 0.75rem;
		line-height: 1.5;
	}

	.qr-frame {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		/* 二维码固定白底黑码，暗色主题下也不跟随，保证可扫 */
		border-radius: 0.85rem;
		background-color: #fff;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 6%);
		overflow: hidden;
	}

	.qr-frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
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
