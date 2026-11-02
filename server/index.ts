import { app } from "./app";

interface WorkerExport {
	fetch(request: Request, env: Env): Response | Promise<Response>;
}

const handler: WorkerExport = { fetch: app.fetch };

export default handler;
