import { sha256Hex, timingSafeEqualHex } from "./crypto";
import { readSetting, writeSetting } from "./site-config";

/**
 * 站内评论的服务端逻辑。
 *
 * 三条原则：
 *  1. 评论数据只在 D1，不进构建。前端每次进页面现拉，所以改色相/改开关都不用等部署。
 *  2. 正文存 Markdown 原文，渲染放客户端（marked + sanitize-html）——
 *     Worker 里不做 HTML 拼装，少一层注入面。
 *  3. 游客邮箱只存摘要。要发「有人回复你」的通知，靠摘要反查不到原文，
 *     所以通知只发给登录用户；游客那条先不做回信。
 *  4. 游客没有 uid，靠发表时发的一次性令牌自证身份（见 hashGuestToken）。
 *     不用邮箱，因为邮箱从没被核验过，填别人的地址就能接管别人的评论。
 */

export const KEY_COMMENTS_CONFIG = "comments.config";

export interface CommentSettings {
	/** 整块评论功能开关 */
	enabled: boolean;
	/** 先审后发。默认关，即先发后审：写入直接 approved；打开后新评论进 pending */
	requireApproval: boolean;
	/** 允许未登录的游客评论 */
	allowGuest: boolean;
	/** 正文长度上限，字符数 */
	maxLength: number;
	/** 同一来源两次评论的最小间隔（秒） */
	rateSeconds: number;
}

export const COMMENT_DEFAULTS: CommentSettings = {
	enabled: true,
	requireApproval: false,
	allowGuest: true,
	maxLength: 2000,
	rateSeconds: 20,
};

/**
 * 读配置。
 * 逐字段兜底：库里被手改坏、或以后加新字段时，缺的部分用默认值补上，
 * 不让一个脏字段把整个评论区打挂。
 */
export async function readCommentSettings(
	db: D1Database,
): Promise<CommentSettings> {
	const stored = await readSetting<Record<string, unknown>>(
		db,
		KEY_COMMENTS_CONFIG,
	);
	if (!stored || typeof stored !== "object") return { ...COMMENT_DEFAULTS };

	const bool = (key: keyof CommentSettings, fallback: boolean): boolean =>
		typeof stored[key] === "boolean" ? (stored[key] as boolean) : fallback;
	const num = (
		key: keyof CommentSettings,
		fallback: number,
		min: number,
		max: number,
	): number => {
		const value = stored[key];
		if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
		return Math.min(max, Math.max(min, Math.round(value)));
	};

	return {
		enabled: bool("enabled", COMMENT_DEFAULTS.enabled),
		requireApproval: bool("requireApproval", COMMENT_DEFAULTS.requireApproval),
		allowGuest: bool("allowGuest", COMMENT_DEFAULTS.allowGuest),
		maxLength: num("maxLength", COMMENT_DEFAULTS.maxLength, 1, 5000),
		rateSeconds: num("rateSeconds", COMMENT_DEFAULTS.rateSeconds, 0, 600),
	};
}

export interface SettingsCheck {
	ok: boolean;
	value: CommentSettings;
	issues: string[];
}

/** 管理端保存时的校验，比读取严格：不认识的键直接报错，不静默丢弃 */
export function checkCommentSettings(input: unknown): SettingsCheck {
	const issues: string[] = [];
	const raw =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	const value: CommentSettings = { ...COMMENT_DEFAULTS };

	for (const [key, item] of Object.entries(raw)) {
		if (!(key in COMMENT_DEFAULTS)) {
			issues.push(`${key} 不是可配置项`);
			continue;
		}
		if (key === "maxLength" || key === "rateSeconds") {
			const min = key === "maxLength" ? 1 : 0;
			const max = key === "maxLength" ? 5000 : 600;
			if (typeof item !== "number" || !Number.isFinite(item)) {
				issues.push(`${key} 应该是数字`);
				continue;
			}
			const n = Math.round(item);
			if (n < min || n > max) {
				issues.push(`${key} 应在 ${min}–${max} 之间`);
				continue;
			}
			if (key === "maxLength") value.maxLength = n;
			else value.rateSeconds = n;
			continue;
		}
		if (typeof item !== "boolean") {
			issues.push(`${key} 应该是布尔值`);
			continue;
		}
		if (key === "enabled") value.enabled = item;
		else if (key === "requireApproval") value.requireApproval = item;
		else if (key === "allowGuest") value.allowGuest = item;
	}

	return { ok: issues.length === 0, value, issues };
}

