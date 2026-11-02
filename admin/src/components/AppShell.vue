<script setup lang="ts">
/**
 * 管理端外壳，结构与主站页面保持一致：
 * 一条贴顶的毛玻璃导航条（内容居中、底部圆角）+ 居中内容列。
 * 之前是「左侧栏 + 顶栏」的后台壳，与博客的悬浮导航 + 卡片流是两种语言，
 * 从主站点进来会像换了个产品。
 */
import { computed } from "vue";
import { canReview, isAdmin, logout, user } from "../lib/auth";
import { isDark, toggleTheme } from "../lib/theme";
import { go, type RouteName, route } from "../router";
import AuditLog from "../views/AuditLog.vue";
import MyComponents from "../views/MyComponents.vue";
import MyPosts from "../views/MyPosts.vue";
import Overview from "../views/OverviewPage.vue";
import PostEdit from "../views/PostEdit.vue";
import ReviewQueue from "../views/ReviewQueue.vue";
import SiteSettings from "../views/SiteSettings.vue";
import UsersAdmin from "../views/UsersAdmin.vue";
import AppIcon from "./AppIcon.vue";

const VIEWS: Record<RouteName, unknown> = {
	overview: Overview,
	posts: MyPosts,
	"post-edit": PostEdit,
	components: MyComponents,
	review: ReviewQueue,
	users: UsersAdmin,
	audit: AuditLog,
	settings: SiteSettings,
};

const current = computed(() => VIEWS[route.value.name] ?? Overview);

interface NavItem {
	key: RouteName | string;
	label: string;
	icon: string;
	path: string;
}

interface NavGroup {
	label: string;
	items: NavItem[];
}

const navGroups = computed<NavGroup[]>(() => {
	const groups: NavGroup[] = [
		{
			label: "内容",
			items: [
				{ key: "overview", label: "概览", icon: "overview", path: "/overview" },
				{ key: "posts", label: "文章", icon: "posts", path: "/posts" },
				{ key: "components", label: "组件", icon: "components", path: "/components" },
			],
		},
	];
	if (canReview.value) {
		groups.push({
			label: "审核",
			items: [{ key: "review", label: "审核", icon: "review", path: "/review" }],
		});
	}
	if (isAdmin.value) {
		groups.push({
			label: "管理",
			items: [
				{ key: "users", label: "用户", icon: "users", path: "/users" },
				{ key: "audit", label: "审计", icon: "audit", path: "/audit" },
				{ key: "settings", label: "站点设置", icon: "admin", path: "/settings" },
			],
		});
	}
	return groups;
});

const activeKey = computed(() => {
	if (route.value.name === "post-edit") return "posts";
	return route.value.name;
});

const displayName = computed(
	() => user.value?.display_name || user.value?.email.split("@")[0] || "未命名",
);
</script>

<template>
	<div class="app">
		<header class="topbar">
			<div class="surface">
				<div class="bar">
					<a class="brand" href="#/overview" @click.prevent="go('/overview')">
						<span class="brand-dot" />
						<span class="brand-name">Yuki Blog</span>
						<span class="brand-tag">管理端</span>
					</a>

					<nav class="tabs" aria-label="管理端导航">
						<div v-for="group in navGroups" :key="group.label" class="group">
							<a
								v-for="item in group.items"
								:key="item.key"
								class="tab"
								:class="{ on: activeKey === item.key }"
								:href="`#${item.path}`"
								@click.prevent="go(item.path)"
							>
								<AppIcon :name="item.icon" :size="16" />
								<span>{{ item.label }}</span>
							</a>
						</div>
					</nav>

					<div class="side">
						<a
							class="me"
							href="/me/"
							target="_blank"
							rel="noopener"
							:title="`${displayName} · 个人中心`"
						>
							<img
								v-if="user?.avatar_url"
								class="avatar"
								:src="user.avatar_url"
								:alt="displayName"
							/>
							<span v-else class="avatar avatar-fallback">
								{{ displayName.slice(0, 1).toUpperCase() }}
							</span>
							<span class="me-name">{{ displayName }}</span>
						</a>
						<button
							type="button"
							class="icon"
							:title="isDark ? '切换到浅色模式' : '切换到深色模式'"
							@click="toggleTheme()"
						>
							<AppIcon :name="isDark ? 'sun' : 'moon'" :size="17" />
						</button>
						<a class="icon" href="/" title="返回站点">
							<AppIcon name="back" :size="17" />
						</a>
						<button type="button" class="icon" title="退出登录" @click="logout()">
							<AppIcon name="logout" :size="17" />
						</button>
					</div>
				</div>
			</div>
		</header>

		<main class="page">
			<div class="page-wrap">
				<component :is="current" />
			</div>
		</main>
	</div>
