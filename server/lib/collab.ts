import type { SessionUser } from "./users";

/**
 * 文章共创。
 *
 * 一篇文章的作者可以把编辑权借给别的账号：对方在管理端能看到这篇、能改正文与
 * 元数据，但删文章、改可见范围、邀请第三个人这些动作仍然只属于作者与管理员。
 *
 * 键用 slug，见 0013 迁移的注释：已发布文章只活在仓库里，没有 posts.id。
 */

export interface CollabMember {
	uid: number;
	account: string;
	display_name: string | null;
	avatar_url: string | null;
	role: string;
	invited_by: number;
	created_at: string;
}

const MAX_MEMBERS: number = 8;

/** 一篇文章最多几个协作者。再多人就不叫共创了，该开组织 */
export const COLLAB_LIMIT: number = MAX_MEMBERS;

export async function listCollaborators(
	db: D1Database,
	slug: string,
): Promise<CollabMember[]> {
	const rows = await db
		.prepare(
			`SELECT c.uid, u.account, u.display_name, u.avatar_url, u.role,
			        c.invited_by, c.created_at
			   FROM post_collaborators c
			   JOIN users u ON u.uid = c.uid
			  WHERE c.slug = ?1 AND c.status = 'active'
			  ORDER BY c.created_at ASC`,
		)
		.bind(slug)
		.all<CollabMember>();
	return rows.results ?? [];
}

/** 这个人是不是这篇文章的协作者（撤销过的不算） */
export async function isCollaborator(
	db: D1Database,
	slug: string,
	uid: number,
): Promise<boolean> {
	const row = await db
		.prepare(
			"SELECT 1 AS ok FROM post_collaborators WHERE slug = ?1 AND uid = ?2 AND status = 'active'",
		)
		.bind(slug, uid)
		.first<{ ok: number }>();
	return row !== null;
}

/** 「共享给我的文章」用的 slug 集合 */
export async function collaboratorSlugs(
	db: D1Database,
	uid: number,
): Promise<Set<string>> {
	const rows = await db
		.prepare(
			"SELECT slug FROM post_collaborators WHERE uid = ?1 AND status = 'active'",
		)
		.bind(uid)
		.all<{ slug: string }>();
	return new Set((rows.results ?? []).map((row) => row.slug));
}

/**
 * 能不能编辑这篇文章。
 *
 * 三种人：管理员（站主要能收拾任何一篇）、作者本人、被邀请的协作者。
 * `ownerUid` 对仓库里的文章是 null——那批文章的作者就是站主，只有管理员
 * 与被邀请者进得来。
 */
export async function canEditPost(
	db: D1Database,
	user: SessionUser | null,
	post: { slug: string; ownerUid?: number | null },
): Promise<boolean> {
	if (!user) return false;
	if (user.role === "admin") return true;
	if (post.ownerUid != null && post.ownerUid === user.uid) return true;
	return await isCollaborator(db, post.slug, user.uid);
}

/** 邀请与移除只给作者与管理员：协作者之间互相拉人会让名单失控 */
export function canManageCollaborators(
	user: SessionUser | null,
	post: { slug: string; ownerUid?: number | null },
): boolean {
	if (!user) return false;
	if (user.role === "admin") return true;
	if (post.ownerUid != null && post.ownerUid === user.uid) return true;
	return false;
}

export interface AddResult {
	ok: boolean;
	code?: "not_found" | "self" | "exists" | "limit" | "inactive";
	uid?: number;
}

/**
 * 加一个协作者（已知 uid）。
 *
 * 按组织整组邀请时走这条：那一批 uid 已经在手上了，没必要再按账号名查一遍。
 */
export async function addCollaboratorUid(
	db: D1Database,
	slug: string,
	uid: number,
	invitedBy: number,
): Promise<AddResult> {
	const target = await db
		.prepare(
			"SELECT uid, status FROM users WHERE uid = ?1 AND status <> 'deleted'",
		)
		.bind(uid)
		.first<{ uid: number; status: string }>();
	if (!target) return { ok: false, code: "not_found" };
	if (target.uid === invitedBy) return { ok: false, code: "self" };
	if (target.status !== "active") return { ok: false, code: "inactive" };
	return await attach(db, slug, target.uid, invitedBy);
}

/**
 * 加一个协作者。按账号名精确匹配（登录名，不是昵称）。
 *
 * 撤销过的记录直接复活：同一篇文章里同一个人只该有一条，否则名单会出现
 * 两行同名，谁也说不清哪条才算数。
 */
export async function addCollaborator(
	db: D1Database,
	slug: string,
	account: string,
	invitedBy: number,
): Promise<AddResult> {
	const target = await db
		.prepare(
			"SELECT uid, status FROM users WHERE account = ?1 AND status <> 'deleted'",
		)
		.bind(account)
		.first<{ uid: number; status: string }>();
	if (!target) return { ok: false, code: "not_found" };
	if (target.uid === invitedBy) return { ok: false, code: "self" };
	if (target.status !== "active") return { ok: false, code: "inactive" };
	return await attach(db, slug, target.uid, invitedBy);
}

/** 写名单：没有就插入，撤销过的复活，已在名单里返回 exists */
async function attach(
	db: D1Database,
	slug: string,
	uid: number,
	invitedBy: number,
): Promise<AddResult> {
	const existing = await db
		.prepare(
			"SELECT status FROM post_collaborators WHERE slug = ?1 AND uid = ?2",
		)
		.bind(slug, uid)
		.first<{ status: string }>();
	if (existing?.status === "active") return { ok: false, code: "exists" };

	if (!existing) {
		const count = await db
			.prepare(
				"SELECT COUNT(*) AS total FROM post_collaborators WHERE slug = ?1 AND status = 'active'",
			)
			.bind(slug)
			.first<{ total: number }>();
		if ((count?.total ?? 0) >= MAX_MEMBERS) {
			return { ok: false, code: "limit" };
		}
		await db
			.prepare(
				"INSERT INTO post_collaborators (slug, uid, invited_by) VALUES (?1, ?2, ?3)",
			)
			.bind(slug, uid, invitedBy)
			.run();
		return { ok: true, uid };
	}

	await db
		.prepare(
			`UPDATE post_collaborators
			    SET status = 'active', invited_by = ?3, updated_at = datetime('now')
			  WHERE slug = ?1 AND uid = ?2`,
		)
		.bind(slug, uid, invitedBy)
		.run();
	return { ok: true, uid };
}

/** 撤销：留痕而不是删行，将来要查「谁曾经在这篇上有过权限」还有据可依 */
export async function removeCollaborator(
	db: D1Database,
	slug: string,
	uid: number,
): Promise<boolean> {
	const res = await db
		.prepare(
			`UPDATE post_collaborators
			    SET status = 'revoked', updated_at = datetime('now')
			  WHERE slug = ?1 AND uid = ?2 AND status = 'active'`,
		)
		.bind(slug, uid)
		.run();
	return (res.meta?.changes ?? 0) > 0;
}