export async function writeCommentSettings(
	db: D1Database,
	value: CommentSettings,
	actorUid: number | null,
): Promise<void> {
	await writeSetting(db, KEY_COMMENTS_CONFIG, value, actorUid);
}

/** target 只允许：guestbook、dynamic:<页面路径>、文章 slug（含中文与子目录斜杠） */
export function isValidTarget(target: string): boolean {
	if (target.length < 1 || target.length > 200) return false;
	if (target === "guestbook") return true;
	// 说说：iframe 里带 ?path=，拼成 dynamic:/dynamic/2026/xx/
	if (target.startsWith("dynamic:")) {
		return !/\s/.test(target) && !target.includes("..");
	}
	// 文章 slug：不许空白、控制字符、路径穿越
	if (/\s/.test(target)) return false;
	if (target.includes("..") || target.startsWith("/")) return false;
	return /^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5\-/.]*$/u.test(target);
}

/** 游客邮箱摘要：加点固定盐，避免直接拿 sha256(email) 去撞彩虹表 */
export async function hashGuestEmail(email: string): Promise<string> {
	return await sha256Hex(`comment-email:${email.trim().toLowerCase()}`);
}

/**
 * 游客令牌摘要。
 *
 * 令牌原文只在发表响应里给一次，浏览器存 localStorage；库里只留摘要，
 * 这样就算哪天库被拖走，也不能拿摘要冒充作者去删评论。
 */
export async function hashGuestToken(token: string): Promise<string> {
	return await sha256Hex(`comment-token:${token}`);
}

/** 常量时间比对，避免用逐字符比较泄漏前缀匹配长度 */
export async function verifyGuestToken(
	token: string,
	storedHash: string | null,
): Promise<boolean> {
	if (!token || !storedHash) return false;
	if (token.length < 16 || token.length > 128) return false;
	const digest = await hashGuestToken(token);
	return timingSafeEqualHex(digest, storedHash);
}

export interface CommentRow {
	id: number;
	target: string;
	parent_id: number | null;
	uid: number | null;
	guest_name: string | null;
	guest_email_hash: string | null;
	body_md: string;
	status: string;
	is_admin: number;
	created_at: string;
	reviewed_at: string | null;
}

/** 对外形态：绝不带 guest_email_hash 与 ip_hash */
export interface PublicComment {
	id: number;
	parent_id: number | null;
	name: string;
	avatar_url: string | null;
	uid: number | null;
	is_admin: boolean;
	body_md: string;
	created_at: string;
	/** 当前访客能不能删这条（本人，或管理员在管理端另走一套） */
	can_delete: boolean;
}

const PUBLIC_COLUMNS = `c.id, c.target, c.parent_id, c.uid, c.guest_name,
	c.guest_email_hash, c.body_md, c.status, c.is_admin, c.created_at,
	c.reviewed_at, u.display_name AS user_name,
	u.avatar_url AS user_avatar`;

/**
 * 已通过的评论，扁平返回（前端自己按 parent_id 建树）。
 * 上限 500：单篇评论超过这个数量级之前，先不做分页。
 */
export async function listPublicComments(
	db: D1Database,
	target: string,
	viewerUid: number | null,
): Promise<{ items: PublicComment[]; total: number }> {
	const rows = await db
		.prepare(
			`SELECT ${PUBLIC_COLUMNS}
			 FROM comments c LEFT JOIN users u ON u.uid = c.uid
			 WHERE c.target = ?1 AND c.status = 'approved'
			 ORDER BY c.id ASC LIMIT 500`,
		)
		.bind(target)
		.all<
			CommentRow & { user_name: string | null; user_avatar: string | null }
		>();

	const items = (rows.results ?? []).map((row) => toPublic(row, viewerUid));
	return { items, total: items.length };
}

