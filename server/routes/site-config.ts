import { Hono } from "hono";
import { writeAudit } from "../lib/audit";
import { putRepoFile } from "../lib/github-contents";
import { sendTestMail } from "../lib/mail";
import { mailSettingsView, writeMailSettings } from "../lib/mail-config";
import { publicOrigin } from "../lib/origin";
import {
	checkConfig,
	clearSecret,
	KEY_DRAFT,
	KEY_PUBLISHED,
	pickHot,
	readSecret,
	readSetting,
	SECRET_NAMES,
	type SecretName,
	secretStatus,
	writeSecret,
	writeSetting,
} from "../lib/site-config";
import { requireRole } from "../middleware/auth";
import { requireJsonBody, sameOriginGuard } from "../middleware/guard";
import type { AppEnv } from "../types";

/**
 * 站点配置：公开读热点字段 + 管理端读写草稿/发布/密钥。
 *
 * 公开接口只吐白名单里的热字段，整份配置与密钥都不出现在任何无权限响应里。
 */
export const siteConfig: Hono<AppEnv> = new Hono<AppEnv>();

const REPO = "cixiy1/Yuki-blog";
const CONFIG_PATH = "config/site.json";
const BRANCH = "main";

type ConfigMap = Record<string, unknown>;

siteConfig.get("/site-config", async (c) => {
	const published = await readSetting<ConfigMap>(c.env.DB, KEY_PUBLISHED);
	const row = await c.env.DB.prepare(
		"SELECT updated_at FROM settings WHERE key = ?1",
	)
		.bind(KEY_PUBLISHED)
		.first<{ updated_at: string }>();
	// 缓存 10 秒：热字段只影响主题色相，不值得为它每次回源查 D1；
	// 但也不能像一开始那样缓存 60 秒——「立即应用」之后访客要等一分钟才看见，
	// 而且刚点完就刷新的人会拿到旧响应，看着像没生效。
	c.header("cache-control", "public, max-age=10");
	return c.json({
		config: pickHot(published ?? {}),
		updated_at: row?.updated_at ?? null,
	});
});

const admin = new Hono<AppEnv>();
admin.use("*", requireRole("admin"));

/** 草稿 + 已发布 + 最近版本，一次性给管理端渲染用 */
admin.get("/site-config", async (c) => {
	interface VersionRow {
		id: number;
		note: string | null;
		commit_sha: string | null;
		published_by: number | null;
		published_at: string;
		size: number;
	}

	const versionRows = await c.env.DB.prepare(
		`SELECT id, note, commit_sha, published_by, published_at,
		        length(snapshot) AS size
		   FROM site_config_versions
		  ORDER BY id DESC LIMIT 20`,
	).all<VersionRow>();

	const [draft, published] = await Promise.all([
		readSetting<ConfigMap>(c.env.DB, KEY_DRAFT),
		readSetting<ConfigMap>(c.env.DB, KEY_PUBLISHED),
	]);
	const draftValue = draft ?? published ?? {};

	/**
	 * 最近一次「真的写进了仓库」的快照。
	 *
	 * 「立即应用」会把热字段盖进 `published`，但仓库里的 `config/site.json`
	 * 还是旧的。管理端要判断「还能不能发布」只能比这个快照——拿 `published`
	 * 当基准的话，应用完热字段就显示「待发布 0 处」，发布按钮直接变灰。
	 */
	const repoRow = await c.env.DB.prepare(
		`SELECT snapshot FROM site_config_versions
		  WHERE commit_sha IS NOT NULL
		  ORDER BY id DESC LIMIT 1`,
	).first<{ snapshot: string }>();
	let repo: ConfigMap | null = null;
	if (repoRow?.snapshot) {
		try {
			repo = JSON.parse(repoRow.snapshot) as ConfigMap;
		} catch {
			repo = null;
		}
	}

	return c.json({
		draft: draftValue,
		published: published ?? {},
		repo,
		dirty: JSON.stringify(draftValue) !== JSON.stringify(published ?? {}),
		versions: versionRows.results ?? [],
		hasGithubToken: Boolean(
			await readSecret(c.env.DB, c.env.PASSWORD_ENC_KEY ?? "", "github_token"),
		),
	});
});

