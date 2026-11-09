import type { QRCodeToDataURLOptions } from "qrcode";

/**
 * 全站二维码的统一外观：纯黑码、白底、四周留一个模块的白边。
 * 文章分享海报与页面二维码都走这里，避免两处参数各改各的、扫出来深浅不一。
 */
export const QR_CODE_STYLE: QRCodeToDataURLOptions = {
	errorCorrectionLevel: "M",
	margin: 1,
	color: { dark: "#000000", light: "#ffffff" },
};

/** 生成二维码 data URL。width 只决定清晰度，图案本身不变 */
export async function toQrDataUrl(
	text: string,
	width: number,
): Promise<string> {
	// 按需加载 qrcode，只有真正需要二维码时才付出这部分体积
	const { default: QRCode } = await import("qrcode");
	return QRCode.toDataURL(text, { ...QR_CODE_STYLE, width });
}
