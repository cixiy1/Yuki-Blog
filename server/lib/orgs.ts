import type { SessionUser } from "./users";

/**
 * 组织：一群账号的归属，同时是三样东西的载体。
 *
 *   1. **归属**：文章 frontmatter 的 `org` 指到一个组织，`/orgs/<slug>/` 列出它名下的文章
 *   2. **可见范围**：文章的 `visibleTo` 里写 `org:<slug>`，这个组织的成员才能读
 *   3. **共创**：邀请整个组织来改同一篇，不用一个一个加人
 *
 * slug 是唯一的跨系统标识：D1 用它做主键，frontmatter 用它指组织，
 * 构建期的 `config/orgs.json` 也以它做 key。改名可以，改 slug 等于换了一个组织。
 */

export type OrgRole = "owner" | "admin" | "member";

export interface OrgRow {
	id: number;
	slug: string;
	name: string;
	description: string | null;
	cover: string | null;
	owner_uid: number;
	status: string;
	can_review: number;
	created_at: string;
	updated_at: string;
}

export interface OrgMemberRow {
	uid: number;
	account: string;
	display_name: string | null;
	avatar_url: string | null;
	role: string;
	created_at: string;
}

/** 管理端列表用：组织本体 + 我在里面的身份 + 人数 */
export interface OrgSummary {
	id: number;
	slug: string;
	name: string;
	description: string;
	cover: string;
	owner_uid: number;
	created_at: string;
	/** 我在这里的身份；null 表示我不是成员（管理员看别人建的组织时） */
	myRole: OrgRole | null;
	members: number;
	/** 能不能改成员、改名称、撤回邀请：管理员与组织的主人/管理员 */
	canManage: boolean;
}

/** 一个组织最多多少个成员。再往上该按部门拆，不是一个组 */
export const ORG_MEMBER_LIMIT: number = 50;

/** 邀请票有效期：七天够看完一封邮件，又不至于躺在邮箱里半年后突然生效 */
export const INVITE_DAYS: number = 7;

const SLUG_RE: RegExp = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function isValidOrgSlug(value: string): boolean {
	return SLUG_RE.test(value);
}

/** 权限判断：管理员 / 组织的主人 / 组织里被设成 admin 的成员 */
export function canManageOrg(
	user: SessionUser | null,
	org: { owner_uid: number },
	myRole: OrgRole | null = null,
): boolean {
	if (!user) return false;
	if (user.role === "admin") return true;
	if (org.owner_uid === user.uid) return true;
	return myRole === "admin";
}

export async function orgById(
	db: D1Database,
	id: number,
): Promise<OrgRow | null> {
	return await db
		.prepare(
			"SELECT id, slug, name, description, cover, owner_uid, status, can_review, created_at, updated_at FROM orgs WHERE id = ?1",
		)
		.bind(id)
		.first<OrgRow>();
}

export async function orgBySlug(
	db: D1Database,
	slug: string,
): Promise<OrgRow | null> {
	return await db
		.prepare(
			"SELECT id, slug, name, description, cover, owner_uid, status, can_review, created_at, updated_at FROM orgs WHERE slug = ?1",
		)
		.bind(slug)
		.first<OrgRow>();
}

/** 这个人在这个组织里的身份；不是成员就是 null */
export async function memberRole(
	db: D1Database,
	orgId: number,
	uid: number,
): Promise<OrgRole | null> {
	const row = await db
		.prepare("SELECT role FROM org_members WHERE org_id = ?1 AND uid = ?2")
		.bind(orgId, uid)
		.first<{ role: string }>();
	return (row?.role as OrgRole | undefined) ?? null;
}

export async function isOrgMember(
	db: D1Database,
	orgId: number,
	uid: number,
): Promise<boolean> {
	return (await memberRole(db, orgId, uid)) !== null;
}

/**
 * 这个人参加的所有组织 slug。
 *
 * 受限文章的读权限要按组织判定，而这个判断发生在每一次 `/posts/*` 请求上，
 * 所以做成「一次查全、内存里比」，而不是「每篇文章一个 EXISTS 子查询」。
 */
export async function memberOrgSlugs(
	db: D1Database,
	uid: number,
): Promise<Set<string>> {
	const rows = await db
		.prepare(
			`SELECT o.slug
			   FROM org_members m
			   JOIN orgs o ON o.id = m.org_id
			  WHERE m.uid = ?1 AND o.status = 'active'`,
		)
		.bind(uid)
		.all<{ slug: string }>();
	return new Set((rows.results ?? []).map((row) => row.slug));
}

