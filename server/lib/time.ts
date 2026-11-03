/**
 * D1 的时间列用 SQLite 的 `datetime('now')`，格式是 `YYYY-MM-DD HH:MM:SS`（UTC，无 T 无 Z）。
 * 直接丢给前端会被 `new Date()` 当本地时间解析，差 8 小时，所以出参一律转 ISO。
 */

export function utcToIso(sqliteTime: string | null | undefined): string | null {
	if (!sqliteTime) return null;
	return `${sqliteTime.replace(" ", "T")}Z`;
}

export function nowIso(): string {
	return new Date().toISOString();
}

export function unixSeconds(): number {
	return Math.floor(Date.now() / 1000);
}
