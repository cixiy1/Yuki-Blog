/**
 * 「站点设置」的字段描述。
 *
 * 这里是唯一来源：管理端据此渲染表单，服务端的白名单（`server/lib/site-config.ts`
 * 的 CONFIG_SPEC）与它保持同一套字段名。加字段时两边一起加，否则保存会被服务端拒掉。
 *
 * 两层结构：
 *  分组 group  —— 左侧 tab，给人一个心理分区
 *  小节 section —— 卡片；**namespace 挂在节上**，因为同一个 tab 可能横跨不同的
 *                  配置文件（「首页」既要有横幅也要有公告）
 *
 * `path` 相对所属 namespace 的点号路径，例如 `themeColor.hue`。
 */
export type FieldType =
	| "text"
	| "textarea"
	| "number"
	| "switch"
	| "select"
	| "tags"
	| "hue"
	| "list"
	/** 图片：一个路径输入框 + 选图按钮，值仍是字符串，走媒体库 */
	| "image";

/** 列表里每一行的字段 */
export interface ListItemField {
	path: string;
	label: string;
	type: Exclude<FieldType, "list">;
	placeholder?: string;
	options?: Array<{ value: string; label: string }>;
	min?: number;
	max?: number;
	step?: number;
}

export interface SettingField {
	path: string;
	label: string;
	type: FieldType;
	help?: string;
	/** 改完不用等构建（只有色相这类不参与 SEO、不影响结构的才算） */
	hot?: boolean;
	/** 改错会影响全站，保存前二次确认 */
	danger?: boolean;
	/**
	 * 可视化选择器，替代原生下拉。
	 * `wallpaper` = 四宫格壁纸模式预览（图像比文字直观，选中即改值）
	 */
	preview?: "wallpaper";
	min?: number;
	max?: number;
	step?: number;
	options?: Array<{ value: string; label: string; short?: string }>;
	placeholder?: string;
	/** type = list 时的行内字段 */
	itemFields?: ListItemField[];
	/** type = list 时用哪一列做行标题；留空则显示序号 */
	itemTitle?: string;
	/** type = list 时的空态提示 */
	emptyText?: string;
}

export interface SettingSection {
	title: string;
	/** 该节的字段属于哪个配置分区（对应 config/site.json 的顶层键） */
	namespace: ConfigNamespace;
	note?: string;
	fields: SettingField[];
}

export interface SettingGroup {
	key: string;
	label: string;
	desc: string;
	sections: SettingSection[];
}

/** 与服务端 CONFIG_SPEC 的顶层键一一对应 */
export type ConfigNamespace =
	| "site"
	| "profile"
	| "music"
	| "friends"
	| "banner"
	| "announcement"
	| "sponsor";

const switchField = (
	path: string,
	label: string,
	help?: string,
): SettingField => ({ path, label, type: "switch", help });

