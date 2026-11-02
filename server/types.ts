import type { SessionUser } from "./lib/session";

export type AppEnv = {
	Bindings: Env;
	Variables: {
		/** loadSession 会在链首置 null，命中会话后填值 */
		user: SessionUser | null;
	};
};

export type Role = "user" | "reviewer" | "admin";

export const ROLE_LEVEL: Record<Role, number> = {
	user: 1,
	reviewer: 2,
	admin: 3,
};