/** 组织成员 uid 清单：按组织邀请共创时用它展开名单 */
export async function orgMemberUids(
	db: D1Database,
	orgId: number,
): Promise<number[]> {
	const rows = await db
		.prepare(
			"SELECT uid FROM org_members WHERE org_id = ?1 ORDER BY created_at ASC",
		)
		.bind(orgId)
		.all<{ uid: number }>();
	return (rows.results ?? []).map((row) => row.uid);
}

export async function listMembers(
	db: D1Database,
	orgId: number,
): Promise<OrgMemberRow[]> {
	const rows = await db
		.prepare(
			`SELECT m.uid, u.account, u.display_name, u.avatar_url, m.role, m.created_at
			   FROM org_members m
			   JOIN users u ON u.uid = m.uid
			  WHERE m.org_id = ?1
			  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
			           m.created_at ASC`,
		)
		.bind(orgId)
		.all<OrgMemberRow>();
	return rows.results ?? [];
}

/**
 * 组织清单。
 *
 * 管理员看全部（建组、巡检都要能看见），其他人只看自己参加的那些——
 * 组织不是公开目录，别人的组名没必要对所有人广播。
 */
export async function listOrgs(
	db: D1Database,
	user: SessionUser,
): Promise<OrgSummary[]> {
	const all = user.role === "admin";
	const orgRows = await db
		.prepare(
			all
				? `SELECT o.id, o.slug, o.name, o.description, o.cover, o.owner_uid,
				          o.created_at, m.role AS my_role,
				          (SELECT COUNT(*) FROM org_members x WHERE x.org_id = o.id) AS members
				     FROM orgs o
				     LEFT JOIN org_members m ON m.org_id = o.id AND m.uid = ?1
				    WHERE o.status <> 'rejected'
				    ORDER BY o.created_at ASC`
				: `SELECT o.id, o.slug, o.name, o.description, o.cover, o.owner_uid,
				          o.created_at, m.role AS my_role,
				          (SELECT COUNT(*) FROM org_members x WHERE x.org_id = o.id) AS members
				     FROM orgs o
				     JOIN org_members m ON m.org_id = o.id AND m.uid = ?1
				    WHERE o.status = 'active'
				    ORDER BY o.created_at ASC`,
		)
		.bind(user.uid)
		.all<{
			id: number;
			slug: string;
			name: string;
			description: string | null;
			cover: string | null;
			owner_uid: number;
			created_at: string;
			my_role: string | null;
			members: number;
		}>();

	return (orgRows.results ?? []).map((row) => {
		const myRole = (row.my_role as OrgRole | null) ?? null;
		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			description: row.description ?? "",
			cover: row.cover ?? "",
			owner_uid: row.owner_uid,
			created_at: row.created_at,
			myRole,
			members: row.members ?? 0,
			canManage: canManageOrg(user, row, myRole),
		};
	});
}

export interface OrgInput {
	slug: string;
	name: string;
	description?: string;
	cover?: string;
	ownerUid: number;
}

export type OrgFail = "slug_taken" | "bad_slug" | "bad_name" | "bad_cover";

export interface OrgMutation {
	ok: boolean;
	code?: OrgFail;
	org?: OrgRow;
}

/** 封面只能是站内绝对路径或 http(s) 链接，别的写法一律拒掉 */
function isValidCover(value: string): boolean {
	if (!value) return true;
	if (value.length > 300) return false;
	if (value.startsWith("/")) return !value.startsWith("//");
	return /^https?:\/\//i.test(value);
}

/**
 * 建组织。
 *
 * 建的人自动成为 owner：一个组没有人管是最麻烦的状态，成员加不进、名字改不了。
 * 状态直接给 active——建组织的入口只开给管理员，不需要再走一道审批。
 */