</template>

<style scoped>
.app {
	min-height: 100vh;
}

.topbar {
	position: sticky;
	top: 0;
	z-index: 30;
}

/* 贴顶全宽条：底色铺满、只有底部圆角，与主站 #navbar 一致 */
.surface {
	background: var(--nav-surface);
	backdrop-filter: blur(20px) saturate(140%);
	border-bottom: 1px solid var(--line-divider);
	border-radius: 0 0 0.75rem 0.75rem;
	box-shadow: var(--nav-shadow);
}

.bar {
	display: flex;
	align-items: center;
	gap: 1rem;
	height: var(--nav-height);
	max-width: var(--content-max);
	margin: 0 auto;
	padding: 0 0.5rem;
}

.brand {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex: none;
	color: var(--fg-90);
	font-weight: 700;
	letter-spacing: 0.01em;
}

.brand-dot {
	width: 0.6rem;
	height: 0.6rem;
	border-radius: 999px;
	background: var(--primary);
	box-shadow: 0 0 0 3px var(--btn-regular-bg);
}

.brand-name {
	font-size: 0.98rem;
}

.brand-tag {
	padding: 0.1rem 0.4rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--btn-content);
	font-size: 0.66rem;
	font-weight: 600;
	letter-spacing: 0.04em;
}

.tabs {
	display: flex;
	align-items: center;
	gap: 0.15rem;
	flex: 1;
	min-width: 0;
	overflow-x: auto;
	scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
	display: none;
}

.group {
	display: flex;
	align-items: center;
	gap: 0.15rem;
	flex: none;
}

.group + .group {
	margin-left: 0.35rem;
	padding-left: 0.5rem;
	border-left: 1px solid var(--line-divider);
}

.tab {
	display: inline-flex;
	align-items: center;
	gap: 0.38rem;
	padding: 0.4rem 0.7rem;
	border-radius: 0.7rem;
	color: var(--fg-75);
	font-size: 0.83rem;
	white-space: nowrap;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.tab:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--btn-content);
}

.tab.on {
	background: var(--tab-on-bg);
	color: var(--btn-content);
	font-weight: 600;
}

.side {
	display: flex;
	align-items: center;
	gap: 0.2rem;
	flex: none;
}

.me {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	padding: 0.2rem 0.55rem 0.2rem 0.2rem;
	border-radius: 999px;
	color: var(--fg-75);
	font-size: 0.8rem;
	transition: background-color 0.15s ease;
}

.me:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--btn-content);
}

.avatar {
	width: 1.7rem;
	height: 1.7rem;
	border-radius: 999px;
	object-fit: cover;
	border: 1px solid var(--line-divider);
}

.avatar-fallback {
	display: grid;
	place-items: center;
	background: var(--btn-regular-bg);
	color: var(--btn-content);
	font-size: 0.76rem;
	font-weight: 700;
}

.me-name {
	max-width: 7rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.icon {
	display: grid;
	place-items: center;
	width: 2rem;
	height: 2rem;
	border: none;
	border-radius: 0.7rem;
	background: transparent;
	color: var(--fg-50);
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.icon:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--btn-content);
}

.page {
	padding-top: 0.25rem;
}

@media (max-width: 880px) {
	.bar {
		height: auto;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		padding: 0.5rem 0.4rem 0.45rem;
	}

	.tabs {
		order: 3;
		width: 100%;
		flex: 1 0 100%;
		padding-bottom: 0.1rem;
	}

	.me-name {
		display: none;
	}
}
</style>
