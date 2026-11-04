import { renderCommentMarkdown } from "./comment-markdown";

/**
 * 站内评论区的前端逻辑。
 *
 * 用「静态容器 + 导航后重建」的写法（与侧栏组件一致）：
 * 容器在 #swup-container 里，站内跳转会被整体替换，所以每个新容器都要重新挂一次。
 * 事件监听挂在容器本身上，容器被丢弃时监听一起没，不会累加。
 */

interface CommentConfigPayload {
	enabled: boolean;
	requireApproval: boolean;
	allowGuest: boolean;
	maxLength: number;
}

interface CommentItem {
	id: number;
	parent_id: number | null;
	name: string;
	avatar_url: string | null;
	uid: number | null;
	is_admin: boolean;
	body_md: string;
	created_at: string;
	can_delete: boolean;
}

interface CommentPayload {
	target: string;
	config: CommentConfigPayload;
	total: number;
	items: CommentItem[];
	viewer: {
		uid: number;
		name: string;
		avatar_url: string | null;
		is_admin: boolean;
	} | null;
}

const API = "/api/comments";

/**
 * 游客凭证。
 *
 * 游客评论没有 uid，服务端在发表时返回一个随机令牌，只返回这一次。
 * 存本地，凭它换删除权。库被拖走也拿不到原文（只存了摘要）。
 * 换设备、清缓存、换浏览器即失效——这是没有账号的必然代价，不做补救。
 */
const TOKEN_KEY = "yb.comment-tokens";
const TOKEN_LIMIT = 200;

interface StoredToken {
	id: number;
	token: string;
}

let tokenCache: Map<number, string> | null = null;

function readTokenStore(): StoredToken[] {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(TOKEN_KEY);
	} catch {
		// 无痕模式／禁用存储时访问就抛，评论本身不该因此不可用
		return [];
	}
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is StoredToken =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as StoredToken).id === "number" &&
				typeof (entry as StoredToken).token === "string",
		);
	} catch {
		return [];
	}
}

function tokenMap(): Map<number, string> {
	if (!tokenCache) {
		tokenCache = new Map(readTokenStore().map((item) => [item.id, item.token]));
	}
	return tokenCache;
}

function persistTokens(): void {
	if (!tokenCache) return;
	const list = [...tokenCache.entries()].map(([id, token]) => ({ id, token }));
	try {
		localStorage.setItem(TOKEN_KEY, JSON.stringify(list));
	} catch {
		// 存不进去不影响本次会话的删除（内存里的 map 还在）
	}
}

function rememberGuestToken(id: number, token: string): void {
	const map = tokenMap();
	map.set(id, token);
	// Map 按插入顺序遍历，超量时淘汰最老的
	while (map.size > TOKEN_LIMIT) {
		const oldest = map.keys().next();
		if (oldest.done) break;
		map.delete(oldest.value);
	}
	persistTokens();
}

function guestTokenOf(id: number): string | null {
	return tokenMap().get(id) ?? null;
}

function forgetGuestToken(id: number): void {
	if (!tokenMap().delete(id)) return;
	persistTokens();
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function relativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return iso;
	const diff = Date.now() - then;
	if (diff < 60_000) return "刚刚";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
	if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
	return iso.slice(0, 10);
}

/** 没有头像时用名字首字 + 稳定色相，同一个人每次颜色都一样 */
function avatarColor(name: string): string {
	let hash = 0;
	for (const char of name) {
		hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
	}
	return `hsl(${hash} 55% 52%)`;
}

function avatarNode(name: string, url: string | null): HTMLElement {
	if (url) {
		const img = el("img", "yb-c-avatar");
		img.src = url;
		img.alt = "";
		img.loading = "lazy";
		img.referrerPolicy = "no-referrer";
		return img;
	}
	const span = el("span", "yb-c-avatar yb-c-avatar-text", [...name][0] ?? "?");
	span.style.background = avatarColor(name);
	return span;
}