export async function createOrg(
	db: D1Database,
	input: OrgInput,
): Promise<OrgMutation> {
	const slug = input.slug.trim().toLowerCase();
	const name = input.name.trim().slice(0, 40);
	if (!isValidOrgSlug(slug)) return { ok: false, code: "bad_slug" };
	if (!name) return { ok: false, code: "bad_name" };
	const cover = (input.cover ?? "").trim();
	if (!isValidCover(cover)) return { ok: false, code: "bad_cover" };

	const taken = await orgBySlug(db, slug);
	if (taken) return { ok: false, code: "slug_taken" };

	const created = await db
		.prepare(
			`INSERT INTO orgs (slug, name, description, cover, owner_uid, status)
			 VALUES (?1, ?2, ?3, ?4, ?5, 'active')
			 RETURNING id, slug, name, description, cover, owner_uid, status, can_review, created_at, updated_at`,
		)
		.bind(
			slug,
			name,
			(input.description ?? "").trim().slice(0, 200),
			cover,
			input.ownerUid,
		)
		.first<OrgRow>();
	if (!created) return { ok: false, code: "slug_taken" };

	await db
		.prepare(
			"INSERT INTO org_members (org_id, uid, role) VALUES (?1, ?2, 'owner') ON CONFLICT (org_id, uid) DO NOTHING",
		)
		.bind(created.id, input.ownerUid)
		.run();

	return { ok: true, org: created };
}

/** 改名称 / 简介 / 封面。slug 不给改：它写在文章 frontmatter 里，改了等于换组织 */
export async function updateOrg(
	db: D1Database,
	id: number,
	patch: { name?: string; description?: string; cover?: string },
): Promise<OrgMutation> {
	const current = await orgById(db, id);
	if (!current) return { ok: false, code: "bad_slug" };

	const name = (patch.name ?? current.name).trim().slice(0, 40);
	if (!name) return { ok: false, code: "bad_name" };
	const cover = (patch.cover ?? current.cover ?? "").trim();
	if (!isValidCover(cover)) return { ok: false, code: "bad_cover" };
	const description =
		patch.description === undefined
			? (current.description ?? "")
			: patch.description.trim().slice(0, 200);

	const updated = await db
		.prepare(
			`UPDATE orgs SET name = ?2, description = ?3, cover = ?4, updated_at = datetime('now')
			  WHERE id = ?1
			  RETURNING id, slug, name, description, cover, owner_uid, status, can_review, created_at, updated_at`,
		)
		.bind(id, name, description, cover)
		.first<OrgRow>();
	return updated ? { ok: true, org: updated } : { ok: false };
}

/** 删组织：成员与邀请跟着级联走，文章上的 org 字段留着不动（下次构建会当没配） */
export async function deleteOrg(db: D1Database, id: number): Promise<boolean> {
	const res = await db.prepare("DELETE FROM orgs WHERE id = ?1").bind(id).run();
	return (res.meta?.changes ?? 0) > 0;
}

/* ------------------------------ 成员 ------------------------------ */

export interface MemberResult {
	ok: boolean;
	code?: "exists" | "limit" | "last_owner" | "not_found";
}

export async function addMember(
	db: D1Database,
	orgId: number,
	uid: number,
	role: OrgRole = "member",
): Promise<MemberResult> {
	const exists = await memberRole(db, orgId, uid);
	if (exists) return { ok: false, code: "exists" };

	const count = await db
		.prepare("SELECT COUNT(*) AS total FROM org_members WHERE org_id = ?1")
		.bind(orgId)
		.first<{ total: number }>();
	if ((count?.total ?? 0) >= ORG_MEMBER_LIMIT)
		return { ok: false, code: "limit" };

	await db
		.prepare(
			"INSERT INTO org_members (org_id, uid, role) VALUES (?1, ?2, ?3) ON CONFLICT (org_id, uid) DO NOTHING",
		)
		.bind(orgId, uid, role)
		.run();
	return { ok: true };
}

/**
 * 移出组织。
 *
 * 最后一位 owner 不能被移走：没人管的组，成员加不进来、名字也改不了，
 * 只能等管理员来救。要换人就先把别人设成 owner 再移自己。
 */
export async function removeMember(
	db: D1Database,
	orgId: number,
	uid: number,
): Promise<MemberResult> {
	const role = await memberRole(db, orgId, uid);
	if (!role) return { ok: false, code: "not_found" };

	if (role === "owner") {
		const owners = await db
			.prepare(
				"SELECT COUNT(*) AS total FROM org_members WHERE org_id = ?1 AND role = 'owner'",
			)
			.bind(orgId)
			.first<{ total: number }>();
		if ((owners?.total ?? 0) <= 1) return { ok: false, code: "last_owner" };
	}

	await db
		.prepare("DELETE FROM org_members WHERE org_id = ?1 AND uid = ?2")
		.bind(orgId, uid)
		.run();
	return { ok: true };
}

