<script setup lang="ts">
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
	role?: "review" | "admin";
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
				{ key: "posts", label: "我的文章", icon: "posts", path: "/posts" },
				{
					key: "components",
					label: "我的组件",
					icon: "components",
					path: "/components",
				},
			],
		},
	];
	if (canReview.value) {
		groups.push({
			label: "审核",
			items: [
				{
					key: "review",
					label: "审核队列",
					icon: "review",
					path: "/review",
					role: "review",
				},
			],
		});
	}
	if (isAdmin.value) {
		groups.push({
			label: "管理",
			items: [
				{
					key: "users",
					label: "用户管理",
					icon: "users",
					path: "/users",
					role: "admin",
				},
				{
					key: "audit",
					label: "审计日志",
					icon: "audit",
					path: "/audit",
					role: "admin",
				},
				{
					key: "settings",
					label: "站点设置",
					icon: "admin",
					path: "/settings",
					role: "admin",
				},
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

const roleLabel = computed(() => {
	const role = user.value?.role;
	if (role === "admin") return "管理员";
	if (role === "reviewer") return "审核员";
	return "成员";
});
</script>

<template>
	<div class="shell">
		<aside class="sidebar">
			<a class="brand" href="#/overview" @click.prevent="go('/overview')">
				<span class="brand-dot" />
				<span class="brand-text">
					Yuki Blog
					<span class="brand-sub">管理端</span>
				</span>
			</a>

			<nav class="nav">
				<div v-for="group in navGroups" :key="group.label" class="nav-group">
					<p class="nav-label">{{ group.label }}</p>
					<a
						v-for="item in group.items"
						:key="item.key"
						class="nav-item"
						:class="{ active: activeKey === item.key }"
						:href="`#${item.path}`"
						@click.prevent="go(item.path)"
					>
						<AppIcon :name="item.icon" />
						<span>{{ item.label }}</span>
					</a>
				</div>
			</nav>

			<div class="sidebar-foot">
				<button type="button" class="foot-action" @click="toggleTheme()">
					<AppIcon :name="isDark ? 'sun' : 'moon'" />
					<span>{{ isDark ? "浅色模式" : "深色模式" }}</span>
				</button>
				<a class="foot-action" href="/">
					<AppIcon name="back" />
					<span>返回站点</span>
				</a>
			</div>
		</aside>

		<div class="main">
			<header class="topbar">
				<div class="who">
					<img
						v-if="user?.avatar_url"
						class="avatar"
						:src="user.avatar_url"
						:alt="displayName"
					/>
					<span v-else class="avatar avatar-fallback">
						{{ displayName.slice(0, 1).toUpperCase() }}
					</span>
					<div class="who-text">
						<p class="who-name">{{ displayName }}</p>
						<p class="who-meta">{{ roleLabel }} · uid {{ user?.uid }}</p>
					</div>
				</div>
				<div class="topbar-actions">
					<a class="btn-ghost" href="/me/" target="_blank" rel="noopener">
						<AppIcon name="external" :size="16" />
						个人中心
					</a>
					<button type="button" class="btn-regular" @click="logout()">
						<AppIcon name="logout" :size="16" />
						退出
					</button>
				</div>
			</header>

			<main class="content">
				<component :is="current" />
			</main>
		</div>
	</div>
</template>

<style scoped>
.shell {
	display: flex;
	min-height: 100vh;
	align-items: stretch;
}

.sidebar {
	width: var(--sidebar-width);
	flex: none;
	position: sticky;
	top: 0;
	height: 100vh;
	display: flex;
	flex-direction: column;
	gap: 1.25rem;
	padding: 1.1rem 0.75rem;
	border-right: 1px solid var(--line-divider);
	background: var(--card-bg);
}

.brand {
	display: flex;
	align-items: center;
	gap: 0.55rem;
	padding: 0.25rem 0.5rem;
	font-weight: 700;
	color: var(--fg-90);
}

.brand-dot {
	width: 0.65rem;
	height: 0.65rem;
	border-radius: 999px;
	background: var(--primary);
	box-shadow: 0 0 0 3px var(--btn-regular-bg);
}

.brand-text {
	display: flex;
	align-items: baseline;
	gap: 0.35rem;
	font-size: 0.95rem;
	letter-spacing: 0.01em;
}

.brand-sub {
	font-size: 0.7rem;
	font-weight: 500;
	color: var(--fg-50);
}

.nav {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	flex: 1;
	overflow-y: auto;
}

.nav-label {
	margin: 0 0 0.3rem 0.55rem;
	font-size: 0.68rem;
	font-weight: 600;
	letter-spacing: 0.08em;
	color: var(--fg-30);
}

.nav-item {
	display: flex;
	align-items: center;
	gap: 0.55rem;
	padding: 0.45rem 0.6rem;
	border-radius: 0.7rem;
	font-size: 0.86rem;
	color: var(--fg-75);
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.nav-item:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--btn-content);
}

.nav-item.active {
	background: var(--btn-regular-bg);
	color: var(--btn-content);
	font-weight: 600;
}

.sidebar-foot {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	padding-top: 0.6rem;
	border-top: 1px solid var(--line-divider);
}

.foot-action {
	display: flex;
	align-items: center;
	gap: 0.55rem;
	width: 100%;
	padding: 0.42rem 0.6rem;
	border: none;
	background: transparent;
	border-radius: 0.7rem;
	font-size: 0.82rem;
	color: var(--fg-50);
	text-align: left;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.foot-action:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--btn-content);
}

.main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.topbar {
	position: sticky;
	top: 0;
	z-index: 10;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.75rem 1.5rem;
	background: color-mix(in oklab, var(--page-bg) 88%, transparent);
	backdrop-filter: blur(10px);
	border-bottom: 1px solid var(--line-divider);
}

.who {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	min-width: 0;
}

.avatar {
	width: 2rem;
	height: 2rem;
	border-radius: 999px;
	object-fit: cover;
	border: 1px solid var(--line-divider);
}

.avatar-fallback {
	display: grid;
	place-items: center;
	background: var(--btn-regular-bg);
	color: var(--btn-content);
	font-size: 0.85rem;
	font-weight: 700;
}

.who-text {
	min-width: 0;
}

.who-name {
	margin: 0;
	font-size: 0.86rem;
	font-weight: 600;
	color: var(--fg-90);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.who-meta {
	margin: 0;
	font-size: 0.72rem;
	color: var(--fg-50);
}

.topbar-actions {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	flex: none;
}

.content {
	padding: 1.5rem;
	width: 100%;
	max-width: var(--shell-max);
}

@media (max-width: 900px) {
	.shell {
		flex-direction: column;
	}

	.sidebar {
		position: static;
		width: 100%;
		height: auto;
		flex-direction: row;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.9rem;
		border-right: none;
		border-bottom: 1px solid var(--line-divider);
		overflow-x: auto;
	}

	.brand {
		flex: none;
		padding: 0;
	}

	.nav {
		flex-direction: row;
		gap: 0.35rem;
		overflow: visible;
	}

	.nav-group {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.nav-label {
		display: none;
	}

	.nav-item {
		white-space: nowrap;
		padding: 0.35rem 0.55rem;
	}

	.sidebar-foot {
		flex-direction: row;
		border-top: none;
		padding-top: 0;
	}

	.foot-action span {
		display: none;
	}

	.topbar {
		padding: 0.6rem 1rem;
	}

	.content {
		padding: 1rem;
	}
}
</style>
