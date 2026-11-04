/**
 * 上传前先在浏览器里压一道：长边超过 1800px 或体积超标的图重新编码成 webp。
 * 浏览器不支持 webp 编码时（Safari 的 canvas）退回 PNG，mime 跟着实际字节走。
 * 服务端单张上限 900KB（D1 单行 1MB），手机截图直接传基本都会超。
 */
const MAX_EDGE = 1800;
const PASS_BYTES = 420_000;
const TARGET_BYTES = 820_000;

export interface PreparedImage {
	data: string;
	mime: string;
	bytes: number;
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? "");
			const comma = result.indexOf(",");
			resolve(comma >= 0 ? result.slice(comma + 1) : "");
		};
		reader.onerror = () => reject(new Error("读取文件失败"));
		reader.readAsDataURL(blob);
	});
}

function canvasToBlob(
	canvas: HTMLCanvasElement,
	mime: string,
	quality: number,
): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), mime, quality);
	});
}

/**
 * 编码结果按 blob 自报的类型算，不能写死 webp。
 * Safari 的 canvas 不支持 webp 编码，`toBlob(…, "image/webp")` 会静默退回 PNG，
 * 写死 mime 就会把 PNG 的字节存成 `.webp` 的名字，浏览器按 webp 解不出来。
 */
function blobMime(blob: Blob): string {
	const type = (blob.type || "").toLowerCase();
	return type.startsWith("image/") ? type : "image/webp";
}

/** PNG 是无损的，quality 参数不起作用，降质循环对它只是白跑几遍 */
function isLossy(mime: string): boolean {
	return mime !== "image/png";
}

async function reencode(
	file: File,
	maxEdge: number,
	quality: number,
): Promise<Blob | null> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		bitmap.close();
		return null;
	}
	ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();

	let qualityNow = quality;
	let blob = await canvasToBlob(canvas, "image/webp", qualityNow);
	// 编不出 webp 的浏览器会给 PNG，而 PNG 不认 quality——超过目标只能换 JPEG，
	// 否则大截图永远压不下来，只剩「请手动缩小后再传」一条路。
	if (blob && blobMime(blob) === "image/png" && blob.size > TARGET_BYTES) {
		const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.82);
		if (jpeg && jpeg.size < blob.size) blob = jpeg;
	}
	// 逐级降质，直到进 820KB；再不行就缩边
	while (
		blob &&
		isLossy(blobMime(blob)) &&
		blob.size > TARGET_BYTES &&
		qualityNow > 0.55
	) {
		qualityNow -= 0.1;
		blob = await canvasToBlob(canvas, blobMime(blob), qualityNow);
	}
	return blob;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
	// 小图直接用原文件，避免二次编码掉细节
	if (file.size <= PASS_BYTES) {
		return {
			data: await blobToBase64(file),
			mime: file.type || "application/octet-stream",
			bytes: file.size,
		};
	}

	if (file.type === "image/gif") {
		// 动图重新编码会掉帧，只能原样传，体积自己控制
		throw new Error("GIF 不能压缩，请控制在 400KB 以内或换 webp");
	}

	const blob = await reencode(file, MAX_EDGE, 0.86);
	if (!blob) throw new Error("这张图无法在浏览器里压缩，请换一张");

	if (blob.size > TARGET_BYTES) {
		const smaller = await reencode(file, Math.round(MAX_EDGE * 0.7), 0.8);
		if (!smaller || smaller.size > TARGET_BYTES) {
			throw new Error("压缩后仍然太大，请手动缩小后再传");
		}
		return {
			data: await blobToBase64(smaller),
			mime: blobMime(smaller),
			bytes: smaller.size,
		};
	}

	return {
		data: await blobToBase64(blob),
		mime: blobMime(blob),
		bytes: blob.size,
	};
}
