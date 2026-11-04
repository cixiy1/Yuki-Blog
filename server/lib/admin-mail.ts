import { normalizeEmails, readMailSettings } from "./mail-config";

/**
 * 管理员收件人：站点设置里填的「管理员邮箱」优先，没填就发给
 * 所有启用中的管理员与审核员账号的邮箱。
 *
 * 待审提醒、撤回提醒，以及以后新增的告警都从这里取收件人，
 * 别各自再写一套「去哪读配置」的逻辑。
 */
export async function resolveAdminEmails(env: Env): Promise<string[]> {
	const config = await readMailSettings(env.DB);
	if (config.adminEmails.length > 0) return config.adminEmails;

	const rows = await env.DB.prepare(
		`SELECT email FROM users
		  WHERE status = 'active' AND role IN ('admin', 'reviewer') AND email <> ''
		  ORDER BY role DESC, id ASC
		  LIMIT 20`,
	).all<{ email: string }>();
	return normalizeEmails((rows.results ?? []).map((row) => row.email));
}
