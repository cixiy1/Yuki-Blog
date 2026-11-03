/**
 * 深合并配置对象的补丁层。
 *
 * 用途：管理端把改动写成 JSON，这里把它铺到代码里的默认值上。
 * 规则刻意保守：
 *  - 只合并 patch 里真实存在的键，undefined 一律忽略（不能把默认值抹成 undefined）
 *  - 数组整体替换，不做按索引合并（否则删一个元素会变成「删不掉」）
 *  - 只递归普通对象；null 视为「显式置空」，直接覆盖
 *  - 类型对不上时以 base 为准，避免 JSON 里的脏值带崩构建
 */
export function mergeConfig<T>(base: T, patch: unknown): T {
	if (patch === null) return patch as T;
	if (patch === undefined) return base;
	if (Array.isArray(patch)) return patch as T;
	if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;

	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		out[key] = mergeConfig((base as Record<string, unknown>)[key], value);
	}
	return out as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}
