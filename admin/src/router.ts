import { ref } from "vue";

/**
 * 手写 hash 路由，不引 vue-router：
 * 主站是静态站，/admin/ 下只有 index.html，用 hash 不需要任何服务端重写规则。
 */
export type RouteName =
	| "overview"
	| "posts"
	| "post-edit"
	| "components"
	| "review"
	| "admin";

export interface Route {
	name: RouteName;
	/** post-edit 用：文章 id */
	id?: number;
}

const ROUTES: RouteName[] = [
	"overview",
	"posts",
	"post-edit",
	"components",
	"review",
	"admin",
];

function parse(hash: string): Route {
	const raw = hash.replace(/^#\/?/, "").replace(/\/$/, "");
	if (!raw) return { name: "overview" };
	const [head, tail] = raw.split("/");
	const name = head as RouteName;
	if (!ROUTES.includes(name)) return { name: "overview" };

	// 编辑页的地址是 /posts/<id>，与列表 /posts 共用同一段前缀
	if (name === "posts" && tail !== undefined) {
		const id = Number(tail);
		if (Number.isInteger(id) && id > 0) return { name: "post-edit", id };
		return { name: "posts" };
	}
	if (name === "post-edit") {
		const id = Number(tail);
		return Number.isInteger(id) && id > 0 ? { name, id } : { name: "posts" };
	}
	return { name };
}

export const route = ref<Route>(parse(location.hash));

window.addEventListener("hashchange", () => {
	route.value = parse(location.hash);
});

/** 页内跳转。空 hash 时不会触发 hashchange，所以手动同步一次 */
export function go(path: string): void {
	const next = `#${path}`;
	if (location.hash === next) return;
	if (location.hash === "" && path === "/overview") return;
	location.hash = next;
}

export function goPostEdit(id: number): void {
	go(`/posts/${id}`);
}

export function replaceHash(path: string): void {
	history.replaceState(null, "", `#${path}`);
	route.value = parse(`#${path}`);
}
