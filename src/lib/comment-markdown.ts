/**
 * 评论正文的 Markdown → DOM。
 *
 * 为什么不用 sanitize-html：那个包是 Node 向的（依赖 htmlparser2 / postcss），
 * 打进浏览器 bundle 体积大，还得赌 Vite 能正确解析它的 Node 内建依赖。
 *
 * 这里的做法是「白名单重建」：marked 解析成 HTML 后先塞进 DOMParser 的惰性文档
 * （不执行脚本、不加载图片），再逐个节点按白名单重新创建 —— 输出里除了我们自己
 * createElement 出来的元素，没有任何来自用户的标记，注入面为零。
 */

const ALLOWED_TAGS: Record<string, string[]> = {
	P: [],
	BR: [],
	STRONG: [],
	B: [],
	EM: [],
	I: [],
	DEL: [],
	S: [],
	CODE: [],
	PRE: [],
	BLOCKQUOTE: [],
	UL: [],
	OL: [],
	LI: [],
	HR: [],
	H1: [],
	H2: [],
	H3: [],
	H4: [],
	A: ["href", "title"],
};

/** 这些标签连着内容一起丢，只留文字反而会变成「假正文」 */
const DROP_WHOLE = new Set([
	"SCRIPT",
	"STYLE",
	"IFRAME",
	"OBJECT",
	"EMBED",
	"LINK",
	"META",
	"FORM",
	"INPUT",
	"TEXTAREA",
	"BUTTON",
	"SVG",
	"MATH",
	"IMG",
	"VIDEO",
	"AUDIO",
	"CANVAS",
]);

function isSafeHref(value: string): boolean {
	const href = value.trim();
	// 只放行绝对协议与站内路径；javascript: / data: 一律丢
	return /^(https?:\/\/|mailto:|\/)/i.test(href);
}

function cleanInto(source: Node, target: Node): void {
	for (const child of Array.from(source.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			target.appendChild(document.createTextNode(child.nodeValue ?? ""));
			continue;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) continue;

		const element = child as Element;
		const tag = element.tagName.toUpperCase();
		if (DROP_WHOLE.has(tag)) continue;

		const allowedAttrs = ALLOWED_TAGS[tag];
		if (!allowedAttrs) {
			// 没在白名单里的容器（div、span、table…）：拆掉壳，内容上提
			cleanInto(element, target);
			continue;
		}

		const out = document.createElement(tag.toLowerCase());
		for (const attr of allowedAttrs) {
			const value = element.getAttribute(attr);
			if (value === null) continue;
			if (attr === "href" && !isSafeHref(value)) continue;
			out.setAttribute(attr, value);
		}
		if (tag === "A") {
			out.setAttribute("rel", "nofollow noopener noreferrer");
			out.setAttribute("target", "_blank");
		}
		cleanInto(element, out);
		target.appendChild(out);
	}
}

/**
 * 渲染成 DocumentFragment，调用方直接 appendChild。
 * marked 按需加载：评论不滚动到视口就不下载这 13 KB。
 */
export async function renderCommentMarkdown(
	source: string,
): Promise<DocumentFragment> {
	const { marked } = await import("marked");
	const html = marked.parse(source, {
		gfm: true,
		breaks: true,
		async: false,
	}) as string;

	const doc = new DOMParser().parseFromString(html, "text/html");
	const fragment = document.createDocumentFragment();
	cleanInto(doc.body, fragment);
	return fragment;
}
