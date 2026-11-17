import { Hono } from "hono";
import { writeAudit } from "../lib/audit";
import { resolveGithubToken } from "../lib/media-store";
import { notifyOrgInvite } from "../lib/org-notify";
import { syncOrgSnapshot } from "../lib/org-store";
import {
	acceptInvite,
	addMember,
	canManageOrg,
	createInvite,
	createOrg,
	declineInvite,
	deleteOrg,
	inviteByToken,
	listMembers,
	listMyInvites,
	listOrgInvites,
	listOrgs,
	memberRole,
	ORG_MEMBER_LIMIT,
	orgById,
	removeMember,
	revokeInvite,
	setMemberRole,
	updateOrg,
} from "../lib/orgs";
import { publicOrigin } from "../lib/origin";
import { requireAuth, requireRole } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

/**
 * 组织：建组、拉人、接受邀请。
 *
 * 建组只开给管理员——站点是个人的，组织相当于「一块带页面的归属」，
 * 谁都能建就会出现一堆空组把 /orgs/ 撑满。拉人由组织的主人/管理员做，
 * 被拉的人要么在站内点同意，要么什么都不会发生。
 */
export const orgs: Hono<AppEnv> = new Hono<AppEnv>();

const FORBIDDEN = {
	error: "forbidden",
	message: "只有组织的主人或管理员能改这里",
} as const;

/** 组织公开信息的同步：失败不影响组织本身，只让站点页面等下一次构建 */
async function syncSite(env: Env): Promise<{
	site: boolean;
	commit: string | null;
	warning?: string;
}> {
	const token = await resolveGithubToken(env);
	if (!token) {
		return {
			site: false,
			commit: null,
			warning: "还没配置 GitHub 令牌，站点上的组织页要等下次手动推送才会更新",
		};
	}
	const result = await syncOrgSnapshot(token, env.DB);
	if (!result.ok) {
		return { site: false, commit: null, warning: result.message };
	}
	return { site: true, commit: result.commit ?? null };
}

/** 组织详情：成员与待处理邀请只有成员看得到 */
orgs.get("/", requireAuth, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);

	return c.json({
		limit: ORG_MEMBER_LIMIT,
		orgs: await listOrgs(c.env.DB, user),
		// 等我处理的邀请：管理端一进来就能看到，不用等邮件
		invites: await listMyInvites(c.env.DB, user.uid),
	});
});

orgs.get("/:id", requireAuth, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);

	const id = Number(c.req.param("id"));
	if (!Number.isInteger(id) || id <= 0) {
		return c.json({ error: "not_found", message: "组织不存在" }, 404);
	}
	const org = await orgById(c.env.DB, id);
	if (!org) return c.json({ error: "not_found", message: "组织不存在" }, 404);

	const myRole = await memberRole(c.env.DB, org.id, user.uid);
	const canManage = canManageOrg(user, org, myRole);
	// 不是成员也不是管理员：连组名都不给看，避免拿 id 遍历别人的组
	if (!myRole && user.role !== "admin") {
		return c.json(FORBIDDEN, 403);
	}

	return c.json({
		org: {
			id: org.id,
			slug: org.slug,
			name: org.name,
			description: org.description ?? "",
			cover: org.cover ?? "",
			owner_uid: org.owner_uid,
			created_at: org.created_at,
		},
		myRole,
		canManage,
		limit: ORG_MEMBER_LIMIT,
		members: await listMembers(c.env.DB, org.id),
		// 待处理邀请只在能管的人那里显示；普通成员看到也无用，还多一份名单泄露
		invites: canManage ? await listOrgInvites(c.env.DB, org.id) : [],
	});
});

orgs.post(
	"/",
	requireRole("admin"),
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const slug = typeof body.slug === "string" ? body.slug : "";
		const name = typeof body.name === "string" ? body.name : "";

		const result = await createOrg(c.env.DB, {
			slug,
			name,
			description: typeof body.description === "string" ? body.description : "",
			cover: typeof body.cover === "string" ? body.cover : "",
			ownerUid: user.uid,
		});
		if (!result.ok || !result.org) {
			const map: Record<string, [number, string]> = {
				bad_slug: [400, "地址只能用小写字母、数字与短横线，且以字母或数字开头"],
				bad_name: [400, "组织要有名字"],
				bad_cover: [400, "封面只能用站内路径（/assets/…）或 http(s) 链接"],
				slug_taken: [409, "这个地址已经有组织了"],
			};
			const [status, message] = map[result.code ?? "bad_slug"];
			return c.json(
				{ error: result.code ?? "bad_request", message },
				status as 400,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "org.create",
			target: `org:${result.org.slug}`,
			detail: { org_id: result.org.id, slug: result.org.slug },
		});

		const site = await syncSite(c.env);
		return c.json({
			ok: true,
			org: { ...result.org, myRole: "owner", members: 1, canManage: true },
			site,
		});
	},
);