export const SETTING_GROUPS: SettingGroup[] = [
	{
		key: "basic",
		label: "基本信息",
		desc: "站点标题、描述、语言与时区。改这些会进 <title>、RSS 与分享卡片，必须发布。",
		sections: [
			{
				title: "站点标识",
				namespace: "site",
				fields: [
					{
						path: "title",
						label: "站点标题",
						type: "text",
						placeholder: "Yuki Blog",
					},
					{
						path: "subtitle",
						label: "副标题",
						type: "text",
						placeholder: "雪穗博客",
					},
					{
						path: "description",
						label: "站点描述",
						type: "textarea",
						help: "首页与分享卡片的默认描述",
					},
					{
						path: "keywords",
						label: "关键词",
						type: "tags",
						help: "回车添加，最多 30 个",
					},
				],
			},
			{
				title: "站点位置",
				namespace: "site",
				fields: [
					{
						path: "site_url",
						label: "站点 URL",
						type: "text",
						danger: true,
						help: "影响 sitemap、RSS 与绝对链接，改错会让全站链接失效",
					},
					{
						path: "lang",
						label: "站点语言",
						type: "select",
						danger: true,
						options: [
							{ value: "zh_CN", label: "简体中文" },
							{ value: "zh_TW", label: "繁體中文" },
							{ value: "en", label: "English" },
							{ value: "ja", label: "日本語" },
							{ value: "ru", label: "Русский" },
							{ value: "ko", label: "한국어" },
						],
					},
					{
						path: "timezone",
						label: "时区",
						type: "text",
						placeholder: "Asia/Shanghai",
						help: "构建日期、时间显示的换算基准",
					},
					{
						path: "siteStartDate",
						label: "建站日期",
						type: "text",
						placeholder: "2026-08-09",
						help: "用于计算运行天数",
					},
				],
			},
		],
	},
	{
		key: "appearance",
		label: "外观",
		desc: "主题色、布局与导航栏。只有色相能「立即应用」，其余需要发布。",
		sections: [
			{
				title: "主题",
				namespace: "site",
				fields: [
					{
						path: "themeColor.hue",
						label: "主题色相",
						type: "hue",
						hot: true,
						help: "0–360。访客自己在设置面板选过色相时以访客为准",
					},
					{
						path: "themeColor.defaultMode",
						label: "默认模式",
						type: "select",
						options: [
							{ value: "light", label: "浅色" },
							{ value: "dark", label: "深色" },
							{ value: "system", label: "跟随系统" },
						],
					},
					{
						path: "pageWidth",
						label: "页面宽度",
						type: "number",
						min: 60,
						max: 160,
						step: 1,
						help: "单位 rem。单侧栏时建议调小",
					},
				],
			},
			{
				title: "卡片",
				namespace: "site",
				fields: [
					switchField("card.border", "卡片边框与阴影", "开启后更有立体感"),
					switchField("card.followTheme", "卡片跟随主题色"),
				],
			},
			{
				title: "导航栏",
				namespace: "site",
				fields: [
					{ path: "navbar.title", label: "导航栏标题", type: "text" },
					switchField("navbar.widthFull", "全宽导航栏"),
					{
						path: "navbar.menuAlign",
						label: "菜单对齐",
						type: "select",
						options: [
							{ value: "left", label: "左对齐" },
							{ value: "center", label: "居中" },
						],
					},
					{
						path: "navbar.navbarMode",
						label: "导航栏模式",
						type: "select",
						options: [
							{ value: "static", label: "随页面滚动消失" },
							{ value: "fixed", label: "固定在顶部" },
							{ value: "dynamic", label: "下滑隐藏、上滑显示" },
						],
					},
					switchField("navbar.followTheme", "图标与标题跟随主题色"),
				],
			},
			{
				title: "标签与分类",
				namespace: "site",
				fields: [
					{
						path: "categoryStyle",
						label: "分类按钮样式",
						type: "select",
						options: [
							{ value: "pill", label: "胶囊" },
							{ value: "rectangle", label: "矩形" },
						],
					},
					{
						path: "tagStyle",
						label: "标签样式",
						type: "select",
						options: [
							{ value: "pill", label: "胶囊（主题色）" },
							{ value: "pill-gray", label: "胶囊（灰色）" },
							{ value: "rectangle", label: "矩形" },
						],
					},
				],
			},
		],
	},
	{
		key: "pages",
		label: "页面",
		desc: "页面开关直接决定路由是否存在：关掉后该页返回 404，导航项也会消失。必须发布。",
		sections: [
			{
				title: "栏目开关",
				namespace: "site",
				note: "关闭一个栏目会同时移除它的路由与导航入口",
				fields: [
					switchField("pages.friends", "友链"),
					switchField("pages.guestbook", "留言板", "需要先配好评论系统"),
					switchField("pages.dynamic", "动态"),
					switchField("pages.projects", "项目展示"),
					switchField("pages.gallery", "相册"),
					switchField("pages.booknav", "书签导航"),
					switchField("pages.bilibili", "哔哩哔哩追番"),
					switchField("pages.bangumi", "番组计划"),
					switchField("pages.vndb", "VNDB"),
					switchField("pages.mal", "MyAnimeList"),
					switchField("pages.sponsor", "打赏", "内容在「打赏页」里改"),
				],
			},
			{
				title: "列表与分类栏",
				namespace: "site",
				fields: [
					switchField("categoryBar", "首页与归档页顶部分类栏"),
					{
						path: "pagination.postsPerPage",
						label: "每页文章数",
						type: "number",
						min: 1,
						max: 50,
					},
				],
			},
		],
	},
	{
		key: "sponsor",
		label: "打赏页",
		desc: "收款码、打赏者名单与头像都在这里改；页面本身开不开在「页面 → 栏目开关」。都要发布，等一次构建才生效。",
		sections: [
			{
				title: "页面文案",
				namespace: "sponsor",
				note: "留空则用主题内置的文案",
				fields: [
					{
						path: "title",
						label: "页面标题",
						type: "text",
						placeholder: "打赏",
					},
					{
						path: "description",
						label: "页面描述",
						type: "textarea",
						placeholder: "支持一下",
						help: "标题右侧的一句话",
					},
					{
						path: "usage",
						label: "用途说明",
						type: "textarea",
						help: "打赏会花在哪，显示在页面顶部的提示框里",
					},
				],
			},
			{
				title: "显示项",
				namespace: "sponsor",
				fields: [
					switchField("showSponsorsList", "显示打赏者名单"),
					switchField("showButtonInPost", "文章底部显示打赏按钮"),
					switchField(
						"showComment",
						"页面底部显示评论区",
						"需要先在「评论」里配好评论系统",
					),
				],
			},
			{
				title: "打赏方式",
				namespace: "sponsor",
				note: "每种方式一张卡片：图标、名称、描述，加收款码或跳转链接，至少有一个",
				fields: [
					{
						path: "methods",
						label: "打赏方式",
						type: "list",
						itemTitle: "name",
						emptyText: "还没有打赏方式，页面上不会出现任何收款入口",
						itemFields: [
							{
								path: "name",
								label: "名称",
								type: "text",
								placeholder: "微信",
							},
							{
								path: "icon",
								label: "图标",
								type: "text",
								placeholder: "fa7-brands:weixin",
							},
							{
								path: "description",
								label: "描述",
								type: "text",
								placeholder: "扫码请我喝杯奶茶",
							},
							{
								path: "qrCode",
								label: "收款码",
								type: "image",
							},
							{
								path: "link",
								label: "跳转链接",
								type: "text",
								placeholder: "https://…",
							},
							{ path: "enabled", label: "启用", type: "switch" },
						],
					},
				],
			},
			{
				title: "打赏者名单",
				namespace: "sponsor",
				note: "头像可以现传或从媒体库选，也可直接贴外链；不填则用名字首字兜底",
				fields: [
					{
						path: "sponsors",
						label: "打赏者",
						type: "list",
						itemTitle: "name",
						emptyText: "还没有记录，页面上会显示一句「暂无」",
						itemFields: [
							{
								path: "name",
								label: "称呼",
								type: "text",
								placeholder: "Crescent.ice",
							},
							{ path: "avatar", label: "头像", type: "image" },
							{
								path: "amount",
								label: "金额",
								type: "text",
								placeholder: "¥10",
							},
							{
								path: "date",
								label: "日期",
								type: "text",
								placeholder: "2026-11-08",
							},
						],
					},
				],
			},
		],
	},
	{
		key: "post",
		label: "文章页",
		desc: "文章详情页的附加模块。OG 图与沉浸阅读这类会影响构建产物，需要发布。",
		sections: [
			{
				title: "文章页模块",
				namespace: "site",
				fields: [
					switchField("post.share", "分享按钮"),
					switchField("post.postNavigation", "上一篇 / 下一篇"),
					switchField("post.relatedPosts", "相关文章推荐"),
					switchField("post.randomPosts", "随机文章推荐"),
					switchField("post.showLastModified", "「上次编辑」卡片"),
					{
						path: "post.outdatedThreshold",
						label: "过期提示阈值",
						type: "number",
						min: 1,
						max: 3650,
						help: "超过这么多天才显示「上次编辑」",
					},
					{
						path: "post.generateOgImages",
						label: "生成 OpenGraph 图片",
						type: "switch",
						help: "明显拖慢构建，本地调试建议关掉",
					},
				],
			},
			{
				title: "沉浸阅读",
				namespace: "site",
				fields: [
					switchField("post.immersiveReading.enable", "显示沉浸阅读按钮"),
					switchField("post.immersiveReading.defaultOn", "进入文章页默认开启"),
					switchField("post.immersiveReading.tocEnabled", "显示目录栏"),
					{
						path: "post.immersiveReading.tocPosition",
						label: "目录位置",
						type: "select",
						options: [
							{ value: "left", label: "左侧" },
							{ value: "right", label: "右侧" },
						],
					},
				],
			},
		],
	},
	{
		key: "home",
		label: "首页",
		desc: "首页横幅与公告栏。都写在 HTML 里，必须发布。",
		sections: [
			{
				title: "首页横幅",
				namespace: "banner",
				fields: [
					{
						path: "mode",
						label: "壁纸模式",
						type: "select",
						hot: true,
						preview: "wallpaper",
						help: "点缩略图直接切换。保存后自动对访客生效，不必等构建；发布只是让新访客首屏就用新模式渲染",
						options: [
							{ value: "banner", label: "横幅（首页顶部）", short: "顶部横幅" },
							{ value: "fullscreen", label: "全屏壁纸", short: "全屏壁纸" },
							{ value: "overlay", label: "覆盖透明", short: "覆盖透明" },
							{ value: "none", label: "纯色背景", short: "纯色背景" },
						],
					},
					{
						path: "common.dimOpacity",
						label: "壁纸遮罩暗度",
						type: "number",
						min: 0,
						max: 1,
						step: 0.05,
						help: "0–1，值越大越暗，文字越清楚",
					},
					switchField("common.homeText.enable", "显示横幅文字"),
					{
						path: "common.homeText.title",
						label: "横幅主标题",
						type: "text",
						placeholder: "分明一觉华胥梦，回首东风泪满衣",
					},
					{
						path: "common.homeText.titleSize",
						label: "主标题字号",
						type: "text",
						placeholder: "4.5rem",
					},
					{
						path: "common.homeText.subtitle",
						label: "横幅副标题",
						type: "tags",
						help: "可填多条；开会打字机效果时循环显示",
					},
					{
						path: "common.homeText.subtitleSize",
						label: "副标题字号",
						type: "text",
						placeholder: "1.5rem",
					},
					switchField(
						"common.homeText.typewriter.enable",
						"打字机效果",
						"关闭后每次刷新随机显示一条副标题",
					),
					{
						path: "common.homeText.typewriter.speed",
						label: "打字速度",
						type: "number",
						min: 0,
						max: 5000,
						help: "毫秒/字",
					},
					{
						path: "common.homeText.typewriter.deleteSpeed",
						label: "删除速度",
						type: "number",
						min: 0,
						max: 5000,
						help: "毫秒/字",
					},
					{
						path: "common.homeText.typewriter.pauseTime",
						label: "停留时间",
						type: "number",
						min: 0,
						max: 60000,
						help: "整句显示完后停多久，单位毫秒",
					},
					switchField("common.homeText.linksEnable", "显示标题下方链接图标"),
				],
			},
			{
				title: "公告",
				namespace: "announcement",
				fields: [
					{
						path: "title",
						label: "公告标题",
						type: "text",
						placeholder: "留空则用默认标题",
					},
					{ path: "content", label: "公告内容", type: "textarea" },
					switchField("closable", "允许访客关闭"),
					switchField("link.enable", "显示底部链接"),
					{ path: "link.text", label: "链接文字", type: "text" },
					{
						path: "link.url",
						label: "链接地址",
						type: "text",
						placeholder: "/about/",
					},
					switchField("link.external", "作为外链打开"),
				],
			},
		],
	},
	{
		key: "profile",
		label: "个人资料",
		desc: "侧栏资料卡与社交图标。发布后生效。",
		sections: [
			{
				title: "资料卡",
				namespace: "profile",
				fields: [
					{
						path: "name",
						label: "昵称",
						type: "text",
						placeholder: "雪穗",
					},
					{
						path: "bio",
						label: "个人签名",
						type: "textarea",
					},
					{
						path: "avatar",
						label: "头像",
						type: "text",
						help: "以 / 开头走 public 目录；不以 / 开头走 src 目录会自动优化；也可填远程 URL",
					},
				],
			},
			{
				title: "社交链接",
				namespace: "profile",
				fields: [
					{
						path: "links",
						label: "链接列表",
						type: "list",
						itemTitle: "name",
						emptyText: "还没有社交链接，点「添加一行」开始",
						itemFields: [
							{
								path: "name",
								label: "名称",
								type: "text",
								placeholder: "GitHub",
							},
							{
								path: "icon",
								label: "图标",
								type: "text",
								placeholder: "fa7-brands:github",
							},
							{
								path: "url",
								label: "地址",
								type: "text",
								placeholder: "https://",
							},
							{ path: "showName", label: "显示文字", type: "switch" },
						],
					},
				],
			},
		],
	},
	{
		key: "music",
		label: "音乐",
		desc: "播放器入口与本地歌单。歌单第一首是默认曲目。发布后生效。",
		sections: [
			{
				title: "播放器",
				namespace: "music",
				fields: [
					switchField("showInNavbar", "导航栏显示入口"),
					switchField("showInSidebar", "侧边栏显示播放器"),
					{
						path: "mode",
						label: "音源方式",
						type: "select",
						options: [
							{ value: "local", label: "本地歌单" },
							{ value: "meting", label: "Meting API" },
						],
					},
					{
						path: "volume",
						label: "默认音量",
						type: "number",
						min: 0,
						max: 1,
						step: 0.05,
					},
					{
						path: "playMode",
						label: "播放模式",
						type: "select",
						options: [
							{ value: "list", label: "列表循环" },
							{ value: "one", label: "单曲循环" },
							{ value: "random", label: "随机播放" },
						],
					},
					switchField("showLyrics", "显示歌词", "曲目里有歌词内容才生效"),
				],
			},
			{
				title: "本地歌单",
				namespace: "music",
				note: "第一首是默认曲目；音频放 public/assets/music/，单个文件别超 25MB",
				fields: [
					{
						path: "local.playlist",
						label: "曲目",
						type: "list",
						itemTitle: "name",
						emptyText: "歌单是空的，点「添加一行」加一首",
						itemFields: [
							{ path: "name", label: "曲名", type: "text" },
							{ path: "artist", label: "艺人", type: "text" },
							{
								path: "url",
								label: "音频地址",
								type: "text",
								placeholder: "/assets/music/x.m4a",
							},
							{
								path: "cover",
								label: "封面",
								type: "text",
								placeholder: "/assets/music/cover/x.jpg",
							},
						],
					},
				],
			},
			{
				title: "Meting API",
				namespace: "music",
				note: "仅在音源方式选 Meting 时使用",
				fields: [
					{ path: "meting.api", label: "API 地址", type: "text" },
					{
						path: "meting.server",
						label: "音乐平台",
						type: "select",
						options: [
							{ value: "netease", label: "网易云音乐" },
							{ value: "tencent", label: "QQ 音乐" },
							{ value: "kugou", label: "酷狗音乐" },
							{ value: "baidu", label: "百度音乐" },
						],
					},
					{
						path: "meting.type",
						label: "类型",
						type: "select",
						options: [
							{ value: "playlist", label: "歌单" },
							{ value: "song", label: "单曲" },
							{ value: "album", label: "专辑" },
							{ value: "search", label: "搜索" },
							{ value: "artist", label: "艺术家" },
						],
					},
					{ path: "meting.id", label: "ID / 关键词", type: "text" },
					{
						path: "meting.fallbackApis",
						label: "备用 API",
						type: "tags",
						help: "主 API 失败时按顺序尝试，最多 6 条",
					},
				],
			},
		],
	},
	{
		key: "friends",
		label: "友链",
		desc: "友链页文案与条目。发布后生效。",
		sections: [
			{
				title: "页面设置",
				namespace: "friends",
				fields: [
					{
						path: "page.title",
						label: "页面标题",
						type: "text",
						placeholder: "留空用默认标题",
					},
					{
						path: "page.description",
						label: "页面描述",
						type: "textarea",
						placeholder: "留空用默认描述",
					},
					switchField("page.showCustomContent", "显示底部自定义内容"),
					switchField("page.showComment", "显示评论区", "需要先启用评论系统"),
					switchField(
						"page.randomizeSort",
						"随机排序",
						"开启后忽略权重，构建时随机打乱",
					),
				],
			},
			{
				title: "友链条目",
				namespace: "friends",
				note: "权重越大越靠前；关掉的条目不会出现在页面上",
				fields: [
					{
						path: "links",
						label: "友链列表",
						type: "list",
						itemTitle: "title",
						emptyText: "还没有友链，点「添加一行」开始",
						itemFields: [
							{ path: "title", label: "站点名", type: "text" },
							{
								path: "imgurl",
								label: "头像地址",
								type: "text",
								placeholder: "https://",
							},
							{ path: "desc", label: "描述", type: "text" },
							{
								path: "siteurl",
								label: "站点地址",
								type: "text",
								placeholder: "https://",
							},
							{
								path: "weight",
								label: "权重",
								type: "number",
								min: 0,
								max: 9999,
							},
							{ path: "enabled", label: "启用", type: "switch" },
						],
					},
				],
			},
		],
	},
];