function renderItem(item: CommentItem, depth: number): HTMLElement {
	const wrap = el("li", "yb-c-item");
	if (depth > 0) wrap.dataset.depth = String(Math.min(depth, 2));

	const head = el("div", "yb-c-item-head");
	head.appendChild(avatarNode(item.name, item.avatar_url));

	const meta = el("div", "yb-c-item-meta");
	const nameRow = el("div", "yb-c-name-row");
	nameRow.appendChild(el("span", "yb-c-name", item.name));
	if (item.is_admin) nameRow.appendChild(el("span", "yb-c-badge", "站长"));
	if (item.uid === null)
		nameRow.appendChild(el("span", "yb-c-badge yb-c-badge-guest", "游客"));
	meta.appendChild(nameRow);

	const time = el("time", "yb-c-time", relativeTime(item.created_at));
	time.dateTime = item.created_at;
	time.title = item.created_at.replace("T", " ").slice(0, 19);
	meta.appendChild(time);
	head.appendChild(meta);
	wrap.appendChild(head);

	const body = el("div", "yb-c-body");
	wrap.appendChild(body);

	const actions = el("div", "yb-c-actions");
	const replyBtn = el("button", "yb-c-link", "回复");
	replyBtn.type = "button";
	replyBtn.dataset.replyId = String(item.id);
	replyBtn.dataset.replyName = item.name;
	actions.appendChild(replyBtn);

	// 登录本人的评论看 can_delete；游客评论看本浏览器有没有存过它的令牌
	const mine = item.can_delete || guestTokenOf(item.id) !== null;
	if (mine) {
		const del = el("button", "yb-c-link yb-c-danger", "删除");
		del.type = "button";
		del.dataset.deleteId = String(item.id);
		actions.appendChild(del);
	}
	wrap.appendChild(actions);

	// Markdown 异步渲染：先占位，好了再填，避免整块列表等一个 await
	void renderCommentMarkdown(item.body_md).then((fragment) => {
		body.appendChild(fragment);
	});

	return wrap;
}

function buildTree(items: CommentItem[]): {
	roots: CommentItem[];
	children: Map<number, CommentItem[]>;
} {
	const ids = new Set(items.map((item) => item.id));
	const roots: CommentItem[] = [];
	const children = new Map<number, CommentItem[]>();

	for (const item of items) {
		if (item.parent_id && ids.has(item.parent_id)) {
			const list = children.get(item.parent_id) ?? [];
			list.push(item);
			children.set(item.parent_id, list);
		} else {
			roots.push(item);
		}
	}
	return { roots, children };
}

function appendTree(
	list: HTMLElement,
	item: CommentItem,
	children: Map<number, CommentItem[]>,
	depth: number,
): void {
	list.appendChild(renderItem(item, depth));
	for (const child of children.get(item.id) ?? []) {
		// 视觉上最多缩两层，再深就和上一层平铺，免得手机上被挤成一条线
		const holder = el("li", "yb-c-children");
		holder.dataset.depth = String(depth + 1);
		const inner = el("ol", "yb-c-list");
		appendTree(inner, child, children, depth + 1);
		holder.appendChild(inner);
		list.appendChild(holder);
	}
}

