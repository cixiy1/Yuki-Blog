import type { SponsorConfig } from "../types/sponsorConfig";
import { applyNamespace } from "./site-overrides";

/** 默认值；管理端发布后由 site.json 的 `sponsor` 分区覆盖 */
const sponsorConfigBase: SponsorConfig = {
	title: "",
	description: "",
	usage:
		"您的打赏将用于服务器维护、内容创作和功能开发，帮助我持续提供优质内容。",
	showSponsorsList: true,
	showComment: true,
	showButtonInPost: true,
	methods: [
		{
			name: "微信",
			icon: "fa7-brands:weixin",
			qrCode: "/assets/images/sponsor/wechat.png",
			link: "",
			description: "使用 微信 扫码打赏",
			enabled: true,
		},
	],
	sponsors: [
		{
			name: "Crescent.ice",
			avatar: "/assets/images/sponsor/crescent-ice.jpg",
		},
		{
			name: "苏志锦（校友）",
			avatar: "/assets/images/sponsor/suzhijin.jpg",
		},
	],
};

export const sponsorConfig: SponsorConfig = applyNamespace(
	"sponsor",
	sponsorConfigBase,
);