export async function setMemberRole(
	db: D1Database,
	orgId: number,
	uid: number,
	role: OrgRole,
): Promise<MemberResult> {
	const current = await memberRole(db, orgId, uid);
	if (!current) return { ok: false, code: "not_found" };

	if (current === "owner" && role !== "owner") {
		const owners = await db
			.prepare(
				"SELECT COUNT(*) AS total FROM org_members WHERE org_id = ?1 AND role = 'owner'",
			)
			.bind(orgId)
			.first<{ total: number }>();
		if ((owners?.total ?? 0) <= 1) return { ok: false, code: "last_owner" };
	}

	await db
		.prepare("UPDATE org_members SET role = ?3 WHERE org_id = ?1 AND uid = ?2")
		.bind(orgId, uid, role)
		.run();
	return { ok: true };
}

/* ------------------------------ 邀请 ------------------------------ */

export interface OrgInviteRow {
	id: number;
	org_id: number;
	org_slug: string;
	org_name: string;
	uid: number;
	account: string;
	display_name: string | null;
	invited_by: number;
	inviter: string | null;
	status: string;
	created_at: string;
	expires_at: string;
	/** 只有「等我处理」的列表带 token：管理端要能就地接受/拒绝 */
	token?: string;
}

const INVITE_SELECT: string = `SELECT i.id, i.org_id, o.slug AS org_slug, o.name AS org_name,
	        i.uid, u.account, u.display_name, i.invited_by, v.display_name AS inviter,
	        i.status, i.created_at, i.expires_at
	   FROM org_invites i
	   JOIN orgs o ON o.id = i.org_id
	   JOIN users u ON u.uid = i.uid
	   LEFT JOIN users v ON v.uid = i.invited_by`;

