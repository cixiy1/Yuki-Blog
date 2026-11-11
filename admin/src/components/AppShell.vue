<script setup lang="ts">
/**
 * 管理端外壳：左侧卡片式侧栏 + 右侧内容列。
 * 侧栏本身也是一张卡（圆角、描边、投影），跟主站的卡片流用同一套语言，
 * 不是后台模板里那种贴边到底的深色侧栏。
 * 底色不跟主题色相走，否则整页铺开就是一片绿。
 */
import { computed, ref, watch } from "vue";
import { canReview, isAdmin, logout, user } from "../lib/auth";
import { isDark, toggleTheme } from "../lib/theme";
import { editOrigin, go, type RouteName, route } from "../router";
import AllPosts from "../views/AllPosts.vue";
import AuditLog from "../views/AuditLog.vue";
import CommentsAdmin from "../views/CommentsAdmin.vue";
import MediaLibrary from "../views/MediaLibrary.vue";
import MyComponents from "../views/MyComponents.vue";
import MyPosts from "../views/MyPosts.vue";
import Overview from "../views/OverviewPage.vue";
import PageEdit from "../views/PageEdit.vue";
import PagesAdmin from "../views/PagesAdmin.vue";
import PostEdit from "../views/PostEdit.vue";
import ReviewDetail from "../views/ReviewDetail.vue";
import ReviewQueue from "../views/ReviewQueue.vue";
import SeriesAdmin from "../views/SeriesAdmin.vue";
import SiteSettings from "../views/SiteSettings.vue";
import UsersAdmin from "../views/UsersAdmin.vue";
import AppIcon from "./AppIcon.vue";

const VIEWS: Record<RouteName, unknown> = {
	overview: Overview,
	posts: MyPosts,
	"all-posts": AllPosts,
	"post-edit": PostEdit,
	pages: PagesAdmin,
	"page-edit": PageEdit,
	series: SeriesAdmin,
	components: MyComponents,
	media: MediaLibrary,
	review: ReviewQueue,
	comments: CommentsAdmin,
	users: UsersAdmin,
	audit: AuditLog,
	settings: SiteSettings,
};

const current = computed(() => {
	const now = route.value;
	// /review/<id> 复用 review 这一段前缀，侧栏高亮才不会掉
	if (now.name === "review" && now.id) return ReviewDetail;
	return VIEWS[now.name] ?? Overview;
});

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
				...(canReview.value
					? [
							{
								key: "all-posts" as RouteName,
								label: "全站文章",
								icon: "globe",
								path: "/all-posts",
							},
						]
					: []),
				{ key: "posts", label: "我的文章", icon: "posts", path: "/posts" },
				{ key: "pages", label: "页面", icon: "page", path: "/pages" },
				{ key: "series", label: "系列管理", icon: "layers", path: "/series" },
				{ key: "media", label: "媒体库", icon: "image", path: "/media" },
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
				{ key: "review", label: "审核队列", icon: "review", path: "/review" },
				{
					key: "comments",
					label: "评论",
					icon: "comment",
					path: "/comments",
				},
			],
		});
	}
	if (isAdmin.value) {
		groups.push({
			label: "管理",
			items: [
				{ key: "users", label: "用户管理", icon: "users", path: "/users" },
				{ key: "audit", label: "审计日志", icon: "audit", path: "/audit" },
				{
					key: "settings",
					label: "站点设置",
					icon: "admin",
					path: "/settings",
				},
			],
		});
	}
	return groups;
});

const activeKey = computed(() => {
	if (route.value.name === "post-edit") {
		// D1 草稿只可能从「我的文章」进；仓库文章两个列表都能进，看最后一次点选。
		// 以前一律归到「全站文章」，从「我的文章」点编辑时高亮会跳走。
		return route.value.repoSlug ? editOrigin.value : "posts";
	}
	// 单页编辑与「页面」列表共用一段前缀，高亮跟着列表走
	if (route.value.name === "page-edit") return "pages";
	return route.value.name;
});