orgs.patch("/:id", requireAuth, requireJsonBody, sameOriginGuard, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);

	const id = Number(c.req.param("id"));
	const org = Number.isInteger(id) ? await orgById(c.env.DB, id) : null;
	if (!org) return c.json({ error: "not_found", message: "组织不存在" }, 404);

	const myRole = await memberRole(c.env.DB, org.id, user.uid);
	if (!canManageOrg(user, org, myRole)) return c.json(FORBIDDEN, 403);

	const body = (await c.req.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	const result = await updateOrg(c.env.DB, org.id, {
		name: typeof body.name === "string" ? body.name : undefined,
		description:
			typeof body.description === "string" ? body.description : undefined,
		cover: typeof body.cover === "string" ? body.cover : undefined,
	});
	if (!result.ok || !result.org) {
		return c.json(
			{
				error: result.code ?? "save_failed",
				message:
					result.code === "bad_cover"
						? "封面只能用站内路径（/assets/…）或 http(s) 链接"
						: "保存失败",
			},
			400,
		);
	}

	await writeAudit(c.env.DB, {
		actorUid: user.uid,
		action: "org.update",
		target: `org:${org.slug}`,
		detail: { org_id: org.id, slug: org.slug },
	});

	const site = await syncSite(c.env);
	return c.json({
		ok: true,
		org: { ...result.org, myRole, members: 0, canManage: true },
		site,
	});
});

orgs.delete("/:id", requireRole("admin"), sameOriginGuard, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);

	const id = Number(c.req.param("id"));
	const org = Number.isInteger(id) ? await orgById(c.env.DB, id) : null;
	if (!org) return c.json({ error: "not_found", message: "组织不存在" }, 404);

	const removed = await deleteOrg(c.env.DB, org.id);
	if (!removed)
		return c.json({ error: "not_found", message: "组织不存在" }, 404);

	await writeAudit(c.env.DB, {
		actorUid: user.uid,
		action: "org.delete",
		target: `org:${org.slug}`,
		detail: { org_id: org.id, slug: org.slug },
	});

	const site = await syncSite(c.env);
	return c.json({ ok: true, site });
});

/* ------------------------------ 成员 ------------------------------ */

/**
 * 拉人进组织 = 发一张邀请票 + 发信。
 *
 * 不直接加成员：见 0015 迁移顶部的注释，同意这一步不能省。
 */
orgs.post(
	"/:id/members",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const id = Number(c.req.param("id"));
		const org = Number.isInteger(id) ? await orgById(c.env.DB, id) : null;
		if (!org) return c.json({ error: "not_found", message: "组织不存在" }, 404);

		const myRole = await memberRole(c.env.DB, org.id, user.uid);
		if (!canManageOrg(user, org, myRole)) return c.json(FORBIDDEN, 403);

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const account = typeof body.account === "string" ? body.account.trim() : "";
		if (!account) {
			return c.json(
				{ error: "bad_request", message: "填入要邀请的登录名" },
				400,
			);
		}

		const created = await createInvite(c.env.DB, {
			orgId: org.id,
			account,
			invitedBy: user.uid,
		});
		if (!created.ok) {
			const map: Record<string, [number, string]> = {
				not_found: [404, "没有这个登录名"],
				self: [400, "自己已经在组里了"],
				exists: [409, "这个人已经是成员"],
				already_invited: [409, "已经邀请过，等对方确认"],
				inactive: [400, "这个账号还没激活或被停用了"],
				limit: [409, `一个组织最多 ${ORG_MEMBER_LIMIT} 人`],
			};
			const [status, message] = map[created.code ?? "not_found"];
			return c.json(
				{ error: created.code ?? "bad_request", message },
				status as 400,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "org.invite.create",
			target: `org:${org.slug}`,
			detail: { org_id: org.id, slug: org.slug, uid: created.uid ?? null },
		});

		const origin = publicOrigin(c.req.raw, c.env.SITE_ORIGIN);
		const link = `${origin}/admin/#/orgs/invite/${created.token ?? ""}`;
		const mail = await notifyOrgInvite(c.env, {
			uid: created.uid ?? 0,
			org: org.name,
			description: org.description ?? "",
			inviter: user.display_name || user.account,
			link,
			expiresAt: (created.expiresAt ?? "").slice(0, 10),
		});

		return c.json({
			ok: true,
			mail,
			members: await listMembers(c.env.DB, org.id),
			invites: await listOrgInvites(c.env.DB, org.id),
		});
	},
);

