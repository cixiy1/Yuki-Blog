import { openSecret, sealSecret } from "./password";

/**
 * 站点配置的存储与校验。
 *
 * 三份数据都放 `settings` 表（0001 就有，一直空着）：
 *  - `site.config.draft`     管理端正在编辑的内容
 *  - `site.config.published` 最近一次发布/立即应用的内容，公开接口与热点字段都读它
 *  - `site.secrets`          加密后的密钥集合，永远不进 git、不回显
 */

export const KEY_DRAFT = "site.config.draft";
export const KEY_PUBLISHED = "site.config.published";
export const KEY_SECRETS = "site.secrets";

/** 密钥名白名单：只有这些能写，避免任意键塞进 settings */
export const SECRET_NAMES = [
	"github_token",
	"github_client_id",
	"github_client_secret",
	"resend_api_key",
	"smtp_pass",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/**
 * 公开接口只暴露这些字段——整份配置不外泄。
 *
 * 热名单只收「运行时改不破坏结构」的项：
 *  - 主题色相：站点里只有一处消费（根节点的 --hue）。
 *  - 壁纸模式：`displaySettingsConfig.wallpaperModeSwitchable` 开启时，构建期
 *    已经把各模式所需的资源都渲染出来了，运行时切只改 `data-wallpaper-mode`
 *    与导航栏透明模式，不重建 DOM。站长最直观的感受是「改了能看到」，
 *    不必等一次构建；发布后新访客首屏才直接用新模式渲染。
 *
 * 标题/副标题看起来也该热，但它们进 <title>、RSS、分享卡片，运行时改只会让
 * 「页面标题」和「搜索结果」长期不一致，所以留在发布通道。
 */
export const HOT_FIELDS = [
	["site", "themeColor"],
	["banner", "mode"],
] as const;

type Spec =
	| { t: "string"; max: number }
	| { t: "number"; min: number; max: number }
	| { t: "bool" }
	| { t: "str[]"; items: number; maxItems: number }
	| { t: "enum"; values: readonly string[] }
	| { t: "list"; maxItems: number; fields: Record<string, Spec> }
	| { t: "obj"; fields: Record<string, Spec> };

const PAGE_KEYS = [
	"friends",
	"guestbook",
	"dynamic",
	"projects",
	"gallery",
	"booknav",
	"bilibili",
	"bangumi",
	"vndb",
	"mal",
	"sponsor",
] as const;

function pagesSpec(): Spec {
	const fields: Record<string, Spec> = {};
	for (const key of PAGE_KEYS) fields[key] = { t: "bool" };
	return { t: "obj", fields };
}

/**
 * 可配置字段白名单。不在表里的键一律拒绝——这是防止管理端写进
 * 一份「看起来能合进去、实际没人读」的脏配置，也防止误改到结构字段。
 */
const SITE_SPEC: Record<string, Spec> = {
	title: { t: "string", max: 120 },
	subtitle: { t: "string", max: 120 },
	description: { t: "string", max: 300 },
	keywords: { t: "str[]", items: 40, maxItems: 30 },
	site_url: { t: "string", max: 200 },
	lang: { t: "enum", values: ["zh_CN", "zh_TW", "en", "ja", "ru", "ko"] },
	timezone: { t: "string", max: 60 },
	siteStartDate: { t: "string", max: 20 },
	themeColor: {
		t: "obj",
		fields: {
			hue: { t: "number", min: 0, max: 360 },
			defaultMode: { t: "enum", values: ["light", "dark", "system"] },
		},
	},
	pageWidth: { t: "number", min: 60, max: 160 },
	card: {
		t: "obj",
		fields: { border: { t: "bool" }, followTheme: { t: "bool" } },
	},
	pages: pagesSpec(),
	categoryBar: { t: "bool" },
	categoryStyle: { t: "enum", values: ["pill", "rectangle"] },
	tagStyle: { t: "enum", values: ["pill", "pill-gray", "rectangle"] },
	pagination: {
		t: "obj",
		fields: { postsPerPage: { t: "number", min: 1, max: 50 } },
	},
	navbar: {
		t: "obj",
		fields: {
			title: { t: "string", max: 60 },
			widthFull: { t: "bool" },
			menuAlign: { t: "enum", values: ["left", "center"] },
			followTheme: { t: "bool" },
			navbarMode: { t: "enum", values: ["static", "fixed", "dynamic"] },
		},
	},
	post: {
		t: "obj",
		fields: {
			showLastModified: { t: "bool" },
			outdatedThreshold: { t: "number", min: 1, max: 3650 },
			share: { t: "bool" },
			postNavigation: { t: "bool" },
			relatedPosts: { t: "bool" },
			randomPosts: { t: "bool" },
			generateOgImages: { t: "bool" },
			immersiveReading: {
				t: "obj",
				fields: {
					enable: { t: "bool" },
					defaultOn: { t: "bool" },
					tocEnabled: { t: "bool" },
					tocPosition: { t: "enum", values: ["left", "right"] },
				},
			},
		},
	},
};

const PROFILE_SPEC: Record<string, Spec> = {
	avatar: { t: "string", max: 400 },
	name: { t: "string", max: 40 },
	bio: { t: "string", max: 200 },
	links: {
		t: "list",
		maxItems: 20,
		fields: {
			name: { t: "string", max: 40 },
			icon: { t: "string", max: 80 },
			url: { t: "string", max: 400 },
			showName: { t: "bool" },
		},
	},
};

const MUSIC_SPEC: Record<string, Spec> = {
	showInNavbar: { t: "bool" },
	showInSidebar: { t: "bool" },
	mode: { t: "enum", values: ["local", "meting"] },
	volume: { t: "number", min: 0, max: 1 },
	playMode: { t: "enum", values: ["list", "one", "random"] },
	showLyrics: { t: "bool" },
	local: {
		t: "obj",
		fields: {
			playlist: {
				t: "list",
				maxItems: 200,
				fields: {
					name: { t: "string", max: 120 },
					artist: { t: "string", max: 120 },
					url: { t: "string", max: 400 },
					cover: { t: "string", max: 400 },
					lrc: { t: "string", max: 8000 },
				},
			},
		},
	},
	meting: {
		t: "obj",
		fields: {
			api: { t: "string", max: 400 },
			server: { t: "string", max: 40 },
			type: { t: "string", max: 40 },
			id: { t: "string", max: 120 },
			auth: { t: "string", max: 200 },
			fallbackApis: { t: "str[]", items: 400, maxItems: 6 },
		},
	},
};

const FRIENDS_SPEC: Record<string, Spec> = {
	page: {
		t: "obj",
		fields: {
			title: { t: "string", max: 120 },
			description: { t: "string", max: 300 },
			showCustomContent: { t: "bool" },
			showComment: { t: "bool" },
			randomizeSort: { t: "bool" },
		},
	},
	links: {
		t: "list",
		maxItems: 200,
		fields: {
			title: { t: "string", max: 80 },
			imgurl: { t: "string", max: 400 },
			desc: { t: "string", max: 300 },
			siteurl: { t: "string", max: 400 },
			tags: { t: "str[]", items: 30, maxItems: 8 },
			weight: { t: "number", min: 0, max: 9999 },
			enabled: { t: "bool" },
		},
	},
};

const BANNER_SPEC: Record<string, Spec> = {
	mode: { t: "enum", values: ["banner", "fullscreen", "overlay", "none"] },
	common: {
		t: "obj",
		fields: {
			dimOpacity: { t: "number", min: 0, max: 1 },
			playerMode: { t: "enum", values: ["order", "random"] },
			homeText: {
				t: "obj",
				fields: {
					enable: { t: "bool" },
					title: { t: "string", max: 200 },
					titleSize: { t: "string", max: 20 },
					subtitle: { t: "str[]", items: 200, maxItems: 10 },
					subtitleSize: { t: "string", max: 20 },
					typewriter: {
						t: "obj",
						fields: {
							enable: { t: "bool" },
							speed: { t: "number", min: 0, max: 5000 },
							deleteSpeed: { t: "number", min: 0, max: 5000 },
							pauseTime: { t: "number", min: 0, max: 60000 },
						},
					},
					linksEnable: { t: "bool" },
				},
			},
		},
	},
};

const ANNOUNCEMENT_SPEC: Record<string, Spec> = {
	title: { t: "string", max: 120 },
	content: { t: "string", max: 2000 },
	closable: { t: "bool" },
	link: {
		t: "obj",
		fields: {
			enable: { t: "bool" },
			text: { t: "string", max: 60 },
			url: { t: "string", max: 400 },
			external: { t: "bool" },
		},
	},
};

const SPONSOR_SPEC: Record<string, Spec> = {
	title: { t: "string", max: 120 },
	description: { t: "string", max: 300 },
	usage: { t: "string", max: 1000 },
	showSponsorsList: { t: "bool" },
	showComment: { t: "bool" },
	showButtonInPost: { t: "bool" },
	methods: {
		t: "list",
		maxItems: 10,
		fields: {
			name: { t: "string", max: 40 },
			icon: { t: "string", max: 80 },
			qrCode: { t: "string", max: 400 },
			link: { t: "string", max: 400 },
			description: { t: "string", max: 200 },
			enabled: { t: "bool" },
		},
	},
	sponsors: {
		t: "list",
		maxItems: 200,
		fields: {
			name: { t: "string", max: 40 },
			avatar: { t: "string", max: 400 },
			amount: { t: "string", max: 40 },
			date: { t: "string", max: 20 },
		},
	},
};

/**
 * 顶层按「配置文件」分命名空间，一个命名空间对应一个 config 模块：
 * `site` → siteConfig、`profile` → profileConfig、`music` → musicPlayerConfig、
 * `friends` → friends 页与列表、`banner` → backgroundWallpaper、`announcement` → 公告。
 *
 * 这样 `config/site.json` 就是「一份文档、几个分区」，发布时整份写进仓库，
 * 构建时每个模块各取自己的分区，互不干扰。
 */
export const CONFIG_SPEC: Record<string, Spec> = {
	site: { t: "obj", fields: SITE_SPEC },
	profile: { t: "obj", fields: PROFILE_SPEC },
	music: { t: "obj", fields: MUSIC_SPEC },
	friends: { t: "obj", fields: FRIENDS_SPEC },
	banner: { t: "obj", fields: BANNER_SPEC },
	announcement: { t: "obj", fields: ANNOUNCEMENT_SPEC },
	sponsor: { t: "obj", fields: SPONSOR_SPEC },
};

/** 命名空间清单，管理端与前端覆盖层都按这个顺序走 */
export const CONFIG_NAMESPACES: string[] = Object.keys(CONFIG_SPEC);

export interface ConfigCheck {
	ok: boolean;
	value: Record<string, unknown>;
	issues: string[];
}

/** 按白名单裁剪并校验；未知键直接报错，不做静默丢弃 */
export function checkConfig(input: unknown): ConfigCheck {
	const issues: string[] = [];
	const value = walk(input, { t: "obj", fields: CONFIG_SPEC }, "", issues);
	return {
		ok: issues.length === 0,
		value: (value as Record<string, unknown> | undefined) ?? {},
		issues,
	};
}

function walk(
	node: unknown,
	spec: Spec,
	path: string,
	issues: string[],
): unknown {
	const at = path || "(根)";
	if (spec.t === "list") {
		if (!Array.isArray(node)) {
			issues.push(`${at} 应该是数组`);
			return undefined;
		}
		if (node.length > spec.maxItems) {
			issues.push(`${at} 最多 ${spec.maxItems} 项`);
			return undefined;
		}
		const rows: Array<Record<string, unknown>> = [];
		node.forEach((item, index) => {
			const label = `${at}[${index + 1}]`;
			if (typeof item !== "object" || item === null || Array.isArray(item)) {
				issues.push(`${label} 应该是对象`);
				return;
			}
			const row = walk(item, { t: "obj", fields: spec.fields }, label, issues);
			if (row !== undefined) rows.push(row as Record<string, unknown>);
		});
		return rows;
	}
	if (spec.t === "obj") {
		if (typeof node !== "object" || node === null || Array.isArray(node)) {
			issues.push(`${at} 应该是对象`);
			return undefined;
		}
		const out: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(
			node as Record<string, unknown>,
		)) {
			const sub = spec.fields[key];
			const where = path ? `${path}.${key}` : key;
			if (!sub) {
				issues.push(`${where} 不在可配置范围内`);
				continue;
			}
			const checked = walk(child, sub, where, issues);
			if (checked !== undefined) out[key] = checked;
		}
		return out;
	}

	if (spec.t === "string") {
		if (typeof node !== "string") {
			issues.push(`${at} 应该是字符串`);
			return undefined;
		}
		if (node.length > spec.max) {
			issues.push(`${at} 超过 ${spec.max} 字`);
			return undefined;
		}
		return node;
	}

	if (spec.t === "number") {
		if (typeof node !== "number" || !Number.isFinite(node)) {
			issues.push(`${at} 应该是数字`);
			return undefined;
		}
		if (node < spec.min || node > spec.max) {
			issues.push(`${at} 应在 ${spec.min}–${spec.max} 之间`);
			return undefined;
		}
		return node;
	}

	if (spec.t === "bool") {
		if (typeof node !== "boolean") {
			issues.push(`${at} 应该是布尔值`);
			return undefined;
		}
		return node;
	}

	if (spec.t === "enum") {
		if (typeof node !== "string" || !spec.values.includes(node)) {
			issues.push(`${at} 只能是 ${spec.values.join(" / ")}`);
			return undefined;
		}
		return node;
	}

	// str[]
	if (!Array.isArray(node)) {
		issues.push(`${at} 应该是字符串数组`);
		return undefined;
	}
	if (node.length > spec.maxItems) {
		issues.push(`${at} 最多 ${spec.maxItems} 项`);
		return undefined;
	}
	const list: string[] = [];
	for (const item of node) {
		if (typeof item !== "string" || item.length > spec.items) {
			issues.push(`${at} 里有非法项`);
			return undefined;
		}
		list.push(item.trim());
	}
	return list.filter((item) => item.length > 0);
}

