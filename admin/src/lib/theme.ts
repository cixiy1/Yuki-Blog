import { ref } from "vue";

/**
 * 主题状态与主站共享 localStorage（键名 theme / hue，见 src/layouts/Layout.astro）。
 * 在管理端切换深浅色，回到主站也是同一套。
 */
export const isDark = ref(document.documentElement.classList.contains("dark"));

export function applyTheme(dark: boolean): void {
	document.documentElement.classList.toggle("dark", dark);
	isDark.value = dark;
	localStorage.setItem("theme", dark ? "dark" : "light");
	window.dispatchEvent(
		new CustomEvent("yb-theme-change", { detail: { dark } }),
	);
}

export function toggleTheme(): void {
	applyTheme(!isDark.value);
}

export function currentHue(): number {
	const raw = Number(localStorage.getItem("hue"));
	return Number.isFinite(raw) && raw >= 0 && raw <= 360 ? raw : 180;
}