function token(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface InviteCreated {
	ok: boolean;
	code?:
		| "not_found"
		| "self"
		| "exists"
		| "already_invited"
		| "inactive"
		| "limit";
	uid?: number;
	token?: string;
	orgName?: string;
	orgSlug?: string;
	displayName?: string;
	expiresAt?: string;
}

/**
 * 邀请一个账号加入组织。按登录名精确匹配，跟共创那边一个口径。
 *
 * 不直接进组：建一张票，发信给本人，他在站内点同意才成为成员。
 */
export async function createInvite(
	db: D1Database,
	input: { orgId: number; account: string; invitedBy: number },
): Promise<InviteCreated> {
	const org = await orgById(db, input.orgId);
	if (!org) return { ok: false, code: "not_found" };

	const target = await db
		.prepare(
			"SELECT uid, account, display_name, status FROM users WHERE account = ?1 AND status <> 'deleted'",
		)
		.bind(input.account.trim())
		.first<{
			uid: number;
			account: string;
			display_name: string | null;
			status: string;
		}>();
	if (!target) return { ok: false, code: "not_found" };
	if (target.uid === input.invitedBy) return { ok: false, code: "self" };
	if (target.status !== "active") return { ok: false, code: "inactive" };

	const members = await db
		.prepare("SELECT COUNT(*) AS total FROM org_members WHERE org_id = ?1")
		.bind(org.id)
		.first<{ total: number }>();
	if ((members?.total ?? 0) >= ORG_MEMBER_LIMIT)
		return { ok: false, code: "limit" };

	if (await memberRole(db, org.id, target.uid)) {
		return { ok: false, code: "exists" };
	}

	const pending = await db
		.prepare(
			"SELECT id FROM org_invites WHERE org_id = ?1 AND uid = ?2 AND status = 'pending' LIMIT 1",
		)
		.bind(org.id, target.uid)
		.first<{ id: number }>();
	if (pending) return { ok: false, code: "already_invited" };

	const value = token();
	const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");

	const res = await db
		.prepare(
			`INSERT INTO org_invites (org_id, uid, invited_by, token, expires_at)
			 VALUES (?1, ?2, ?3, ?4, ?5)`,
		)
		.bind(org.id, target.uid, input.invitedBy, value, expiresAt)
		.run();
	if ((res.meta?.changes ?? 0) === 0)
		return { ok: false, code: "already_invited" };

	return {
		ok: true,
		uid: target.uid,
		token: value,
		orgName: org.name,
		orgSlug: org.slug,
		displayName: target.display_name || target.account,
		expiresAt,
	};
}

/** 一个组织里还没回应的邀请（管理端成员面板显示「已邀请，等对方确认」） */
export async function listOrgInvites(
	db: D1Database,
	orgId: number,
): Promise<OrgInviteRow[]> {
	const rows = await db
		.prepare(
			`${INVITE_SELECT} WHERE i.org_id = ?1 AND i.status = 'pending' ORDER BY i.created_at DESC`,
		)
		.bind(orgId)
		.all<OrgInviteRow>();
	return rows.results ?? [];
}

/**
 * 「等我处理的邀请」。
 *
 * 过期的顺手标成 expired：列表每次打开都会清一遍，不用定时任务。
 * 状态枚举里没有 expired，直接落 declined 会污蔑人「拒绝过」，所以过期的不进列表，
 * 只在接受时拦一道。
 */
export async function listMyInvites(
	db: D1Database,
	uid: number,
): Promise<OrgInviteRow[]> {
	const rows = await db
		.prepare(
			`SELECT i.id, i.org_id, o.slug AS org_slug, o.name AS org_name,
			        i.uid, u.account, u.display_name, i.invited_by, v.display_name AS inviter,
			        i.token, i.status, i.created_at, i.expires_at
			   FROM org_invites i
			   JOIN orgs o ON o.id = i.org_id
			   JOIN users u ON u.uid = i.uid
			   LEFT JOIN users v ON v.uid = i.invited_by
			  WHERE i.uid = ?1 AND i.status = 'pending' AND i.expires_at > datetime('now')
			  ORDER BY i.created_at DESC`,
		)
		.bind(uid)
		.all<OrgInviteRow>();
	return rows.results ?? [];
}

export async function inviteByToken(
	db: D1Database,
	value: string,
): Promise<OrgInviteRow | null> {
	if (!/^[0-9a-f]{16,64}$/.test(value)) return null;
	return await db
		.prepare(`${INVITE_SELECT} WHERE i.token = ?1 LIMIT 1`)
		.bind(value)
		.first<OrgInviteRow>();
}

export interface AcceptResult {
	ok: boolean;
	code?: "not_found" | "expired" | "not_yours" | "already" | "limit";
	orgSlug?: string;
	orgName?: string;
}

/**
 * 同意邀请。
 *
 * 三道拦：票存在且还是 pending、票是发给当前这个人的、没过期。
 * 「发给别人」必须拦——票里的 token 会出现在邮件里，转发出去不等于授权。
 */
export async function acceptInvite(
	db: D1Database,
	value: string,
	uid: number,
): Promise<AcceptResult> {
	const invite = await inviteByToken(db, value);
	if (invite?.status !== "pending") return { ok: false, code: "not_found" };
	if (invite.uid !== uid) return { ok: false, code: "not_yours" };

	const expires = Date.parse(`${invite.expires_at.replace(" ", "T")}Z`);
	if (Number.isFinite(expires) && expires < Date.now()) {
		return { ok: false, code: "expired" };
	}

	if (await memberRole(db, invite.org_id, uid)) {
		await db
			.prepare(
				"UPDATE org_invites SET status = 'accepted', responded_at = datetime('now') WHERE id = ?1",
			)
			.bind(invite.id)
			.run();
		return {
			ok: true,
			code: "already",
			orgSlug: invite.org_slug,
			orgName: invite.org_name,
		};
	}

	const added = await addMember(db, invite.org_id, uid, "member");
	if (!added.ok) {
		return { ok: false, code: added.code === "limit" ? "limit" : "not_found" };
	}

	await db
		.prepare(
			"UPDATE org_invites SET status = 'accepted', responded_at = datetime('now') WHERE id = ?1",
		)
		.bind(invite.id)
		.run();

	return { ok: true, orgSlug: invite.org_slug, orgName: invite.org_name };
}

export async function declineInvite(
	db: D1Database,
	value: string,
	uid: number,
): Promise<boolean> {
	const invite = await inviteByToken(db, value);
	if (invite?.status !== "pending" || invite.uid !== uid) return false;
	const res = await db
		.prepare(
			"UPDATE org_invites SET status = 'declined', responded_at = datetime('now') WHERE id = ?1",
		)
		.bind(invite.id)
		.run();
	return (res.meta?.changes ?? 0) > 0;
}

/** 发起人撤回邀请：撤回后票立刻失效，对方再点就是 404 */
export async function revokeInvite(
	db: D1Database,
	orgId: number,
	inviteId: number,
): Promise<boolean> {
	const res = await db
		.prepare(
			`UPDATE org_invites SET status = 'revoked', responded_at = datetime('now')
			  WHERE id = ?1 AND org_id = ?2 AND status = 'pending'`,
		)
		.bind(inviteId, orgId)
		.run();
	return (res.meta?.changes ?? 0) > 0;
}