export async function mountCommentSection(root: HTMLElement): Promise<void> {
	const queryKey = root.dataset.targetQuery;
	let target = root.dataset.target ?? "";
	if (queryKey) {
		const fromQuery = new URL(location.href).searchParams.get(queryKey);
		if (fromQuery) target = `dynamic:${fromQuery}`;
	}
	if (!target) return;

	root.replaceChildren(el("div", "yb-c-loading", "正在加载评论…"));

	let payload: CommentPayload;
	try {
		const response = await fetch(
			`${API}?target=${encodeURIComponent(target)}`,
			{ headers: { accept: "application/json" } },
		);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		payload = (await response.json()) as CommentPayload;
	} catch {
		root.replaceChildren(el("div", "yb-c-error", "评论加载失败，刷新试试"));
		return;
	}

	if (!payload.config.enabled) {
		root.replaceChildren();
		root.hidden = true;
		return;
	}

	const state = {
		config: payload.config,
		viewer: payload.viewer,
		replyTo: null as { id: number; name: string } | null,
		busy: false,
	};

	const head = el("div", "yb-c-head");
	const title = el("span", "yb-c-title", `${payload.total} 条评论`);
	head.appendChild(title);
	head.appendChild(el("span", "yb-c-hint", "支持 Markdown"));

	const form = el("form", "yb-c-form");
	form.noValidate = true;

	const replyBar = el("div", "yb-c-replybar");
	replyBar.hidden = true;
	const replyText = el("span", "", "");
	const replyCancel = el("button", "yb-c-link", "取消");
	replyCancel.type = "button";
	replyBar.append(replyText, replyCancel);

	const identity = el("div", "yb-c-identity");
	if (state.viewer) {
		identity.appendChild(
			avatarNode(state.viewer.name, state.viewer.avatar_url),
		);
		const line = el("div", "yb-c-identity-text");
		line.appendChild(el("strong", "", state.viewer.name));
		line.appendChild(
			el(
				"span",
				"yb-c-hint",
				state.viewer.is_admin ? "以站长身份发言，免审核" : "已登录",
			),
		);
		identity.appendChild(line);
	} else if (state.config.allowGuest) {
		const nameInput = el("input", "yb-c-input");
		nameInput.name = "name";
		nameInput.placeholder = "昵称";
		nameInput.maxLength = 20;
		nameInput.required = true;

		const emailInput = el("input", "yb-c-input");
		emailInput.name = "email";
		emailInput.type = "email";
		emailInput.placeholder = "邮箱（不会公开）";
		emailInput.required = true;

		identity.append(nameInput, emailInput);
	} else {
		const tip = el("div", "yb-c-hint", "请先登录后评论");
		const link = el("a", "yb-c-link", "去登录");
		link.href = `/login/?next=${encodeURIComponent(location.pathname)}`;
		tip.appendChild(link);
		identity.appendChild(tip);
	}

	const textarea = el("textarea", "yb-c-textarea");
	textarea.rows = 4;
	textarea.maxLength = state.config.maxLength;
	textarea.placeholder = "说点什么…（支持 Markdown）";
	textarea.required = true;

	const foot = el("div", "yb-c-foot");
	const counter = el("span", "yb-c-counter", `0 / ${state.config.maxLength}`);
	const submit = el("button", "yb-c-submit", "发表");
	submit.type = "submit";
	foot.append(counter, submit);

	const status = el("p", "yb-c-status");
	status.hidden = true;

	// 把代价说在前面：游客评论没有账号可查，删除权只在发它的那台浏览器上
	const guestNote = state.viewer
		? null
		: el(
				"p",
				"yb-c-hint yb-c-guest-note",
				"游客评论发表后不能修改；删除权只留在当前浏览器，换设备或清缓存就找不回来了。",
			);

	form.append(replyBar, identity);
	if (guestNote) form.append(guestNote);
	form.append(textarea, foot, status);

	const list = el("ol", "yb-c-list");

	const paintList = (items: CommentItem[]): void => {
		const { roots, children } = buildTree(items);
		list.replaceChildren();
		if (roots.length === 0) {
			list.appendChild(el("li", "yb-c-empty", "还没有评论，来说第一句"));
			return;
		}
		for (const root2 of roots) appendTree(list, root2, children, 0);
	};

	paintList(payload.items);

	const reload = async (): Promise<void> => {
		const response = await fetch(
			`${API}?target=${encodeURIComponent(target)}`,
			{ headers: { accept: "application/json" } },
		);
		if (!response.ok) return;
		const next = (await response.json()) as CommentPayload;
		title.textContent = `${next.total} 条评论`;
		paintList(next.items);
	};

	const setReply = (value: { id: number; name: string } | null): void => {
		state.replyTo = value;
		if (value) {
			replyText.textContent = `正在回复 @${value.name}`;
			replyBar.hidden = false;
			textarea.focus();
		} else {
			replyBar.hidden = true;
		}
	};

	const say = (message: string, tone: "info" | "error"): void => {
		status.textContent = message;
		status.hidden = message.length === 0;
		status.dataset.tone = tone;
	};

	textarea.addEventListener("input", () => {
		counter.textContent = `${[...textarea.value].length} / ${state.config.maxLength}`;
	});

	replyCancel.addEventListener("click", () => setReply(null));

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		if (state.busy) return;

		const body = textarea.value.trim();
		if (body.length === 0) {
			say("先写点内容吧", "error");
			return;
		}

		const fd = new FormData(form);
		const name = String(fd.get("name") ?? "").trim();
		const email = String(fd.get("email") ?? "").trim();
		if (!state.viewer) {
			if (!state.config.allowGuest) {
				say("请先登录", "error");
				return;
			}
			if (name.length === 0 || email.length === 0) {
				say("昵称和邮箱都要填", "error");
				return;
			}
		}

		state.busy = true;
		submit.disabled = true;
		submit.textContent = "发送中…";

		void (async () => {
			try {
				const response = await fetch(API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						target,
						body,
						name: state.viewer ? undefined : name,
						email: state.viewer ? undefined : email,
						parentId: state.replyTo?.id ?? null,
					}),
				});
				const data = (await response.json().catch(() => ({}))) as {
					id?: number;
					status?: string;
					message?: string;
					guest_token?: string;
				};
				if (!response.ok) {
					say(data.message ?? `发送失败（${response.status}）`, "error");
					return;
				}

				// 令牌只在这一个响应里给一次，先存下来再干别的
				if (data.guest_token && typeof data.id === "number") {
					rememberGuestToken(data.id, data.guest_token);
				}

				textarea.value = "";
				counter.textContent = `0 / ${state.config.maxLength}`;
				setReply(null);
				if (data.status === "approved") {
					say("", "info");
					await reload();
				} else {
					say(data.message ?? "已提交，等站长看一眼就会显示", "info");
				}
			} catch {
				say("网络不太好，稍后再试", "error");
			} finally {
				state.busy = false;
				submit.disabled = false;
				submit.textContent = "发表";
			}
		})();
	});

	list.addEventListener("click", (event) => {
		const node = (event.target as HTMLElement).closest<HTMLElement>(
			"[data-reply-id], [data-delete-id]",
		);
		if (!node) return;

		const replyId = node.dataset.replyId;
		if (replyId) {
			setReply({
				id: Number(replyId),
				name: node.dataset.replyName ?? "这条评论",
			});
			return;
		}

		const deleteId = node.dataset.deleteId;
		if (!deleteId) return;
		if (!confirm("确定删除这条评论？它下面的回复也会一起删掉。")) return;

		void (async () => {
			const token = guestTokenOf(Number(deleteId));
			const response = await fetch(`${API}/${deleteId}`, {
				method: "DELETE",
				// 令牌走 header：查参数会进访问日志与 Referer
				headers: token ? { "x-comment-token": token } : undefined,
			});
			if (!response.ok) {
				const data = (await response.json().catch(() => ({}))) as {
					message?: string;
				};
				alert(data.message ?? "删除失败");
				return;
			}
			forgetGuestToken(Number(deleteId));
			await reload();
		})();
	});

	root.replaceChildren(head, form, list);
}

/**
 * 每次导航后调用：容器是新的（没有 data-ready），旧的已被 swup 丢弃。
 */
export function initCommentSections(): void {
	const nodes = document.querySelectorAll<HTMLElement>("[data-yb-comments]");
	for (const node of nodes) {
		if (node.dataset.ready === "1") continue;
		node.dataset.ready = "1";
		void mountCommentSection(node);
	}
}
