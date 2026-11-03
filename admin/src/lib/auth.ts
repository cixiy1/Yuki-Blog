import { computed, ref } from "vue";
import { ApiError, api, type SessionUser } from "./api";

export type AuthStatus = "loading" | "ready" | "anon" | "error";

export const user = ref<SessionUser | null>(null);
export const authStatus = ref<AuthStatus>("loading");
export const authError = ref("");

export const isAdmin = computed(() => user.value?.role === "admin");
export const canReview = computed(
	() => user.value?.role === "admin" || user.value?.role === "reviewer",
);

interface MeResponse {
	authenticated: boolean;
	user?: SessionUser;
	session?: { expires_at: string };
}

/** 未登录时整页跳登录页，登录成功后由登录页按 ?next= 跳回来 */
export function redirectToLogin(): void {
	const next = encodeURIComponent("/admin/");
	location.replace(`/login/?next=${next}`);
}

export async function loadSession(): Promise<void> {
	authStatus.value = "loading";
	try {
		const data = await api.get<MeResponse>("/api/auth/me");
		if (data.authenticated && data.user) {
			user.value = data.user;
			authStatus.value = "ready";
			return;
		}
		user.value = null;
		authStatus.value = "anon";
	} catch (error) {
		user.value = null;
		// 401 未登录、403 未验证/停用，都回到登录页；后者把原因带到地址上
		if (
			error instanceof ApiError &&
			(error.status === 401 || error.status === 403)
		) {
			authStatus.value = "anon";
			authError.value = error.message;
			return;
		}
		authError.value = error instanceof Error ? error.message : "无法连接服务端";
		authStatus.value = "error";
	}
}

export async function logout(): Promise<void> {
	try {
		await api.post("/api/auth/logout");
	} catch {
		// 幂等接口，失败也按已退出处理，避免卡在登录态
	}
	location.assign("/login/");
}