/** 公开接口用的裁剪：只留热字段，避免把整份配置暴露出去 */
export function pickHot(
	published: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [ns, key] of HOT_FIELDS) {
		const section = published[ns];
		if (!section || typeof section !== "object") continue;
		const value = (section as Record<string, unknown>)[key];
		if (value === undefined) continue;
		out[ns] = { ...((out[ns] as Record<string, unknown>) ?? {}), [key]: value };
	}
	return out;
}

export async function readSetting<T>(
	db: D1Database,
	key: string,
): Promise<T | null> {
	const row = await db
		.prepare("SELECT value_json FROM settings WHERE key = ?1")
		.bind(key)
		.first<{ value_json: string }>();
	if (!row) return null;
	try {
		return JSON.parse(row.value_json) as T;
	} catch {
		return null;
	}
}

export async function writeSetting(
	db: D1Database,
	key: string,
	value: unknown,
	actorUid: number | null,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO settings (key, value_json, updated_by, updated_at)
			 VALUES (?1, ?2, ?3, datetime('now'))
			 ON CONFLICT(key) DO UPDATE SET
			   value_json = excluded.value_json,
			   updated_by = excluded.updated_by,
			   updated_at = datetime('now')`,
		)
		.bind(key, JSON.stringify(value), actorUid)
		.run();
}

/** 读某个密钥；没配或解不开都返回 null，调用方按「未配置」处理 */
export async function readSecret(
	db: D1Database,
	rootKey: string,
	name: SecretName,
): Promise<string | null> {
	const all = await readSetting<Record<string, string>>(db, KEY_SECRETS);
	const envelope = all?.[name];
	if (!envelope) return null;
	return openSecret(rootKey, name, envelope);
}

export async function writeSecret(
	db: D1Database,
	rootKey: string,
	name: SecretName,
	plain: string,
	actorUid: number | null,
): Promise<boolean> {
	const all =
		(await readSetting<Record<string, string>>(db, KEY_SECRETS)) ?? {};
	const sealed = await sealSecret(rootKey, name, plain);
	if (!sealed) return false;
	all[name] = sealed;
	await writeSetting(db, KEY_SECRETS, all, actorUid);
	return true;
}

/** 删除某个密钥（管理端把输入清空即删除） */
export async function clearSecret(
	db: D1Database,
	name: SecretName,
	actorUid: number | null,
): Promise<void> {
	const all =
		(await readSetting<Record<string, string>>(db, KEY_SECRETS)) ?? {};
	if (!(name in all)) return;
	delete all[name];
	await writeSetting(db, KEY_SECRETS, all, actorUid);
}

/** 管理端展示用：只给「配没配 / 什么时间 / 末四位」，密文与明文都不出现 */
export async function secretStatus(
	db: D1Database,
	rootKey: string,
): Promise<
	Array<{ name: SecretName; configured: boolean; hint: string | null }>
> {
	const all =
		(await readSetting<Record<string, string>>(db, KEY_SECRETS)) ?? {};
	const out: Array<{
		name: SecretName;
		configured: boolean;
		hint: string | null;
	}> = [];
	for (const name of SECRET_NAMES) {
		const envelope = all[name];
		if (!envelope) {
			out.push({ name, configured: false, hint: null });
			continue;
		}
		const plain = await openSecret(rootKey, name, envelope);
		out.push({
			name,
			configured: plain !== null,
			hint: plain ? `…${plain.slice(-4)}` : null,
		});
	}
	return out;
}
