import { siteConfig } from "@/config";
import iconsData from "@/constants/icons-data.json";
import { toQrDataUrl } from "@/utils/qr-code";
import { url as withBase } from "@/utils/url-utils";

/**
 * 分享卡片的版式：站点头（Logo + 右上角小字）、标题、描述、作者、二维码。
 * 文章「分享海报」和页面二维码名片都走这一份，保证两边长得一样。
 */
export interface ShareCardOptions {
	title: string;
	/** 右上角小字：文章用日期，页面用域名 */
	meta: string;
	description: string;
	author: string;
	/** 作者上方的小标签，如「作者」 */
	authorLabel: string;
	siteTitle: string;
	themeColor: string;
	/** 二维码内容 */
	qrText: string;
	/** 二维码下方说明，如「扫码阅读文章」 */
	qrCaption: string;
	logo: string | null;
	avatar: string | null;
	cover: string | null;
}

const SCALE = 2;
const CARD_WIDTH = 425 * SCALE;
const PADDING = 24 * SCALE;
const HEADER_TEXT_COLOR = "#1f2937";

export function loadCanvasImage(src: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => {
			if (!src.includes("images.weserv.nl")) {
				const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(src)}&output=png`;
				const proxyImg = new Image();
				proxyImg.crossOrigin = "anonymous";
				proxyImg.onload = () => resolve(proxyImg);
				proxyImg.onerror = () => {
					resolve(null);
				};
				proxyImg.src = proxyUrl;
			} else {
				resolve(null);
			}
		};
		img.src = src;
	});
}

/** 优先用页面里已渲染的图片地址（Astro 优化过的），拿不到再退回配置里的原始地址 */
export function resolveElementImage(
	src: string | null,
	selector: string | null,
): string | null {
	if (!selector) return src;
	const image = document.querySelector<HTMLImageElement>(selector);
	return image?.currentSrc || image?.src || src;
}

function serializeNavbarIcon(color: string, size: number): string | null {
	const svg = document.querySelector<SVGSVGElement>("#navbar svg.navbar-logo");
	if (!svg) return null;

	const clone = svg.cloneNode(true) as SVGSVGElement;
	clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	// 导航栏图标宽高是 1em，脱离文档后需要显式尺寸才能被 canvas 光栅化
	clone.setAttribute("width", String(size));
	clone.setAttribute("height", String(size));
	clone.removeAttribute("class");
	// 让图标内部的 currentColor 解析成卡片里的颜色
	clone.setAttribute("style", `color:${color}`);

	const markup = new XMLSerializer().serializeToString(clone);
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function buildIconDataUrl(icon: string, color: string): string | null {
	const [prefix, name] = icon.split(":");
	if (!prefix || !name) return null;

	const collection = (
		iconsData as Record<
			string,
			{
				icons?: Record<string, { body: string }>;
				width?: number;
				height?: number;
			}
		>
	)[prefix];
	const body = collection?.icons?.[name]?.body;
	if (!body) return null;

	const iconWidth = collection.width ?? 24;
	const iconHeight = collection.height ?? 24;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconWidth}" height="${iconHeight}" viewBox="0 0 ${iconWidth} ${iconHeight}">${body.replaceAll("currentColor", color)}</svg>`;

	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 站点 Logo：优先复用导航栏已渲染的 SVG（astro-icon 覆盖完整图标库），图片复用导航栏已优化的地址 */
export function resolveSiteLogoSource(size: number): string | null {
	const logo = siteConfig.navbar.logo;
	if (!logo?.value) return null;

	if (logo.type === "icon") {
		return (
			serializeNavbarIcon(HEADER_TEXT_COLOR, size) ??
			buildIconDataUrl(logo.value, HEADER_TEXT_COLOR)
		);
	}

	// src 目录下的图片经 Astro 优化后只有导航栏能拿到最终地址
	// 卡片背景是白色，因此固定取亮色版本的 Logo
	const navbarLogo =
		document.querySelector<HTMLImageElement>(
			'#navbar img.navbar-logo[data-logo-theme="light"]',
		) ?? document.querySelector<HTMLImageElement>("#navbar img.navbar-logo");
	const navbarLogoSrc = navbarLogo?.currentSrc || navbarLogo?.src;
	if (navbarLogoSrc) return navbarLogoSrc;

	if (logo.type === "url") return logo.value;
	// public 目录下的图片可直接拼接 base 路径，src 目录下的则无法在客户端还原
	return logo.value.startsWith("/") || logo.value.startsWith("http")
		? withBase(logo.value)
		: null;
}

function getLines(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string[] {
	const chars = text.split("");
	const lines: string[] = [];
	let currentLine = "";

	for (let i = 0; i < chars.length; i++) {
		const char = chars[i];
		const width = ctx.measureText(currentLine + char).width;
		if (width < maxWidth) {
			currentLine += char;
		} else {
			lines.push(currentLine);
			currentLine = char;
		}
	}
	if (currentLine) {
		lines.push(currentLine);
	}
	return lines;
}

function fitText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string {
	if (ctx.measureText(text).width <= maxWidth) return text;

	const ellipsis = "...";
	const fittedChars = Array.from(text);
	while (
		fittedChars.length > 0 &&
		ctx.measureText(`${fittedChars.join("")}${ellipsis}`).width > maxWidth
	) {
		fittedChars.pop();
	}

	return fittedChars.length > 0
		? `${fittedChars.join("")}${ellipsis}`
		: ellipsis;
}

function drawRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
) {
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.lineTo(x + width - radius, y);
	ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
	ctx.lineTo(x + width, y + height - radius);
	ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
	ctx.lineTo(x + radius, y + height);
	ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
	ctx.lineTo(x, y + radius);
	ctx.quadraticCurveTo(x, y, x + radius, y);
	ctx.closePath();
}

/** 渲染一张分享卡片，返回 PNG 的 data URL */
export async function renderShareCard(
	options: ShareCardOptions,
): Promise<string> {
	const {
		title,
		meta,
		description,
		author,
		authorLabel,
		siteTitle,
		themeColor,
		qrText,
		qrCaption,
	} = options;
	const scale = SCALE;
	const width = CARD_WIDTH;
	const padding = PADDING;
	const logoBox = 22 * scale;

	const qrCodeUrl = await toQrDataUrl(qrText, 100 * scale);
	const [qrImg, coverImg, avatarImg, logoImg] = await Promise.all([
		loadCanvasImage(qrCodeUrl),
		options.cover ? loadCanvasImage(options.cover) : Promise.resolve(null),
		options.avatar ? loadCanvasImage(options.avatar) : Promise.resolve(null),
		options.logo ? loadCanvasImage(options.logo) : Promise.resolve(null),
	]);

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas context not available");

	canvas.width = width;
	canvas.height = 1000 * scale;

	// 布局计算
	const contentWidth = width - padding * 2;
	let currentY = 0;

	const coverHeight = (coverImg ? 200 : 64) * scale;
	currentY += coverHeight;
	currentY += padding;

	ctx.font = `700 ${24 * scale}px 'Roboto', sans-serif`;
	const titleLines = getLines(ctx, title, contentWidth);
	const titleLineHeight = 30 * scale;
	currentY += titleLines.length * titleLineHeight;
	currentY += 16 * scale;

	let descHeight = 0;
	if (description) {
		ctx.font = `${14 * scale}px 'Roboto', sans-serif`;
		const descLines = getLines(ctx, description, contentWidth - 16 * scale);
		const displayDescLines = descLines.slice(0, 6);
		const descLineHeight = 25 * scale;
		descHeight = displayDescLines.length * descLineHeight;
		currentY += descHeight;
	} else {
		currentY += 8 * scale;
	}

	currentY += 16 * scale;
	const footerHeight = 80 * scale;
	currentY += footerHeight;
	currentY += 12 * scale;

	canvas.height = currentY;

	// 背景
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// 装饰圆形
	ctx.save();
	ctx.globalAlpha = 0.1;
	ctx.fillStyle = themeColor;
	ctx.beginPath();
	ctx.arc(width - 25 * scale, 25 * scale, 75 * scale, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.arc(10 * scale, canvas.height - 10 * scale, 50 * scale, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	// 封面（没有就铺一条淡色带）
	if (coverImg) {
		const imgRatio = coverImg.width / coverImg.height;
		const targetRatio = width / coverHeight;
		let sx: number;
		let sy: number;
		let sWidth: number;
		let sHeight: number;

		if (imgRatio > targetRatio) {
			sHeight = coverImg.height;
			sWidth = sHeight * targetRatio;
			sx = (coverImg.width - sWidth) / 2;
			sy = 0;
		} else {
			sWidth = coverImg.width;
			sHeight = sWidth / targetRatio;
			sx = 0;
			sy = (coverImg.height - sHeight) / 2;
		}
		ctx.drawImage(coverImg, sx, sy, sWidth, sHeight, 0, 0, width, coverHeight);
	} else {
		ctx.save();
		ctx.fillStyle = themeColor;
		ctx.globalAlpha = 0.2;
		ctx.fillRect(0, 0, width, coverHeight);
		ctx.restore();
	}

	// 顶部站点栏
	const headerHeight = (coverImg ? 44 : 64) * scale;
	const headerCenterY = headerHeight / 2;

	ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
	ctx.fillRect(0, 0, width, headerHeight);

	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "rgba(31, 41, 55, 0.68)";
	ctx.font = `${11 * scale}px 'Roboto', sans-serif`;
	const dateWidth = meta ? ctx.measureText(meta).width : 0;
	if (meta) {
		ctx.fillText(meta, width - padding, headerCenterY);
	}

	ctx.textAlign = "left";
	ctx.fillStyle = HEADER_TEXT_COLOR;
	ctx.font = `700 ${16 * scale}px 'Roboto', sans-serif`;

	const logoGap = 8 * scale;
	let logoW = 0;
	let logoH = 0;
	if (logoImg) {
		const ratio =
			logoImg.width && logoImg.height ? logoImg.width / logoImg.height : 1;
		logoW = ratio >= 1 ? logoBox : logoBox * ratio;
		logoH = ratio >= 1 ? logoBox / ratio : logoBox;
	}
	const siteTitleX = logoImg ? padding + logoW + logoGap : padding;

	const siteTitleText = fitText(
		ctx,
		siteTitle,
		contentWidth -
			(siteTitleX - padding) -
			(dateWidth > 0 ? dateWidth + 16 * scale : 0),
	);

	if (logoImg) {
		// 以标题文字的实际字形高度作为居中基准，避免字体行高导致的视觉错位
		const metrics = ctx.measureText(siteTitleText);
		const ascent = metrics.actualBoundingBoxAscent;
		const descent = metrics.actualBoundingBoxDescent;
		const titleCenterY =
			Number.isFinite(ascent) && Number.isFinite(descent)
				? headerCenterY + (descent - ascent) / 2
				: headerCenterY;
		ctx.drawImage(logoImg, padding, titleCenterY - logoH / 2, logoW, logoH);
	}
	ctx.fillText(siteTitleText, siteTitleX, headerCenterY);

	let drawY = coverHeight + padding;

	// 标题
	ctx.textBaseline = "top";
	ctx.textAlign = "left";
	ctx.font = `700 ${24 * scale}px 'Roboto', sans-serif`;
	ctx.fillStyle = "#111827";
	titleLines.forEach((line) => {
		ctx.fillText(line, padding, drawY);
		drawY += titleLineHeight;
	});
	drawY += 16 * scale - (titleLineHeight - 24 * scale);

	// 描述：左侧竖线 + 正文
	if (description) {
		ctx.fillStyle = "#e5e7eb";
		drawRoundedRect(
			ctx,
			padding,
			drawY - 8 * scale,
			4 * scale,
			descHeight + 8 * scale,
			2 * scale,
		);
		ctx.fill();

		ctx.font = `${14 * scale}px 'Roboto', sans-serif`;
		ctx.fillStyle = "#4b5563";
		const descLines = getLines(ctx, description, contentWidth - 16 * scale);
		descLines.slice(0, 6).forEach((line) => {
			ctx.fillText(line, padding + 16 * scale, drawY);
			drawY += 25 * scale;
		});
	} else {
		drawY += 8 * scale;
	}

	// 分隔线
	drawY += 8 * scale;
	ctx.beginPath();
	ctx.strokeStyle = "#f3f4f6";
	ctx.lineWidth = 1 * scale;
	ctx.moveTo(padding, drawY);
	ctx.lineTo(width - padding, drawY);
	ctx.stroke();
	drawY += 8 * scale;

	// 底部：作者 + 二维码
	const footerY = drawY;
	const qrSize = 64 * scale;
	const qrX = width - padding - qrSize;
	const authorY = footerY + 8 * scale;

	if (avatarImg) {
		ctx.save();
		const avatarSize = 64 * scale;
		const avatarX = padding;

		ctx.beginPath();
		ctx.arc(
			avatarX + avatarSize / 2,
			authorY + avatarSize / 2,
			avatarSize / 2,
			0,
			Math.PI * 2,
		);
		ctx.closePath();
		ctx.clip();
		ctx.drawImage(avatarImg, avatarX, authorY, avatarSize, avatarSize);
		ctx.restore();

		ctx.beginPath();
		ctx.arc(
			avatarX + avatarSize / 2,
			authorY + avatarSize / 2,
			avatarSize / 2,
			0,
			Math.PI * 2,
		);
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 2 * scale;
		ctx.stroke();
	}

	const authorTextX = padding + (avatarImg ? 64 * scale + 16 * scale : 0);
	const authorMaxWidth = qrX - 24 * scale - authorTextX;
	const textCenterY = authorY + 32 * scale;

	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.fillStyle = "#9ca3af";
	ctx.font = `${12 * scale}px 'Roboto', sans-serif`;
	ctx.fillText(authorLabel, authorTextX, textCenterY - 20 * scale);

	ctx.fillStyle = "#1f2937";
	ctx.font = `700 ${20 * scale}px 'Roboto', sans-serif`;
	ctx.fillText(
		fitText(ctx, author, authorMaxWidth),
		authorTextX,
		textCenterY + 4 * scale,
	);

	// 二维码卡片
	ctx.fillStyle = "#ffffff";
	ctx.shadowColor = "rgba(0, 0, 0, 0.05)";
	ctx.shadowBlur = 4 * scale;
	ctx.shadowOffsetY = 2 * scale;
	drawRoundedRect(ctx, qrX, footerY, qrSize, qrSize, 4 * scale);
	ctx.fill();
	ctx.shadowColor = "transparent";

	const qrInnerSize = 56 * scale;
	const qrPadding = (qrSize - qrInnerSize) / 2;
	if (qrImg) {
		ctx.drawImage(
			qrImg,
			qrX + qrPadding,
			footerY + qrPadding,
			qrInnerSize,
			qrInnerSize,
		);
	}

	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.fillStyle = "#9ca3af";
	ctx.font = `${10 * scale}px 'Roboto', sans-serif`;
	ctx.fillText(
		fitText(ctx, qrCaption, qrSize),
		qrX + qrSize / 2,
		footerY + qrSize + 6 * scale,
	);

	return canvas.toDataURL("image/png");
}
