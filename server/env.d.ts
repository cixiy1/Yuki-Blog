/**
 * Worker 运行时绑定声明。
 *
 * 这里只声明 P1 用到的接口，不引 @cloudflare/workers-types：
 * 那个包会向全局注入一套与 DOM 冲突的类型，而 Astro 的 tsconfig 已经带了 DOM。
 * 等 P3 起需要更完整的 D1 API 时，再评估换用 `wrangler types` 生成。
 */

interface D1Result<T = Record<string, unknown>> {
	results?: T[];
	success: boolean;
	meta?: Record<string, unknown>;
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
}
