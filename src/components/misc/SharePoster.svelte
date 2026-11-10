<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { siteConfig } from "@/config";
import {
	renderShareCard,
	resolveElementImage,
	resolveSiteLogoSource,
} from "@/utils/share-card";
import I18nKey from "../../i18n/i18nKey";
import { i18n } from "../../i18n/translation";

export let title: string;
export let author: string;
export let description = "";
export let pubDate: string;
export let coverImage: string | null = null;
export let coverImageSelector: string | null = null;
export let url: string;
export let siteTitle: string;
export let avatar: string | null = null;
export let avatarSelector: string | null = null;

let showModal = false;
let posterImage: string | null = null;
let generating = false;
let themeColor = "#558e88"; // Default blue

onMount(() => {
	// Get theme color from CSS variable
	const temp = document.createElement("div");
	temp.style.color = "var(--primary)";
	temp.style.display = "none";
	document.body.appendChild(temp);
	const computedColor = getComputedStyle(temp).color;
	document.body.removeChild(temp);

	if (computedColor) {
		themeColor = computedColor;
	}
});

function formatPosterDate(value: string): string {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return "";
	const day = d.getDate().toString().padStart(2, "0");
	const month = (d.getMonth() + 1).toString().padStart(2, "0");
	return `${d.getFullYear()}.${month}.${day}`;
}

async function generatePoster() {
	showModal = true;
	if (posterImage) return;

	generating = true;
	try {
		posterImage = await renderShareCard({
			title,
			meta: formatPosterDate(pubDate),
			description,
			author,
			authorLabel: i18n(I18nKey.author),
			siteTitle,
			themeColor,
			qrText: url,
			qrCaption: i18n(I18nKey.scanToRead),
			logo: resolveSiteLogoSource(22 * 2),
			avatar: resolveElementImage(avatar, avatarSelector),
			cover: resolveElementImage(coverImage, coverImageSelector),
		});
	} catch (error) {
		console.error("Failed to generate poster:", error);
	} finally {
		generating = false;
	}
}

function downloadPoster() {
	if (posterImage) {
		const a = document.createElement("a");
		a.href = posterImage;
		a.download = `poster-${title.replace(/\s+/g, "-")}.png`;
		a.click();
	}
}

function closeModal() {
	showModal = false;
}

let copied = false;
function copyLink() {
	navigator.clipboard.writeText(url);
	copied = true;
	setTimeout(() => {
		copied = false;
	}, 2000);
}

function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			if (node.parentNode) {
				node.parentNode.removeChild(node);
			}
		},
	};
}
</script>

<!-- Trigger Button -->
<button 
  class="btn-regular rounded-lg h-12 px-6 gap-2 hover:scale-105 active:scale-95 whitespace-nowrap"
  on:click={generatePoster}
  aria-label="Generate Share Poster"
>
  <Icon icon="material-symbols:share" />
  <span>{i18n(I18nKey.shareArticle)}</span>
</button>



<!-- Modal -->
{#if showModal}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div use:portal class="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 transition-opacity" on:click={closeModal}>
    <div class="bg-white dark:bg-gray-800 rounded-2xl max-w-[440px] w-full max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl transform transition-all" on:click={(e) => e.stopPropagation()}>
      
      <div class="p-6 flex justify-center bg-gray-50 dark:bg-gray-900 min-h-[200px] items-center">
        {#if posterImage}
          <img src={posterImage} alt="Poster" class="max-w-full h-auto shadow-lg rounded-lg" />
        {:else}
           <div class="flex flex-col items-center gap-3">
             <div class="w-8 h-8 border-2 border-gray-200 rounded-full animate-spin" style="border-top-color: {themeColor}"></div>
             <span class="text-sm text-gray-500">{i18n(I18nKey.generatingPoster)}</span>
           </div>
        {/if}
      </div>
      
      <div class="p-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 gap-3">
        <button 
          class="py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          on:click={copyLink}
        >
          {#if copied}
            <Icon icon="material-symbols:check" />
            <span>{i18n(I18nKey.copied)}</span>
          {:else}
            <Icon icon="material-symbols:link" />
            <span>{i18n(I18nKey.copyLink)}</span>
          {/if}
        </button>
        <button 
          class="py-3 text-white rounded-xl font-medium active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-90"
          style="background-color: {themeColor};"
          on:click={downloadPoster}
          disabled={!posterImage}
        >
          <Icon icon="material-symbols:download" />
          {i18n(I18nKey.savePoster)}
        </button>
      </div>
    </div>
  </div>
{/if}
