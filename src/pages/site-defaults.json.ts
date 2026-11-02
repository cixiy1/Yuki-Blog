/**
 * 管理端「站点设置」的底座：把「当前生效的配置」按命名空间导出成 JSON。
 *
 * 为什么要这个：草稿只存改过的字段，表单若只渲染草稿，没改过的输入框就是空的，
 * 看起来像配置丢了。管理端拿这份兜底，显示的就永远是「现在线上是什么值」。
 *
 * 这份文件在构建期生成，天然等于构建那一刻的已发布值（各 config 模块已经含覆盖层）。
 * 只导出可配置白名单里的分区，别把整份站点其他内容摊到公网。
 */

import type { APIRoute } from "astro";
import { announcementConfig } from "@/config/announcementConfig";
import { backgroundWallpaper } from "@/config/backgroundWallpaper";
import { friendsConfig, friendsPageConfig } from "@/config/friendsConfig";
import { musicPlayerConfig } from "@/config/musicConfig";
import { profileConfig } from "@/config/profileConfig";
import { siteConfig } from "@/config/siteConfig";

export const prerender = true;

export const GET: APIRoute = () => {
	const payload = {
		site: {
			title: siteConfig.title,
			subtitle: siteConfig.subtitle,
			description: siteConfig.description,
			keywords: siteConfig.keywords,
			site_url: siteConfig.site_url,
			lang: siteConfig.lang,
			timezone: siteConfig.timezone,
			siteStartDate: siteConfig.siteStartDate,
			themeColor: siteConfig.themeColor,
			pageWidth: siteConfig.pageWidth,
			card: siteConfig.card,
			pages: siteConfig.pages,
			categoryBar: siteConfig.categoryBar,
			categoryStyle: siteConfig.categoryStyle,
			tagStyle: siteConfig.tagStyle,
			pagination: siteConfig.pagination,
			navbar: {
				title: siteConfig.navbar.title,
				widthFull: siteConfig.navbar.widthFull,
				menuAlign: siteConfig.navbar.menuAlign,
				followTheme: siteConfig.navbar.followTheme,
				navbarMode: siteConfig.navbar.navbarMode,
			},
			post: {
				showLastModified: siteConfig.post.showLastModified,
				outdatedThreshold: siteConfig.post.outdatedThreshold,
				share: siteConfig.post.share,
				postNavigation: siteConfig.post.postNavigation,
				relatedPosts: siteConfig.post.relatedPosts,
				randomPosts: siteConfig.post.randomPosts,
				generateOgImages: siteConfig.post.generateOgImages,
				immersiveReading: siteConfig.post.immersiveReading,
			},
		},
		profile: {
			avatar: profileConfig.avatar,
			name: profileConfig.name,
			bio: profileConfig.bio,
			links: profileConfig.links,
		},
		music: {
			showInNavbar: musicPlayerConfig.showInNavbar,
			showInSidebar: musicPlayerConfig.showInSidebar,
			mode: musicPlayerConfig.mode,
			volume: musicPlayerConfig.volume,
			playMode: musicPlayerConfig.playMode,
			showLyrics: musicPlayerConfig.showLyrics,
			local: musicPlayerConfig.local,
			meting: musicPlayerConfig.meting,
		},
		friends: {
			page: friendsPageConfig,
			links: friendsConfig,
		},
		banner: {
			mode: backgroundWallpaper.mode,
			common: {
				dimOpacity: backgroundWallpaper.common?.dimOpacity,
				playerMode: backgroundWallpaper.common?.playerMode,
				homeText: backgroundWallpaper.common?.homeText,
			},
		},
		announcement: announcementConfig,
	};

	return new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json; charset=utf-8" },
	});
};
