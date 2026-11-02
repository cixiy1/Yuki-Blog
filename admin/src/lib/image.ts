/**
 * 上传前先在浏览器里压一道：长边超过 1800px 或体积超标的图重新编码成 webp。
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
	quality: number,
): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), "image/webp", quality);
	});
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
	let blob = await canvasToBlob(canvas, qualityNow);
	// 逐级降质，直到进 820KB；再不行就缩边
	while (blob && blob.size > TARGET_BYTES && qualityNow > 0.55) {
		qualityNow -= 0.1;
		blob = await canvasToBlob(canvas, qualityNow);
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
			mime: "image/webp",
			bytes: smaller.size,
		};
	}

	return {
		data: await blobToBase64(blob),
		mime: "image/webp",
		bytes: blob.size,
	};
}
