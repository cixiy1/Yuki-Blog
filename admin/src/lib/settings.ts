import { api } from "./api";

export interface ConfigVersion {
	id: number;
	note: string | null;
	commit_sha: string | null;
	published_by: number | null;
	published_at: string;
	size: number;
}

export interface SettingsPayload {
	draft: Record<string, unknown>;
	published: Record<string, unknown>;
	/** 最近一次真正写进仓库的快照；从没发布过时为 null */
	repo: Record<string, unknown> | null;
	dirty: boolean;
	versions: ConfigVersion[];
	hasGithubToken: boolean;
}

export interface SecretStatus {
	name: string;
	configured: boolean;
	hint: string | null;
}

/** 内部 api 出错会抛 ApiError（带 status 与 code），调用方只管 catch */
export const loadSettings = (): Promise<SettingsPayload> =>
	api.get<SettingsPayload>("/api/admin/site-config");

export const saveDraft = (config: Record<string, unknown>): Promise<unknown> =>
	api.put("/api/admin/site-config", { config });

export const publishDraft = (note: string): Promise<PublishResult> =>
	api.post<PublishResult>("/api/admin/site-config/publish", { note });

/** 只把热字段盖到已发布内容上，不写仓库、不等构建 */
export const applyHot = (): Promise<{ ok?: boolean; message?: string }> =>
	api.post<{ ok?: boolean; message?: string }>(
		"/api/admin/site-config/apply",
		{},
	);

export interface PublishResult {
	ok?: boolean;
	commit_sha?: string | null;
	message?: string;
}

export const rollbackTo = (
	id: number,
): Promise<{ ok?: boolean; draft?: Record<string, unknown> }> =>
	api.post("/api/admin/site-config/rollback", { id });

export const loadSecrets = async (): Promise<SecretStatus[]> => {
	const data = await api.get<{ secrets: SecretStatus[] }>("/api/admin/secrets");
	return data.secrets ?? [];
};

export const saveSecret = async (
	name: string,
	value: string,
): Promise<SecretStatus[]> => {
	const data = await api.put<{ secrets?: SecretStatus[] }>(
		"/api/admin/secrets",
		{ name, value },
	);
	return data.secrets ?? [];
};

/* ---------------- 发信配置（非密字段走 settings，密钥走密钥库） ---------------- */

export type MailMode = "off" | "resend" | "smtp";
export type SmtpSecurity = "ssl" | "starttls" | "none";

export interface MailConfig {
	mode: MailMode;
	from: string;
	/** 管理员邮箱：待审、撤回等提醒的收件人，可多个；留空 = 所有管理员与审核员账号 */
	adminEmails: string[];
	smtp: {
		host: string;
		port: number;
		security: SmtpSecurity;
		user: string;
	};
}

export interface MailTestResult {
	ok: boolean;
	sent: boolean;
	mode: MailMode;
	to: string;
	from: string;
	message: string | null;
}

export interface MailConfigView {
	config: MailConfig;
	/** db = 管理端配过；env = 认的是 Worker 环境变量 */
	source: "db" | "env";
}

export const loadMailConfig = (): Promise<MailConfigView> =>
	api.get<MailConfigView>("/api/admin/mail-config");

export const saveMailConfig = async (
	config: MailConfig,
): Promise<MailConfig> => {
	const data = await api.put<{ config: MailConfig }>("/api/admin/mail-config", {
		config,
	});
	return data.config;
};

export const testMail = (to?: string): Promise<MailTestResult> =>
	api.post<MailTestResult>("/api/admin/mail-test", to ? { to } : {});