orgs.post(
	"/:id/members/remove",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const id = Number(c.req.param("id"));
		const org = Number.isInteger(id) ? await orgById(c.env.DB, id) : null;
		if (!org) return c.json({ error: "not_found", message: "组织不存在" }, 404);

		const myRole = await memberRole(c.env.DB, org.id, user.uid);
		if (!canManageOrg(user, org, myRole)) return c.json(FORBIDDEN, 403);

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const uid = Number(body.uid);
		if (!Number.isInteger(uid) || uid <= 0) {
			return c.json({ error: "bad_request", message: "uid 非法" }, 400);
		}

		const result = await removeMember(c.env.DB, org.id, uid);
		if (!result.ok) {
			const map: Record<string, [number, string]> = {
				not_found: [404, "这个人不在组里"],
				last_owner: [409, "最后一位主人不能移出：先把别人设成主人"],
			};
			const [status, message] = map[result.code ?? "not_found"];
			return c.json(
				{ error: result.code ?? "bad_request", message },
				status as 400,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "org.member.remove",
			target: `org:${org.slug}`,
			detail: { org_id: org.id, slug: org.slug, uid },
		});

		return c.json({
			ok: true,
			members: await listMembers(c.env.DB, org.id),
			invites: await listOrgInvites(c.env.DB, org.id),
		});
	},
);

orgs.post(
	"/:id/members/role",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const id = Number(c.req.param("id"));
		const org = Number.isInteger(id) ? await orgById(c.env.DB, id) : null;
		if (!org) return c.json({ error: "not_found", message: "组织不存在" }, 404);

		const myRole = await memberRole(c.env.DB, org.id, user.uid);
		if (!canManageOrg(user, org, myRole)) return c.json(FORBIDDEN, 403);

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const uid = Number(body.uid);
		const role = body.role === "admin" ? "admin" : "member";
		if (!Number.isInteger(uid) || uid <= 0) {
			return c.json({ error: "bad_request", message: "uid 非法" }, 400);
		}

		const result = await setMemberRole(c.env.DB, org.id, uid, role);
		if (!result.ok) {
			const map: Record<string, [number, string]> = {
				not_found: [404, "这个人不在组里"],
				last_owner: [409, "最后一位主人不能降级：先把别人设成主人"],
			};
			const [status, message] = map[result.code ?? "not_found"];
			return c.json(
				{ error: result.code ?? "bad_request", message },
				status as 400,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "org.member.role",
			target: `org:${org.slug}`,
			detail: { org_id: org.id, slug: org.slug, uid, role },
		});

		return c.json({ ok: true, members: await listMembers(c.env.DB, org.id) });
	},
);

orgs.post(
	"/:id/invites/revoke",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const id = Number(c.req.param("id"));
		const org = Number.isInteger(id) ? await orgById(c.env.DB, id) : null;
		if (!org) return c.json({ error: "not_found", message: "组织不存在" }, 404);

		const myRole = await memberRole(c.env.DB, org.id, user.uid);
		if (!canManageOrg(user, org, myRole)) return c.json(FORBIDDEN, 403);

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const inviteId = Number(body.inviteId);
		if (!Number.isInteger(inviteId) || inviteId <= 0) {
			return c.json({ error: "bad_request", message: "inviteId 非法" }, 400);
		}

		const done = await revokeInvite(c.env.DB, org.id, inviteId);
		if (!done) {
			return c.json(
				{ error: "not_found", message: "这张邀请已经处理过了" },
				404,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "org.invite.revoke",
			target: `org:${org.slug}`,
			detail: { org_id: org.id, slug: org.slug, invite_id: inviteId },
		});

		return c.json({
			ok: true,
			invites: await listOrgInvites(c.env.DB, org.id),
		});
	},
);

