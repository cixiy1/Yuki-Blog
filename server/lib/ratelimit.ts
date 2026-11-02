export interface QuotaDecision {
	allowed: boolean;
	scope?: string;
	retryAfter?: number;
}

interface QuotaCounts {
	email_60s: number;
	email_10m: number;
	email_1d: number;
	ip_1h: number;
	ip_1d: number;
}

/**
 * 用 email_codes 自身计数，不另建限流表：每次发码必然写一行，
 * 计数与真实发送同源，不会出现两张表对不上的情况。
 * 两个复合索引 (email, purpose, created_at) 与 (ip_hash, created_at) 都覆盖得到。
 *
 * 已知偏差：COUNT 与 INSERT 之间没有锁，并发请求可能同时通过，
 * 实际发出量约等于阈值 + 并发数。60 秒冷却把窗口压得很窄，可接受。
 */
export async function checkSendQuota(
	db: D1Database,
	email: string,
	ipHash: string,
): Promise<QuotaDecision> {
	const counts = await db
		.prepare(
			`SELECT
			   (SELECT COUNT(*) FROM email_codes
			     WHERE email = ?1 AND purpose = 'login'
			       AND created_at > datetime('now', '-60 seconds')) AS email_60s,
			   (SELECT COUNT(*) FROM email_codes
			     WHERE email = ?1 AND purpose = 'login'
			       AND created_at > datetime('now', '-10 minutes')) AS email_10m,
			   (SELECT COUNT(*) FROM email_codes
			     WHERE email = ?1 AND purpose = 'login'
			       AND created_at > datetime('now', '-1 day')) AS email_1d,
			   (SELECT COUNT(*) FROM email_codes
			     WHERE ip_hash = ?2
			       AND created_at > datetime('now', '-1 hour')) AS ip_1h,
			   (SELECT COUNT(*) FROM email_codes
			     WHERE ip_hash = ?2
			       AND created_at > datetime('now', '-1 day')) AS ip_1d`,
		)
		.bind(email, ipHash)
		.first<QuotaCounts>();

	if (!counts) {
		// 查询本身失败时放行，由 Resend 额度兜底；不要因为限流器挂了导致没人能登录。
		return { allowed: true };
	}

	if (counts.email_60s >= 1) {
		return { allowed: false, scope: "email_cooldown", retryAfter: 60 };
	}
	if (counts.email_10m >= 3) {
		return { allowed: false, scope: "email_10m", retryAfter: 300 };
	}
	if (counts.email_1d >= 10) {
		return { allowed: false, scope: "email_1d", retryAfter: 3600 };
	}
	if (counts.ip_1h >= 20) {
		return { allowed: false, scope: "ip_1h", retryAfter: 600 };
	}
	if (counts.ip_1d >= 60) {
		return { allowed: false, scope: "ip_1d", retryAfter: 3600 };
	}
	return { allowed: true };
}
