/**
 * Worker 运行时绑定声明。
 *
 * 这里只声明用得到的接口，不引 @cloudflare/workers-types：
 * 那个包会向全局注入一套与 DOM 冲突的类型，而 Astro 的 tsconfig 已经带了 DOM。
 */

interface D1Meta {
	changes?: number;
	last_row_id?: number;
	rows_read?: number;
	rows_written?: number;
	duration?: number;
}

interface D1Result<T = Record<string, unknown>> {
	results?: T[];
	success: boolean;
	meta?: D1Meta;
	error?: string;
}

interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
	run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
	prepare(query: string): D1PreparedStatement;
	batch<T = Record<string, unknown>>(
		statements: D1PreparedStatement[],
	): Promise<D1Result<T>[]>;
	exec(query: string): Promise<{ count: number; duration: number }>;
}

interface AssetsFetcher {
	fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

interface Env {
	DB: D1Database;
	ASSETS: AssetsFetcher;

	/** 验证码与 IP 哈希的机密盐，缺失时认证接口一律 500 */
	AUTH_PEPPER?: string;
	/** Resend API key，缺失时只打 console 不发信 */
	RESEND_API_KEY?: string;
	/** 发件人，形如 `Yuki Blog <mail@yiyu14.top>` */
	MAIL_FROM?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	/** 仅本地 .dev.vars 设 "1"，生产不配这个键 */
	AUTH_DEBUG?: string;
}
