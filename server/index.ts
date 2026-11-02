import { app } from "./app";

export default {
	fetch: app.fetch,
} satisfies {
	fetch: (request: Request, env: Env) => Response | Promise<Response>;
};
