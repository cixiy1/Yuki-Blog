import { getDefaultHue } from "@/utils/setting-utils";

/**
 * 热配置的运行时应用。
 *
 * 只有「改完不必等构建」的字段会走到这里，目前就一个：主题色相 `--hue`。
 * 它不参与 SEO、不决定结构，站点里只有一处消费（根节点的 CSS 变量），
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
	if (typeof hue !== "number" || !Number.isFinite(hue)) return;
	if (hue < 0 || hue > 360) return;
	// 与构建产物一致就什么都不用做
	if (hue === buildHue) return;

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
