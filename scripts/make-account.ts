/**
 * 建号 / 重置密码：只产出可执行的 SQL，不连库。
 *
 * 为什么要这个脚本：站主账号这类号不能走公开注册（`yukiho` 在
 * `RESERVED_ACCOUNTS` 里），而密码是 AES-256-GCM 加密存的，不能直接写明文。
 * 这里复用 `server/lib/password.ts` 的真实实现生成密文，保证与 Worker 端一致。
 *
 * 用法：
 *   # 建号
 *   npx tsx scripts/make-account.ts --account yukiho --email you@example.com \
 *     --password 'xxx' --role admin --name 雪穗 > /tmp/user.sql
 *   npx wrangler d1 execute yuki-blog --local --file=/tmp/user.sql
 *
 *   # 重置密码（必须给 --uid：密文的 AAD 绑的就是 uid）
 *   npx tsx scripts/make-account.ts --reset --account yukiho --uid 123456 \
 *     --password '新密码' > /tmp/reset.sql
 *
 * 注意事项：
 * - 密文与运行环境里的 PASSWORD_ENC_KEY 绑死，换一把钥匙就得重新生成；
 *   线上要用线上的 key 重跑，不能把本地密文搬过去。
 * - 密码只从命令行进，不写文件、不打日志，仓库里不应出现任何密码。
 * - 重置模式会顺带 `session_epoch + 1`，该账号已签发的 cookie 立刻失效。
 */
import { readFileSync } from "node:fs";
import { encryptPassword } from "../server/lib/password";
import { randomUid } from "../server/lib/users";

const ROLES = new Set(["user", "reviewer", "admin"]);

interface Args {
	account: string;
	password: string;
	email: string;
	role: string;
	name: string;
	uid?: number;
	reset: boolean;
}

function parseArgs(argv: string[]): Args {
	const map = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 1) {
		const key = argv[i];
		if (!key.startsWith("--")) continue;
		const next = argv[i + 1];
		if (next === undefined || next.startsWith("--")) {
			map.set(key.slice(2), "1");
		} else {
			map.set(key.slice(2), next);
			i += 1;
		}
	}

	const account = (map.get("account") ?? "").trim().toLowerCase();
	const password = map.get("password") ?? "";
	const reset = map.get("reset") === "1";
	if (!account) fail("缺少 --account");
	if (!password) fail("缺少 --password");
	if (!/^[a-z0-9][a-z0-9_]{2,19}$/.test(account)) {
		fail("--account 只能是 3–20 位小写字母、数字、下划线");
	}

	const role = map.get("role") ?? "user";
	if (!ROLES.has(role)) fail(`--role 只能是 ${[...ROLES].join(" / ")}`);

	const email = (map.get("email") ?? "").trim().toLowerCase();
	if (!reset && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		fail("缺少或非法的 --email（重置模式可省）");
	}

	const uidRaw = map.get("uid");
	const uid = uidRaw ? Number.parseInt(uidRaw, 10) : undefined;
	if (uidRaw && (!Number.isInteger(uid) || (uid ?? 0) <= 0)) {
		fail("--uid 必须是正整数");
	}
	if (reset && !uid) fail("重置模式必须给 --uid（密文的 AAD 绑的就是它）");

	return {
		account,
		password,
		email,
		role,
		name: (map.get("name") ?? account).trim() || account,
		uid,
		reset,
	};
}

function fail(message: string): never {
	console.error(`✗ ${message}`);
	process.exit(1);
}

/** .dev.vars 只按第一个 = 切；值里可能含 =，不能整行 split */
function readDevVars(): Record<string, string> {
	let raw = "";
	try {
		raw = readFileSync(".dev.vars", "utf8");
	} catch {
		fail("找不到 .dev.vars（需要里面的 PASSWORD_ENC_KEY）");
	}
	const env: Record<string, string> = {};
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const at = trimmed.indexOf("=");
		if (at <= 0) continue;
		env[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
	}
	return env;
}

/** SQL 字符串字面量：单引号翻倍 */
function q(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

const args = parseArgs(process.argv.slice(2));
const key = readDevVars().PASSWORD_ENC_KEY ?? "";
if (!key) fail(".dev.vars 里没有 PASSWORD_ENC_KEY");

const uid = args.uid ?? randomUid();
const enc = await encryptPassword(key, uid, args.password);
if (!enc) fail("PASSWORD_ENC_KEY 格式不对（应为 hex 32 字节）");

if (args.reset) {
	console.log(
		[
			"UPDATE users",
			`   SET password_enc = ${q(enc)},`,
			"       password_updated_at = datetime('now'),",
			"       session_epoch = session_epoch + 1",
			` WHERE account = ${q(args.account)} AND uid = ${uid};`,
		].join("\n"),
	);
	console.error(
		`✓ 重置语句已生成：${args.account} (uid ${uid})，密文 ${enc.length} 字符`,
	);
} else {
	console.log(
		[
			"INSERT INTO users (uid, account, email, email_verified_at, role, status, display_name, password_enc, password_updated_at)",
			`VALUES (${uid}, ${q(args.account)}, ${q(args.email)}, datetime('now'), ${q(args.role)}, 'active', ${q(args.name)}, ${q(enc)}, datetime('now'));`,
		].join("\n"),
	);
	console.error(
		`✓ 建号语句已生成：${args.account} / ${args.email} / ${args.role} / uid ${uid} / 密文 ${enc.length} 字符`,
	);
}
