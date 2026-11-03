/**
 * 固定窗口限流，计数器存在 D1 的 rate_limits 表。
 *
 * 为什么不用内存 Map：Worker 的 isolate 随时回收、跨 colo 不共享，
 * 进程内计数等于没限流（参考实现就是这么写的，只在单实例下有效）。
 * D1 里单条 UPSERT 是原子的，是这里唯一可靠的共享计数器。
 *
 * 已知偏差：固定窗口在边界处最多允许 2 倍突发；每次调用多一次 D1 写。
 */
export interface RateDecision {
	allowed: boolean;
	/** 命中上限时还要等多少秒 */
	retryAfter: number;
	/** 当前窗口已计数值 */
	count: number;
}

const CLEAN_PROBABILITY = 0.02;

export async function consumeRate(
	db: D1Database,
	bucket: string,
	subject: string,
	limit: number,
	windowSeconds: number,
	nowSeconds: number,
): Promise<RateDecision> {
	const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
	const retryAfter = windowStart + windowSeconds - nowSeconds;

	const row = await db
		.prepare(
			`INSERT INTO rate_limits (bucket, subject, window_start, count)
			 VALUES (?1, ?2, ?3, 1)
			 ON CONFLICT (bucket, subject, window_start)
			 DO UPDATE SET count = rate_limits.count + 1
			 RETURNING count`,
		)
		.bind(bucket, subject, windowStart)
		.first<{ count: number }>();

	// 顺手清掉一天前的窗口，避免表无限长；不做定时任务（Worker 没有启动钩子）
	if (Math.random() < CLEAN_PROBABILITY) {
		await db
			.prepare("DELETE FROM rate_limits WHERE window_start < ?1")
			.bind(windowStart - 86400)
			.run()
			.catch(() => undefined);
	}

	// 查询失败时放行：限流器自身故障不该把所有人挡在门外
	if (!row) return { allowed: true, retryAfter: 0, count: 0 };

	return {
		allowed: row.count <= limit,
		retryAfter: row.count <= limit ? 0 : retryAfter,
		count: row.count,
	};
}

/** 登录成功后清掉该主体的失败计数，别让正常用户被自己之前的失败拖累 */
export async function resetRate(
	db: D1Database,
	bucket: string,
	subject: string,
	windowSeconds: number,
	nowSeconds: number,
): Promise<void> {
	const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
	await db
		.prepare(
			"DELETE FROM rate_limits WHERE bucket = ?1 AND subject = ?2 AND window_start = ?3",
		)
		.bind(bucket, subject, windowStart)
		.run()
		.catch(() => undefined);
}