/** 窄屏把导航收进菜单，默认关上；切页后自动收起 */
const menuOpen = ref(false);
watch(
	() => route.value,
	() => {
		menuOpen.value = false;
	},
);

function navigate(path: string): void {
	go(path);
	menuOpen.value = false;
}

const brandTag = computed(() => {
	const role = user.value?.role;
	if (role === "admin") return "管理端";
	if (role === "reviewer") return "审核台";
	return "创作台";
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
	<div class="app">
		<aside class="sidebar">
			<a class="brand" href="#/overview" @click.prevent="navigate('/overview')">
				<span class="brand-name">Yuki Blog</span>
				<span class="brand-tag">{{ brandTag }}</span>
			</a>

			<nav
				class="nav"
				:class="{ open: menuOpen }"
				aria-label="管理端导航"
			>
				<div v-for="group in navGroups" :key="group.label" class="group">
					<p class="group-label">{{ group.label }}</p>
					<a
						v-for="item in group.items"
						:key="item.key"
						class="nav-item"
						:class="{ on: activeKey === item.key }"
						:href="`#${item.path}`"
						@click.prevent="navigate(item.path)"
					>
						<AppIcon :name="item.icon" :size="17" />
						<span>{{ item.label }}</span>
					</a>
				</div>
			</nav>

			<div class="foot">
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
					<span class="me-text">
						<span class="me-name">{{ displayName }}</span>
						<span class="me-role">{{ roleLabel }} · uid {{ user?.uid }}</span>
					</span>
				</a>

				<div class="foot-actions">
					<button
						type="button"
						class="icon menu-btn"
						:aria-expanded="menuOpen"
						aria-label="导航菜单"
						@click="menuOpen = !menuOpen"
					>
						<AppIcon :name="menuOpen ? 'close' : 'menu'" :size="18" />
					</button>
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
		</aside>

		<main class="page">
			<component :is="current" />
		</main>
	</div>
</template>

<style scoped>
.app {
	display: grid;
	grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
	gap: var(--shell-gap);
	max-width: none;
	margin: 0;
	/* 左右不留白：侧栏贴窗口左边，内容列贴右边，宽屏上不再有两条灰带。
	   右边留 12px 是为了让最后一张卡的右描边落在窗口内，不至于贴着边被切掉。
	   下边也不能留：侧栏 sticky 到容器底就被钳住，容器少 24px 页脚就会浮起来 */
	padding: 0 0.75rem 0 0;
	align-items: start;
}

.sidebar {
	position: sticky;
	top: 0;
	display: flex;
	flex-direction: column;
	gap: 1.1rem;
	height: 100vh;
	padding: 1rem 0.8rem;
	background: var(--sidebar-bg);
	/* 贴边的一侧不收圆角、不留描边，看起来是「贴在窗口上的面板」而不是浮着的卡 */
	border: 1px solid var(--line-divider);
	border-left: none;
	border-radius: 0 var(--radius-large) var(--radius-large) 0;
	box-shadow: var(--card-shadow);
}

.brand {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	/* 与导航项同一档左内边距，字和下面的图标对齐成一条线 */
	padding: 0.15rem 0.6rem;
	flex: none;
	color: var(--fg-90);
	font-weight: 700;
}

.brand-name {
	font-size: 0.95rem;
	white-space: nowrap;
}

.brand-tag {
	padding: 0.08rem 0.38rem;
	border-radius: 999px;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.64rem;
	font-weight: 600;
	letter-spacing: 0.04em;
	white-space: nowrap;
}

.nav {
	display: flex;
	flex-direction: column;
	/* 分组之间 24px，组内项目之间 8px（见 .group），4 的倍数 */
	gap: 1.5rem;
	flex: 1;
	overflow-y: auto;
	min-height: 0;
}

/* 项目之间留 8px：原来没有 gap，选中项的淡绿块和相邻项直接相接，
   看起来像一块绿叠在另一块上 */
.group {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.group-label {
	margin: 0 0 0 0.55rem;
	font-size: 0.68rem;
	font-weight: 600;
	letter-spacing: 0.08em;
	color: var(--fg-30);
}

.nav-item {
	display: flex;
	align-items: center;
	gap: 0.55rem;
	padding: 0.46rem 0.6rem;
	border-radius: 0.7rem;
	font-size: 0.86rem;
	color: var(--fg-75);
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.nav-item:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.nav-item.on {
	background: var(--tab-on-bg);
	color: var(--accent-text);
	font-weight: 600;
}

.foot {
	flex: none;
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
	padding-top: 0.7rem;
	border-top: 1px solid var(--line-divider);
}

.me {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.3rem 0.4rem;
	border-radius: 0.7rem;
	transition: background-color 0.15s ease;
}

.me:hover {
	background: var(--btn-plain-bg-hover);
}

.avatar {
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 999px;
	object-fit: cover;
	border: 1px solid var(--line-divider);
	flex: none;
}

.avatar-fallback {
	display: grid;
	place-items: center;
	background: var(--btn-regular-bg);
	color: var(--fg-90);
	font-size: 0.8rem;
	font-weight: 700;
}

.me-text {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.me-name {
	font-size: 0.84rem;
	font-weight: 600;
	color: var(--fg-90);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.me-role {
	font-size: 0.7rem;
	color: var(--fg-50);
	white-space: nowrap;
}

.foot-actions {
	display: flex;
	gap: 0.15rem;
}



.icon {
	display: grid;
	place-items: center;
	width: 2rem;
	height: 2rem;
	border: none;
	border-radius: 0.65rem;
	background: transparent;
	color: var(--fg-50);
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.icon:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

/* 菜单按钮只在窄屏出现。要压过上面 .icon 的 display:grid，选择器得够具体 */
.foot-actions .menu-btn {
	display: none;
}

.page {
	min-width: 0;
	/* 短页面也撑到与侧栏底边齐平，右侧不会剩一块「到此为止」的空白 */
	min-height: 100vh;
	/* 只留上下呼吸，左右贴边 */
	padding: 1.25rem 0 2.5rem;
}

/* 窄屏：侧栏收成顶部一条，导航折进菜单。
   以前是把导航横向摊开再让它自动换行，结果三个分组各成一竖列并排，
   看着像两列错位的网格；现在点菜单按钮展开成单列。 */
@media (max-width: 900px) {
	.app {
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		padding: 0 0 0.75rem;
	}

	.sidebar {
		position: sticky;
		top: 0;
		z-index: 20;
		height: auto;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-left: none;
		border-top: none;
		border-radius: 0 0 var(--radius-large) var(--radius-large);
	}

	.brand {
		order: 1;
		padding: 0;
	}

	.foot {
		order: 2;
		margin-left: auto;
		flex-direction: row;
		align-items: center;
		gap: 0.15rem;
		padding-top: 0;
		border-top: none;
		border-left: none;
		padding-left: 0;
	}

	.me {
		padding: 0;
	}

	.foot-actions .menu-btn {
		display: grid;
	}

	/* 收起时不占位置，展开后在标题栏下方铺成单列 */
	.nav {
		order: 3;
		flex: 1 0 100%;
		min-width: 0;
		display: none;
		flex-direction: column;
		gap: 0.6rem;
		overflow: visible;
		padding-bottom: 0.2rem;
	}

	.nav.open {
		display: flex;
	}

	.group {
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
	}

	.group-label {
		display: block;
	}

	.nav-item {
		white-space: nowrap;
		padding: 0.5rem 0.6rem;
		font-size: 0.86rem;
	}

	.me-text {
		display: none;
	}

	/* 桌面为贴边把左右 padding 归零，窄屏必须补回来，否则标题和卡片直接压在屏幕边上 */
	.page {
		padding: 0.9rem 0.75rem 2rem;
	}
}
</style>
