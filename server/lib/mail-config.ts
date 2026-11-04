import { readSecret, readSetting, writeSetting } from "./site-config";

/**
 * 发信通道的配置：非密的走 settings 表（`site.mail`），密码/API Key 走密钥库。
 *
 * 为什么不放 env：换发信服务不该改代码再部署一次，管理端填完就能用。
 * env 只作为兜底——老部署只配了 RESEND_API_KEY，升级后照样能发信。
 */

export type MailMode = "off" | "resend" | "smtp";

/** ssl = 465 一上来就 TLS；starttls = 587 先明文再升级；none = 内网中继/本地调试 */
export type SmtpSecurity = "ssl" | "starttls" | "none";

export const MAIL_CONFIG_KEY = "site.mail";
export const DEFAULT_FROM = "Yuki Blog <mail@yiyu14.top>";

export interface MailConfigStored {
	mode: MailMode;
	from: string;
	/**
	 * 有新稿待审时提醒谁，逗号分隔。
	 * 留空则退化为「所有启用中的管理员与审核员账号的邮箱」。
	 */
	notifyTo: string;
	smtp: {
		host: string;
		port: number;
		security: SmtpSecurity;
		user: string;
	};
}

/** 运行时拿到的完整配置，密码已解密 */
export interface MailConfig extends MailConfigStored {
	resendKey: string;
	smtp: MailConfigStored["smtp"] & { pass: string };
	/** 配置来源：db 表示管理端填过，env 表示只有环境变量 */
	source: "db" | "env";
}

export const MAIL_DEFAULTS: MailConfigStored = {
	mode: "off",
	from: DEFAULT_FROM,
	notifyTo: "",
	smtp: { host: "", port: 465, security: "ssl", user: "" },
};

function normalizeSecurity(value: unknown): SmtpSecurity {
	return value === "starttls" || value === "none" ? value : "ssl";
}

function normalizePort(value: unknown, security: SmtpSecurity): number {
	const port = Number(value);
	if (Number.isInteger(port) && port > 0 && port < 65536) return port;
	return security === "starttls" ? 587 : 465;
}

function normalizeMode(value: unknown): MailMode | null {
	return value === "off" || value === "resend" || value === "smtp"
		? value
		: null;
}

/** 管理端读：不含任何密钥，只有「配没配」由 secretStatus 那边回答 */
export async function readMailSettings(
	db: D1Database,
): Promise<MailConfigStored> {
	const stored = await readSetting<Partial<MailConfigStored>>(
		db,
		MAIL_CONFIG_KEY,
	);
	if (!stored) return structuredClone(MAIL_DEFAULTS);
	const security = normalizeSecurity(stored.smtp?.security);
	return {
		mode: normalizeMode(stored.mode) ?? "off",
		from: (stored.from ?? "").trim() || DEFAULT_FROM,
		notifyTo: (stored.notifyTo ?? "").trim(),
		smtp: {
			host: (stored.smtp?.host ?? "").trim(),
			port: normalizePort(stored.smtp?.port, security),
			security,
			user: (stored.smtp?.user ?? "").trim(),
		},
	};
}

/** 写入口收的是「用户填的原样」，类型放宽，规范化在下面统一做 */
export interface MailConfigPatch {
	mode?: string;
	from?: string;
	notifyTo?: string;
	smtp?: {
		host?: string;
		port?: number | string;
		security?: string;
		user?: string;
	};
}

export async function writeMailSettings(
	db: D1Database,
	patch: MailConfigPatch,
	actorUid: number | null,
): Promise<MailConfigStored> {
	const current = await readMailSettings(db);
	const security = normalizeSecurity(
		patch.smtp?.security ?? current.smtp.security,
	);
	const next: MailConfigStored = {
		mode: normalizeMode(patch.mode) ?? current.mode,
		from: (patch.from ?? current.from).trim() || DEFAULT_FROM,
		notifyTo: (patch.notifyTo ?? current.notifyTo).trim(),
		smtp: {
			host: (patch.smtp?.host ?? current.smtp.host).trim(),
			port: normalizePort(patch.smtp?.port ?? current.smtp.port, security),
			security,
			user: (patch.smtp?.user ?? current.smtp.user).trim(),
		},
	};
	await writeSetting(db, MAIL_CONFIG_KEY, next, actorUid);
	return next;
}

export interface MailSettingsView {
	config: MailConfigStored;
	/** db = 管理端配过；env = 只有环境变量，界面上要提示一句 */
	source: "db" | "env";
}

/**
 * 管理端看的视图：没在管理端配过时，把环境变量里那套「折算」成表单值返回。
 * 否则界面显示「关闭」，实际却按 env 里的 Resend 在发信，对不上。
 */
export async function mailSettingsView(env: Env): Promise<MailSettingsView> {
	const stored = await readSetting<Partial<MailConfigStored>>(
		env.DB,
		MAIL_CONFIG_KEY,
	);
	if (stored) {
		return { config: await readMailSettings(env.DB), source: "db" };
	}
	const runtime = await resolveMailConfig(env);
	return {
		config: {
			mode: runtime.mode,
			from: runtime.from,
			// env 里没有这一项，界面留空 = 走「所有管理员账号」的兜底
			notifyTo: "",
			smtp: {
				host: runtime.smtp.host,
				port: runtime.smtp.port,
				security: runtime.smtp.security,
				user: runtime.smtp.user,
			},
		},
		source: runtime.source,
	};
}

/**
 * 运行时解析：settings 里存过就用存的，否则按 env 推断。
 * 返回的 smtp.pass / resendKey 已解密，调用方用完即弃，不要塞进日志。
 */
export async function resolveMailConfig(env: Env): Promise<MailConfig> {
	const rootKey = env.PASSWORD_ENC_KEY ?? "";
	const dbSecrets = rootKey
		? {
				resendKey: (await readSecret(env.DB, rootKey, "resend_api_key")) ?? "",
				smtpPass: (await readSecret(env.DB, rootKey, "smtp_pass")) ?? "",
			}
		: { resendKey: "", smtpPass: "" };

	const resendKey = dbSecrets.resendKey || env.RESEND_API_KEY || "";
	const smtpPass = dbSecrets.smtpPass || env.SMTP_PASS || "";
	const stored = await readSetting<Partial<MailConfigStored>>(
		env.DB,
		MAIL_CONFIG_KEY,
	);

	if (stored) {
		const base = await readMailSettings(env.DB);
		const mode =
			base.mode === "resend" && !resendKey
				? base.smtp.host
					? "smtp"
					: "off"
				: base.mode === "smtp" && !base.smtp.host
					? resendKey
						? "resend"
						: "off"
					: base.mode;
		return {
			...base,
			mode,
			resendKey,
			smtp: { ...base.smtp, pass: smtpPass },
			source: "db",
		};
	}

	// 没在管理端配过：按环境变量推断，兼容升级前只配了 Resend 的部署
	const envHost = env.SMTP_HOST ?? "";
	const envSecurity = normalizeSecurity(env.SMTP_SECURE);
	const mode: MailMode = envHost ? "smtp" : resendKey ? "resend" : "off";
	return {
		mode,
		from: (env.MAIL_FROM || DEFAULT_FROM).trim(),
		notifyTo: "",
		resendKey,
		smtp: {
			host: envHost,
			port: normalizePort(env.SMTP_PORT, envSecurity),
			security: envSecurity,
			user: (env.SMTP_USER ?? "").trim(),
			pass: smtpPass,
		},
		source: "env",
	};
}