/* ------------------------------ 收信人的动作 ------------------------------ */

/** 打开邀请落地页：只回这一张票的信息，不回组织成员名单 */
orgs.get("/invites/:token", requireAuth, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "unauthorized", message: "请先登录" }, 401);

	const invite = await inviteByToken(c.env.DB, c.req.param("token"));
	if (!invite)
		return c.json({ error: "not_found", message: "这张邀请不存在" }, 404);

	// 票是发给具体某个人的：别人拿到链接也只该看到「不是给你的」
	const mine = invite.uid === user.uid;
	const expired =
		Date.parse(`${invite.expires_at.replace(" ", "T")}Z`) < Date.now();

	return c.json({
		org: { slug: invite.org_slug, name: invite.org_name },
		inviter: invite.inviter || "管理员",
		status: invite.status,
		mine,
		expired,
		expires_at: invite.expires_at,
	});
});

orgs.post(
	"/invites/accept",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const value = typeof body.token === "string" ? body.token.trim() : "";
		if (!value)
			return c.json({ error: "bad_request", message: "缺少邀请码" }, 400);

		const result = await acceptInvite(c.env.DB, value, user.uid);
		if (!result.ok) {
			const map: Record<string, [number, string]> = {
				not_found: [404, "这张邀请已经失效"],
				expired: [410, "邀请已过期，请对方重新发一次"],
				not_yours: [403, "这张邀请不是发给你的"],
				limit: [409, `一个组织最多 ${ORG_MEMBER_LIMIT} 人`],
			};
			const [status, message] = map[result.code ?? "not_found"];
			return c.json(
				{ error: result.code ?? "bad_request", message },
				status as 400,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "org.invite.accept",
			target: `org:${result.orgSlug ?? ""}`,
			detail: { slug: result.orgSlug ?? "", uid: user.uid },
		});

		return c.json({
			ok: true,
			slug: result.orgSlug ?? "",
			name: result.orgName ?? "",
		});
	},
);

orgs.post(
	"/invites/decline",
	requireAuth,
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const value = typeof body.token === "string" ? body.token.trim() : "";
		if (!value)
			return c.json({ error: "bad_request", message: "缺少邀请码" }, 400);

		const done = await declineInvite(c.env.DB, value, user.uid);
		if (!done)
			return c.json({ error: "not_found", message: "这张邀请已经失效" }, 404);

		const invite = await inviteByToken(c.env.DB, value);
		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "org.invite.decline",
			target: `org:${invite?.org_slug ?? ""}`,
			detail: { slug: invite?.org_slug ?? "", uid: user.uid },
		});

		return c.json({ ok: true });
	},
);

/** 手动把自己加进组（补一条成员记录，仅管理员：用于修复邀请流程没走完的历史数据） */
orgs.post(
	"/:id/members/direct",
	requireRole("admin"),
	requireJsonBody,
	sameOriginGuard,
	async (c) => {
		const user = c.get("user");
		if (!user)
			return c.json({ error: "unauthorized", message: "请先登录" }, 401);

		const id = Number(c.req.param("id"));
		const org = Number.isInteger(id) ? await orgById(c.env.DB, id) : null;
		if (!org) return c.json({ error: "not_found", message: "组织不存在" }, 404);

		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		const uid = Number(body.uid);
		if (!Number.isInteger(uid) || uid <= 0) {
			return c.json({ error: "bad_request", message: "uid 非法" }, 400);
		}

		const added = await addMember(c.env.DB, org.id, uid, "member");
		if (!added.ok) {
			const map: Record<string, [number, string]> = {
				exists: [409, "这个人已经是成员"],
				limit: [409, `一个组织最多 ${ORG_MEMBER_LIMIT} 人`],
				last_owner: [409, "最后一位主人不能移出"],
				not_found: [404, "没找到"],
			};
			const [status, message] = map[added.code ?? "not_found"];
			return c.json(
				{ error: added.code ?? "bad_request", message },
				status as 400,
			);
		}

		await writeAudit(c.env.DB, {
			actorUid: user.uid,
			action: "org.member.add",
			target: `org:${org.slug}`,
			detail: { org_id: org.id, slug: org.slug, uid },
		});

		return c.json({ ok: true, members: await listMembers(c.env.DB, org.id) });
	},
);
