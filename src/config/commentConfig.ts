import type { CommentConfig } from "../types/commentConfig";

export const commentConfig: CommentConfig = {
	// 站内评论：数据在 D1，前端运行时拉取；审核与开关在管理端 #/comments。
	// 想换回第三方评论，把这里改成 "giscus" / "twikoo" 等即可（要重新构建）。
	type: "self-hosted",
	twikoo: {
		envId: "https://twikoo.vercel.app",
		lang: "zh-CN",
		visitorCount: true,
		jsUrl: "https://cdn.jsdelivr.net/npm/twikoo@1.7.14/dist/twikoo.min.js",
		cssUrl: "/assets/css/twikoo-custom.css",
	},
	waline: {
		serverURL: "https://waline.vercel.app",
		lang: "zh-CN",
		emoji: [
			"https://unpkg.com/@waline/emojis@1.4.0/weibo",
			"https://unpkg.com/@waline/emojis@1.4.0/bilibili",
			"https://unpkg.com/@waline/emojis@1.4.0/bmoji",
		],
		login: "enable",
		visitorCount: true,
	},
	artalk: {
		server: "https://artalk.example.com/",
		locale: "zh-CN",
		visitorCount: true,
	},
	giscus: {
		repo: "cixiy1/Yuki-blog-retired",
		repoId: "R_kgDOTx2vjg",
		category: "General",
		categoryId: "DIC_kwDOTx2vjs4DC9oL",
		mapping: "title",
		strict: "0",
		reactionsEnabled: "1",
		emitMetadata: "1",
		inputPosition: "top",
		lang: "zh-CN",
		loading: "lazy",
	},
	disqus: {
		shortname: "firefly",
	},
};