/** 存草稿。不校验「有没有改」，也不触发任何构建。 */
admin.put("/site-config", sameOriginGuard, requireJsonBody, async (c) => {
	const body = (await c.req.json().catch(() => null)) as {
		config?: unknown;
	} | null;
	const checked = checkConfig(body?.config);
	if (!checked.ok) {
		return c.json(
			{
				error: "invalid_config",
				message: checked.issues[0],
				issues: checked.issues,
			},
			400,
		);
	}
	// 空草稿会整份覆盖 draft。前端一旦把「没有改动」也提交上来（旧版本
	// 只提交与已发布值不同的字段，热字段应用后差异恰好为零），这里就会
	// 把整份配置抹掉，下一次发布再把它写进仓库。宁可拒掉。
	if (Object.keys(checked.value).length === 0) {
		return c.json(
			{ error: "nothing_to_save", message: "没有要保存的改动" },
			400,
		);
	}
	await writeSetting(
		c.env.DB,
		KEY_DRAFT,
		checked.value,
		c.get("user")?.uid ?? null,
	);
	await writeAudit(c.env.DB, {
		actorUid: c.get("user")?.uid ?? null,
		action: "admin.settings.save",
		target: "site.config",
		detail: { keys: Object.keys(checked.value) },
	});
	return c.json({ ok: true });
});

/**
 * 立即应用：只把「热字段」盖到已发布内容上，不写仓库、不触发构建。
 *
 * 为什么可以这样做：热字段（目前只有主题色相）不参与 SEO、不决定结构，
 * 站点里只有一处消费（根节点的 --hue），页面加载后由 /api/site-config 覆盖。
 * 非热字段一律留到「发布」时随构建生效——两条通道汇合在同一份 published 上，
 * 不存在两套真相。
 */
admin.post("/site-config/apply", sameOriginGuard, async (c) => {
	const actorUid = c.get("user")?.uid ?? null;
	const [draft, published] = await Promise.all([
		readSetting<ConfigMap>(c.env.DB, KEY_DRAFT),
		readSetting<ConfigMap>(c.env.DB, KEY_PUBLISHED),
	]);
	if (!draft) {
		return c.json(
			{ error: "nothing_to_apply", message: "还没有保存过草稿" },
			400,
		);
	}

	const hot = pickHot(draft);
	if (Object.keys(hot).length === 0) {
		return c.json(
			{ error: "no_hot_field", message: "草稿里没有可立即生效的字段" },
			400,
		);
	}

	const next: ConfigMap = { ...(published ?? {}) };
	for (const [ns, patch] of Object.entries(hot)) {
		const current = next[ns];
		next[ns] =
			current && typeof current === "object" && !Array.isArray(current)
				? { ...(current as ConfigMap), ...(patch as ConfigMap) }
				: patch;
	}

	await writeSetting(c.env.DB, KEY_PUBLISHED, next, actorUid);
	await writeAudit(c.env.DB, {
		actorUid,
		action: "admin.settings.apply",
		target: "site.config",
		detail: { keys: Object.keys(hot) },
	});
	return c.json({
		ok: true,
		config: hot,
		message: "已生效。访客刷新即可看到（接口有 10 秒缓存，最多等这么久）",
	});
});

/**
 * 发布：把草稿整份写进仓库的 config/site.json，触发 Cloudflare 构建。
 * 没有 PAT 时返回 412，管理端据此切成「导出 JSON」。
 */