function toPublic(
	row: CommentRow & { user_name: string | null; user_avatar: string | null },
	viewerUid: number | null,
): PublicComment {
	return {
		id: row.id,
		parent_id: row.parent_id,
		name: row.user_name || row.guest_name || "匿名",
		avatar_url: row.user_avatar ?? null,
		uid: row.uid,
		is_admin: row.is_admin === 1,
		body_md: row.body_md,
		created_at: isoify(row.created_at),
		can_delete: viewerUid !== null && row.uid === viewerUid,
	};
}

/** D1 的 datetime('now') 是 "YYYY-MM-DD HH:MM:SS"（UTC），补成 ISO 让浏览器正确解析 */
function isoify(value: string): string {
	if (!value) return value;
	if (value.includes("T")) return value;
	return `${value.replace(" ", "T")}Z`;
}

/** 一次查多个 target 的已通过条数，给列表页显示评论数用 */
export async function countComments(
	db: D1Database,
	targets: string[],
): Promise<Record<string, number>> {
	const unique = [...new Set(targets.filter((t) => t.length > 0))].slice(0, 60);
	const out: Record<string, number> = {};
	if (unique.length === 0) return out;
	const placeholders = unique.map((_, i) => `?${i + 1}`).join(", ");
	const rows = await db
		.prepare(
			`SELECT target, COUNT(*) AS n FROM comments
			 WHERE status = 'approved' AND target IN (${placeholders})
			 GROUP BY target`,
		)
		.bind(...unique)
		.all<{ target: string; n: number }>();
	for (const row of rows.results ?? []) out[row.target] = row.n;
	return out;
}

export interface CreateInput {
	target: string;
	parentId: number | null;
	bodyMd: string;
	uid: number | null;
	guestName: string | null;
	guestEmailHash: string | null;
	/** 游客令牌的摘要；登录用户为 null */
	guestTokenHash: string | null;
	isAdmin: boolean;
	ipHash: string | null;
	/** 先审后发：待审写 pending；先发后审写 approved */
	status: "pending" | "approved";
}

export async function insertComment(
	db: D1Database,
	input: CreateInput,
): Promise<number> {
	const row = await db
		.prepare(
			`INSERT INTO comments
			 (target, parent_id, uid, guest_name, guest_email_hash,
			  guest_token_hash, body_md, status, is_admin, ip_hash, reviewed_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
			         CASE WHEN ?8 = 'approved' THEN datetime('now') ELSE NULL END)
			 RETURNING id`,
		)
		.bind(
			input.target,
			input.parentId,
			input.uid,
			input.guestName,
			input.guestEmailHash,
			input.guestTokenHash,
			input.bodyMd,
			input.status,
			input.isAdmin ? 1 : 0,
			input.ipHash,
		)
		.first<{ id: number }>();
	return row?.id ?? 0;
}

/** 回复的目标必须是同 target 下已通过的评论，不能挂到待审或别的文章上 */
export async function findReplyTarget(
	db: D1Database,
	id: number,
	target: string,
): Promise<CommentRow | null> {
	return await db
		.prepare(
			`SELECT id, target, parent_id, uid, guest_name, guest_email_hash,
			        body_md, status, is_admin, created_at, reviewed_at
			 FROM comments WHERE id = ?1 AND target = ?2 AND status = 'approved'`,
		)
		.bind(id, target)
		.first<CommentRow>();
}

