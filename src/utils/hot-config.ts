import { displaySettingsConfig } from "@/config";
import type { WALLPAPER_MODE } from "@/types/config";
import {
	applyWallpaperModeToDocument,
	getDefaultHue,
} from "@/utils/setting-utils";

/**
 * 热配置的运行时应用。
 *
 * 只有「改完不必等构建」的字段会走到这里：主题色相 `--hue` 与壁纸模式
 * `data-wallpaper-mode`。两者都是不参与 SEO、不重建 DOM 的纯表现项，
 * 所以运行时盖上不会造成「页面标题和搜索结果不一致」这类问题。
 *
 * 三处细节都是踩出来的，改动前先读：
 *  1. 判据不能只看「localStorage 里有没有 hue」——设置面板挂载时会把自己的
 *     `$effect` 跑一次，把当前值落盘，所以**每个访客的键都存在**。只有当存下来
 *     的值和构建时的值不同，才说明是他自己拖过滑块。
 *  2. 应用之后要更新 `#config-carrier` 的 `data-hue`，并写一条 `hueAuto` 记录，
 *     否则下次加载分不清「这个 hue 是热配置写的」还是「访客自己拖的」，
 *     会把访客当成自选而放弃覆盖。
 *  3. 只改 CSS 变量与 data 属性，**不调 setHue()**：那会把值写进 localStorage，
 *     等于把站主的一次调整永久锁进访客浏览器，以后站主再改就盖不动了。
 */
const ENDPOINT = "/api/site-config";

let started = false;

export function initHotConfig(): void {
	if (typeof window === "undefined" || started) return;
	started = true;

	// 访客自己调过色相，就不再打扰
	if (isVisitorChoice()) return;

	const run = (): void => {
		void applyHotConfig();
	};
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", run, { once: true });
	} else {
		run();
	}
}

async function applyHotConfig(): Promise<void> {
	let payload: unknown;
	try {
		const res = await fetch(ENDPOINT, {
			headers: { accept: "application/json" },
			// 同源接口，带上 cookie 以便将来有权限差异时不用改
			credentials: "same-origin",
		});
		if (!res.ok) return;
		payload = await res.json();
	} catch {
		// 接口挂了就用构建时的值，不必让页面报错
		return;
	}

	// 先把构建值记下来：下面会改 data-hue，改完再读就不是原值了
	const buildHue = getDefaultHue();
	const hue = readPath(payload, ["config", "site", "themeColor", "hue"]);
	if (typeof hue === "number" && Number.isFinite(hue) && hue >= 0 && hue <= 360) {
		// 与构建产物一致就什么都不用做
		if (hue !== buildHue) applyHue(hue);
	}

	applyBannerMode(readPath(payload, ["config", "banner", "mode"]));
}

function applyHue(hue: number): void {
	document.documentElement.style.setProperty("--hue", String(hue));

	const carrier = document.getElementById("config-carrier");
	if (carrier) carrier.dataset.hue = String(hue);

	// 通知设置面板同步状态：它的 hue 是挂载时读的，早于这次请求返回，
	// 不同步的话它下一次 setHue 会把色相按回旧值。
	window.dispatchEvent(new CustomEvent("yb-hot-hue", { detail: { hue } }));

	// 记一笔「这个值是我们写的」，下次加载才分得清「热配置」与「访客自选」
	try {
		localStorage.setItem("hue", String(hue));
		localStorage.setItem("hueAuto", String(hue));
	} catch {
		// 写不进去也不影响本次显示，只是下次可能被当成访客自选
	}
}

const WALLPAPER_MODES: readonly string[] = [
	"banner",
	"fullscreen",
	"overlay",
	"none",
];

/**
 * 壁纸模式的热应用。
 *
 * 前提：`wallpaperModeSwitchable` 为 true——构建期才会把各模式的资源都渲染出来，
 * 关掉时页面里只有当前模式那一套，运行时切会切到不存在的结构上。
 *
 * 与色相一样，站主改的东西不能盖掉访客自己的选择，判定见
 * `isWallpaperVisitorChoice()`。
 */
function applyBannerMode(value: unknown): void {
	if (!displaySettingsConfig.wallpaperModeSwitchable) return;
	if (typeof value !== "string" || !WALLPAPER_MODES.includes(value)) return;

	const mode = value as WALLPAPER_MODE;
	const current = document.documentElement.getAttribute("data-wallpaper-mode");

	// 已经是对的模式：只补记录，不做重排（避免首屏进来又过渡一次）
	if (current === mode) {
		rememberWallpaperMode(mode);
		return;
	}
	if (isWallpaperVisitorChoice()) return;

	// 首屏已经渲染完，这里是「纠正」而不是「切换」，不要过渡动画
	applyWallpaperModeToDocument(mode, false);
	rememberWallpaperMode(mode);
}

/** 写值的同时留一条 auto 记录，下次加载才能把「我们写的」和「访客选的」分开 */
function rememberWallpaperMode(mode: WALLPAPER_MODE): void {
	try {
		localStorage.setItem("wallpaperMode", mode);
		localStorage.setItem("wallpaperModeAuto", mode);
	} catch {
		// 隐私模式下写不进去，只是下次首屏会按构建值渲染再纠正一次
	}
}

/** 构建时写进 `#config-carrier` 的默认模式，用来识别「面板落盘的默认值」 */
function getBuildWallpaperMode(): string {
	const carrier = document.getElementById("config-carrier");
	const raw = carrier?.dataset.wallpaperMode;
	return typeof raw === "string" && raw ? raw : "banner";
}

/**
 * 访客是否自己切过壁纸模式。
 *
 * - 没存过 → 没有选择
 * - 存的正好是构建默认值 → 面板初始化写的，不是选择
 * - 存的值等于 `wallpaperModeAuto` → 上次热配置写的，不是选择
 * - 没有 `wallpaperModeAuto` 记录 → 这段逻辑上线前的存量数据，分不清；
 *   按「站主的配置优先」处理一次，之后访客再手动切换就会有记录
 */
function isWallpaperVisitorChoice(): boolean {
	try {
		const stored = localStorage.getItem("wallpaperMode");
		if (stored === null) return false;
		if (stored === getBuildWallpaperMode()) return false;
		const auto = localStorage.getItem("wallpaperModeAuto");
		if (auto === null) return false;
		return stored !== auto;
	} catch {
		return false;
	}
}

function readPath(source: unknown, keys: string[]): unknown {
	let node = source;
	for (const key of keys) {
		if (!node || typeof node !== "object") return undefined;
		node = (node as Record<string, unknown>)[key];
	}
	return node;
}

/**
 * 判断访客是否自己调过色相。
 *
 * 设置面板挂载时会把自己的状态落盘（`setHue`），所以**每个访客的 `hue` 键都存在**，
 * 光看「有没有」等于永远认为他调过。这里用两个参照排除自动写入：
 *  - 等于构建时的值 → 面板写的默认值
 *  - 等于上次热配置应用后记下的 `hueAuto` → 我们写的
 * 剩下的才真的是访客拖动滑块产生的。
 */
function isVisitorChoice(): boolean {
	try {
		const raw = localStorage.getItem("hue");
		if (raw === null) return false;
		const stored = Number(raw);
		if (!Number.isFinite(stored)) return false;
		if (stored === getDefaultHue()) return false;
		const auto = Number(localStorage.getItem("hueAuto"));
		return !(Number.isFinite(auto) && stored === auto);
	} catch {
		return false;
	}
}