admin.post("/site-config/publish", sameOriginGuard, async (c) => {
	const actorUid = c.get("user")?.uid ?? null;
	const draft = await readSetting<ConfigMap>(c.env.DB, KEY_DRAFT);
	// `{}` 也是 truthy：以前只判 `!draft`，空草稿能一路写进仓库，
	// `config/site.json` 被清成只剩 `_comment`，站点所有配置回默认值。
	if (!draft || Object.keys(draft).length === 0) {
		return c.json(
			{
				error: "empty_draft",
				message: "草稿是空的，先把要发布的配置保存一次再发布",
			},
			400,
		);
	}

	const token = await readSecret(
		c.env.DB,
		c.env.PASSWORD_ENC_KEY ?? "",
		"github_token",
	);
	if (!token) {
		return c.json(
			{
				error: "github_token_missing",
				message: "还没配置 GitHub 令牌，先去「集成」里填",
			},
			412,
		);
	}

	const body = (await c.req.json().catch(() => ({}))) as { note?: unknown };
	const note =
		typeof body.note === "string" && body.note.trim()
			? body.note.trim().slice(0, 200)
			: "chore(site): 更新站点配置";

	// `_comment` 只写进仓库文件（给人看的），不进 D1 草稿——否则过不了白名单校验
	const fileDoc = {
		_comment:
			"管理端「站点设置」发布时整体覆盖本文件。各分区留空即使用 src/config 里的默认值。分区：site / profile / music / friends / banner / announcement / sponsor",
		...draft,
	};
	const content = `${JSON.stringify(fileDoc, null, "\t")}\n`;
	const result = await putRepoFile({
		repo: REPO,
		path: CONFIG_PATH,
		branch: BRANCH,
		content,
		message: note,
		token,
	});
	if (!result.ok) {
		await writeAudit(c.env.DB, {
			actorUid,
			action: "admin.settings.publish_failed",
			target: "site.config",
			detail: { status: result.status },
		});
		return c.json(
			{
				error: "publish_failed",
				message: result.message ?? "写入仓库失败",
				status: result.status,
			},
			502,
		);
	}

	await writeSetting(c.env.DB, KEY_PUBLISHED, draft, actorUid);
	await c.env.DB.prepare(
		`INSERT INTO site_config_versions (snapshot, note, commit_sha, published_by)
		 VALUES (?1, ?2, ?3, ?4)`,
	)
		.bind(JSON.stringify(draft), note, result.sha ?? null, actorUid)
		.run();
	await writeAudit(c.env.DB, {
		actorUid,
		action: "admin.settings.publish",
		target: "site.config",
		detail: { sha: result.sha, keys: Object.keys(draft) },
	});

	return c.json({
		ok: true,
		commit_sha: result.sha ?? null,
		message: "已提交，Cloudflare 通常在 90 秒内构建完成",
	});
});

/** 把某个历史版本灌回草稿（不直接发布，走正常流程） */
admin.post("/site-config/rollback", sameOriginGuard, async (c) => {
	const body = (await c.req.json().catch(() => null)) as {
		id?: unknown;
	} | null;
	const id = Number(body?.id);
	if (!Number.isInteger(id) || id <= 0) {
		return c.json({ error: "bad_request", message: "id 非法" }, 400);
	}
	const row = await c.env.DB.prepare(
		"SELECT snapshot FROM site_config_versions WHERE id = ?1",
	)
		.bind(id)
		.first<{ snapshot: string }>();
	if (!row) return c.json({ error: "not_found", message: "版本不存在" }, 404);

	const snapshot = JSON.parse(row.snapshot) as ConfigMap;
	await writeSetting(c.env.DB, KEY_DRAFT, snapshot, c.get("user")?.uid ?? null);
	await writeAudit(c.env.DB, {
		actorUid: c.get("user")?.uid ?? null,
		action: "admin.settings.rollback",
		target: `site.config#${id}`,
		detail: { version: id },
	});
	return c.json({ ok: true, draft: snapshot });
});

/** 密钥只看状态：配没配、末四位。密文与明文都不出库。 */
admin.get("/secrets", async (c) => {
	return c.json({
		secrets: await secretStatus(c.env.DB, c.env.PASSWORD_ENC_KEY ?? ""),
	});
});