/** 删除一条评论，连带它的整棵子树（只压两层，但删的时候要彻底） */
export async function deleteCommentTree(
	db: D1Database,
	id: number,
): Promise<string | null> {
	const row = await db
		.prepare("SELECT id, target, uid FROM comments WHERE id = ?1")
		.bind(id)
		.first<{ id: number; target: string; uid: number | null }>();
	if (!row) return null;

	// 用递归 CTE 一次删干净，避免「删了父、子变孤儿」再被当成顶层显示
	await db
		.prepare(
			`WITH RECURSIVE doomed(id) AS (
			   SELECT ?1
			   UNION ALL
			   SELECT c.id FROM comments c JOIN doomed d ON c.parent_id = d.id
			 )
			 DELETE FROM comments WHERE id IN (SELECT id FROM doomed)`,
		)
		.bind(id)
		.run();
	return row.target;
}

export async function findCommentById(
	db: D1Database,
	id: number,
): Promise<{
	id: number;
	target: string;
	uid: number | null;
	status: string;
	guest_token_hash: string | null;
} | null> {
	return await db
		.prepare(
			"SELECT id, target, uid, status, guest_token_hash FROM comments WHERE id = ?1",
		)
		.bind(id)
		.first<{
			id: number;
			target: string;
			uid: number | null;
			status: string;
			guest_token_hash: string | null;
		}>();
}

export interface AdminComment {
	id: number;
	target: string;
	parent_id: number | null;
	name: string;
	uid: number | null;
	email_hint: string | null;
	body_md: string;
	status: string;
	is_admin: boolean;
	created_at: string;
	reviewed_at: string | null;
}

/** 管理端列表：status 为空表示全部，target 支持前缀匹配 */
export async function listAdminComments(
	db: D1Database,
	query: { status?: string; target?: string; page: number; pageSize: number },
): Promise<{ items: AdminComment[]; total: number }> {
	const where: string[] = [];
	const args: unknown[] = [];
	if (query.status && query.status !== "all") {
		args.push(query.status);
		where.push(`c.status = ?${args.length}`);
	}
	if (query.target) {
		args.push(`${query.target}%`);
		where.push(`c.target LIKE ?${args.length}`);
	}
	const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

	const countRow = await db
		.prepare(`SELECT COUNT(*) AS n FROM comments c ${clause}`)
		.bind(...args)
		.first<{ n: number }>();

	const pageSize = Math.min(100, Math.max(1, query.pageSize));
	const offset = Math.max(0, (Math.max(1, query.page) - 1) * pageSize);
	const rows = await db
		.prepare(
			`SELECT c.id, c.target, c.parent_id, c.uid, c.guest_name,
			        c.guest_email_hash, c.body_md, c.status, c.is_admin,
			        c.created_at, c.reviewed_at, u.display_name AS user_name
			 FROM comments c LEFT JOIN users u ON u.uid = c.uid
			 ${clause}
			 ORDER BY c.id DESC LIMIT ?${args.length + 1} OFFSET ?${args.length + 2}`,
		)
		.bind(...args, pageSize, offset)
		.all<CommentRow & { user_name: string | null }>();

	const items = (rows.results ?? []).map((row) => ({
		id: row.id,
		target: row.target,
		parent_id: row.parent_id,
		name: row.user_name || row.guest_name || "匿名",
		uid: row.uid,
		// 只给末 8 位摘要，能认出「同一个人」但还原不出邮箱
		email_hint: row.guest_email_hash
			? `sha:${row.guest_email_hash.slice(0, 8)}`
			: null,
		body_md: row.body_md,
		status: row.status,
		is_admin: row.is_admin === 1,
		created_at: isoify(row.created_at),
		reviewed_at: row.reviewed_at ? isoify(row.reviewed_at) : null,
	}));

	return { items, total: countRow?.n ?? items.length };
}

export async function setCommentStatus(
	db: D1Database,
	id: number,
	status: "pending" | "approved" | "rejected",
	actorUid: number,
): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE comments
			 SET status = ?1, reviewed_by = ?2, reviewed_at = datetime('now'),
			     updated_at = datetime('now')
			 WHERE id = ?3`,
		)
		.bind(status, actorUid, id)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

/** 某个 target 下待审数量，管理端侧栏红点用 */
export async function pendingCount(db: D1Database): Promise<number> {
	const row = await db
		.prepare("SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'")
		.first<{ n: number }>();
	return row?.n ?? 0;
}