/** 所有叶子字段（含列表项），用来算「改了哪些」与「是否全是热字段」 */
export const ALL_FIELDS: Array<SettingField & { namespace: ConfigNamespace }> =
	SETTING_GROUPS.flatMap((group) =>
		group.sections.flatMap((section) =>
			section.fields.map((field) => ({
				...field,
				namespace: section.namespace,
			})),
		),
	);

export function readPath(
	source: Record<string, unknown>,
	path: string,
): unknown {
	return path
		.split(".")
		.reduce<unknown>(
			(acc, key) =>
				acc && typeof acc === "object"
					? (acc as Record<string, unknown>)[key]
					: undefined,
			source,
		);
}

export function writePath(
	target: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const keys = path.split(".");
	let node = target;
	for (const key of keys.slice(0, -1)) {
		const next = node[key];
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			node[key] = {};
		}
		node = node[key] as Record<string, unknown>;
	}
	node[keys[keys.length - 1]] = value;
}

/** 读取某个命名空间下的字段值（表单、默认值、草稿都走这里，避免三处各写一遍） */
export function readField(
	doc: Record<string, unknown>,
	namespace: ConfigNamespace,
	path: string,
): unknown {
	const section = doc[namespace];
	if (!section || typeof section !== "object") return undefined;
	return readPath(section as Record<string, unknown>, path);
}

export interface ConfigDiff {
	path: string;
	label: string;
	before: unknown;
	after: unknown;
}

/** 逐字段比对，返回「从 before 到 after 变了哪些」 */
export function flattenDiff(
	after: Record<string, unknown>,
	before: Record<string, unknown>,
): ConfigDiff[] {
	const out: ConfigDiff[] = [];
	for (const field of ALL_FIELDS) {
		const a = readField(after, field.namespace, field.path);
		const b = readField(before, field.namespace, field.path);
		if (JSON.stringify(a) !== JSON.stringify(b)) {
			out.push({
				path: `${field.namespace}.${field.path}`,
				label: field.label,
				before: b,
				after: a,
			});
		}
	}
	return out;
}
