import {
	base64UrlToBytes,
	bytesToBase64Url,
	hexToBytes,
	toArrayBuffer,
} from "./crypto";

/**
 * 密码「可逆加密」存储。
 *
 * ⚠️ 这是产品决策，不是安全最佳实践：只要拿到密钥就能还原全部明文密码。
 * 完整的风险说明见 docs/user-system/design.md「密码存储的风险与缓解」。
 * 这里只负责把方案实现得尽量少留坑：
 *  - HKDF-SHA256 派生 AES-256-GCM 密钥，salt/info 做域分隔（与 SESSION_SECRET 不同链）
 *  - 信封带版本前缀 v1，将来换算法可以按前缀分派
 *  - AAD 绑 uid：把 A 行的密文搬到 B 行，解密直接失败
 *  - 密钥轮换：PASSWORD_ENC_KEY_PREV 解密成功后惰性用新密钥重写
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_SALT = "yb-password-enc";
const KEY_INFO = "aes-256-gcm:v1";

export interface PasswordKeys {
	/** 当前密钥，hex(32 字节) */
	current: string;
	/** 上一把密钥，仅用于惰性重加密，可缺省 */
	previous?: string;
}

export type PasswordVerdict = "match" | "needs_reencrypt" | "mismatch";

interface KeyCache {
	secret: string;
	key: CryptoKey;
}

// 模块级缓存：同一 isolate 内复用，省掉每次 login 一次 importKey。
// secret 变了字符串比对就能发现，不需要失效回调。
let cache: KeyCache | null = null;

async function deriveKey(secret: string): Promise<CryptoKey | null> {
	if (cache && cache.secret === secret) return cache.key;
	const raw = hexToBytes(secret);
	if (raw?.byteLength !== 32) return null;
	const base = await crypto.subtle.importKey(
		"raw",
		toArrayBuffer(raw),
		"HKDF",
		false,
		["deriveKey"],
	);
	const key = await crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: encoder.encode(KEY_SALT),
			info: encoder.encode(KEY_INFO),
		},
		base,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
	cache = { secret, key };
	return key;
}

function aadFor(uid: number): ArrayBuffer {
	return toArrayBuffer(encoder.encode(`yb-pw:${VERSION}:${uid}`));
}

/** 加密；密钥未配置或格式不对返回 null，由调用方转 500 server_misconfigured */
export async function encryptPassword(
	secret: string,
	uid: number,
	plain: string,
): Promise<string | null> {
	const key = await deriveKey(secret);
	if (!key) return null;

	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const cipher = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: toArrayBuffer(iv),
			additionalData: aadFor(uid),
			tagLength: 128,
		},
		key,
		toArrayBuffer(encoder.encode(plain.normalize("NFC"))),
	);

	return `${VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptPassword(
	secret: string,
	uid: number,
	envelope: string,
): Promise<string | null> {
	const parts = envelope.split(".");
	if (parts.length !== 3 || parts[0] !== VERSION) return null;

	const key = await deriveKey(secret);
	if (!key) return null;

	const iv = base64UrlToBytes(parts[1]);
	const data = base64UrlToBytes(parts[2]);
	if (!iv || iv.byteLength !== IV_BYTES || !data) return null;

	try {
		const plain = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: toArrayBuffer(iv),
				additionalData: aadFor(uid),
				tagLength: 128,
			},
			key,
			toArrayBuffer(data),
		);
		return decoder.decode(plain);
	} catch {
		// 密钥不对、AAD 不匹配、密文被改，一律返回 null
		return null;
	}
}

/**
 * 校验密码。
 * - "needs_reencrypt"：用上一把密钥解出来了，调用方应当用当前密钥重写该行
 * - 没有密文（纯 OAuth 账号）也算 "mismatch"，调用方统一回 401
 */
export async function verifyPassword(
	keys: PasswordKeys,
	uid: number,
	envelope: string | null,
	given: string,
): Promise<PasswordVerdict> {
	if (!envelope) return "mismatch";

	const plain = await decryptPassword(keys.current, uid, envelope);
	if (plain !== null)
		return plain === given.normalize("NFC") ? "match" : "mismatch";

	if (keys.previous) {
		const older = await decryptPassword(keys.previous, uid, envelope);
		if (older !== null) {
			return older === given.normalize("NFC") ? "needs_reencrypt" : "mismatch";
		}
	}
	return "mismatch";
}