admin.put("/secrets", sameOriginGuard, requireJsonBody, async (c) => {
	const body = (await c.req.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	const name = String(body?.name ?? "");
	if (!SECRET_NAMES.includes(name as SecretName)) {
		return c.json({ error: "bad_request", message: "不认识这个密钥名" }, 400);
	}
	const value = typeof body?.value === "string" ? body.value.trim() : "";
	const rootKey = c.env.PASSWORD_ENC_KEY ?? "";
	if (!rootKey) {
		return c.json(
			{ error: "server_misconfigured", message: "服务端缺少加密根密钥" },
			500,
		);
	}

	const actorUid = c.get("user")?.uid ?? null;
	// 空值 = 删除该密钥；否则加密后覆盖
	if (value) {
		const ok = await writeSecret(
			c.env.DB,
			rootKey,
			name as SecretName,
			value,
			actorUid,
		);
		if (!ok) {
			return c.json({ error: "encrypt_failed", message: "加密失败" }, 500);
		}
	} else {
		await clearSecret(c.env.DB, name as SecretName, actorUid);
	}
	await writeAudit(c.env.DB, {
		actorUid: c.get("user")?.uid ?? null,
		action: "admin.secrets.write",
		target: name,
		// 只记动作，不记值
		detail: { cleared: !value },
	});
	return c.json({ ok: true, secrets: await secretStatus(c.env.DB, rootKey) });
});

/* ---------------------------- 发信配置 ---------------------------- */

/** 管理端读：只有非密字段，密钥状态走 /secrets */
admin.get("/mail-config", async (c) => {
	return c.json(await mailSettingsView(c.env));
});

admin.put("/mail-config", sameOriginGuard, requireJsonBody, async (c) => {
	const body = (await c.req.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	const raw = (body?.config ?? {}) as Record<string, unknown>;
	const smtp = (raw.smtp ?? {}) as Record<string, unknown>;

	const actorUid = c.get("user")?.uid ?? null;
	const config = await writeMailSettings(
		c.env.DB,
		{
			mode: typeof raw.mode === "string" ? raw.mode : undefined,
			from: typeof raw.from === "string" ? raw.from : undefined,
			// 数组或逗号分隔字符串都收；老前端还在传 notifyTo 时也认
			adminEmails:
				raw.adminEmails !== undefined ? raw.adminEmails : raw.notifyTo,
			smtp: {
				host: typeof smtp.host === "string" ? smtp.host : undefined,
				port: Number(smtp.port) || undefined,
				security: typeof smtp.security === "string" ? smtp.security : undefined,
				user: typeof smtp.user === "string" ? smtp.user : undefined,
			},
		},
		actorUid,
	);

	await writeAudit(c.env.DB, {
		actorUid,
		action: "admin.mail.save",
		target: config.mode,
		detail: { host: config.smtp.host, security: config.smtp.security },
	});
	return c.json({ ok: true, config });
});

/**
 * 发一封测试邮件，验证发信配置真的能用。
 * 默认发给当前登录管理员的邮箱——手填别人的地址等于给别人发垃圾邮件。
 */
admin.post("/mail-test", sameOriginGuard, requireJsonBody, async (c) => {
	const me = c.get("user");
	if (!me) return c.json({ error: "unauthorized" }, 401);
	const body = (await c.req.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	const typed = typeof body?.to === "string" ? body.to.trim() : "";

	const row = await c.env.DB.prepare("SELECT email FROM users WHERE uid = ?1")
		.bind(me.uid)
		.first<{ email: string | null }>();
	const to = typed || row?.email || "";
	if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
		return c.json(
			{ error: "bad_email", message: "你的账号还没填邮箱，先填一个再测" },
			400,
		);
	}

	const origin = publicOrigin(c.req.raw, c.env.SITE_ORIGIN);
	const result = await sendTestMail(c.env, to, origin);

	await writeAudit(c.env.DB, {
		actorUid: me.uid,
		action: "admin.mail.test",
		target: to,
		detail: { ok: result.ok, mode: result.mode ?? null },
	});

	// 没有可用通道时 sendMail 会返回 sent:false（不算错，但邮件确实没发出去）
	const delivered = result.ok && result.sent;
	return c.json({
		ok: delivered,
		sent: result.sent,
		mode: result.mode ?? result.configMode,
		to,
		from: result.from,
		message: delivered
			? null
			: (result.hint ??
				result.providerMessage ??
				"当前没有可用的发信通道，检查模式与密钥"),
	});
});

siteConfig.route("/admin", admin);
