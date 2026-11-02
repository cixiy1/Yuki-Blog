const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const byte of bytes) {
		out += byte.toString(16).padStart(2, "0");
	}
	return out;
}

export async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
	return bytesToHex(new Uint8Array(digest));
}

/** 对二进制求摘要，用于媒体去重 */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
	// crypto.subtle 只收 ArrayBuffer 视图；拷一份保证底层是 ArrayBuffer 而不是 SharedArrayBuffer
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
	return bytesToHex(new Uint8Array(digest));
}

/** 标准 base64（不含 url 安全替换）→ 字节；非法字符返回 null */
export function decodeBase64(value: string): Uint8Array | null {
	if (value.length === 0 || value.length % 4 !== 0) return null;
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
	try {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	} catch {
		return null;
	}
}

export async function hmacSha256Hex(
	key: string,
	input: string,
): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		encoder.encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		cryptoKey,
		encoder.encode(input),
	);
	return bytesToHex(new Uint8Array(signature));
}

/** 32 字节 CSPRNG 转 64 位小写 hex，用作会话 token */
export function randomToken(bytes = 32): string {
	return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * 生成 count 位十进制数字串，允许前导零。
 * 用拒绝采样：字节 >= 250 时丢弃重取，避免 256 % 10 的模偏差。
 */
export function randomDigits(count: number): string {
	let out = "";
	while (out.length < count) {
		const buffer = crypto.getRandomValues(new Uint8Array(count));
		for (const byte of buffer) {
			if (byte < 250 && out.length < count) {
				out += (byte % 10).toString();
			}
		}
	}
	return out;
}

/** 常量时间比较两个 hex 串，长度不同直接 false */
export function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

export function toBase64Url(text: string): string {
	const bytes = encoder.encode(text);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	const base64 = btoa(binary);
	let out = "";
	for (const char of base64) {
		if (char === "+") out += "-";
		else if (char === "/") out += "_";
		else if (char !== "=") out += char;
	}
	return out;
}

export function fromBase64Url(value: string): string {
	let base64 = "";
	for (const char of value) {
		if (char === "-") base64 += "+";
		else if (char === "_") base64 += "/";
		else base64 += char;
	}
	while (base64.length % 4 !== 0) base64 += "=";
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new TextDecoder().decode(bytes);
}
