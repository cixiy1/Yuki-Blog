/**
 * 往仓库里写站点配置文件（GitHub Contents API）。
 *
 * 只做一件事：把 `config/site.json` 整份替换掉，commit 到默认分支。
 * 写成功即触发 Cloudflare 的构建（仓库接了 Git 集成），所以这里不做轮询，
 * 把 commit sha 交给调用方，管理端按需自己查部署状态。
 */
const API = "https://api.github.com";

export interface PutFileResult {
	ok: boolean;
	sha?: string;
	status: number;
	message?: string;
}

function headers(token: string): Record<string, string> {
	return {
		accept: "application/vnd.github+json",
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
		"user-agent": "yuki-blog-admin",
		"x-github-api-version": "2022-11-28",
	};
}

/** 从 GitHub 的错误体里抠出 message，失败就退回原文 */
function ghMessage(text: string): string {
	try {
		const data = JSON.parse(text) as { message?: unknown };
		if (typeof data.message === "string") return data.message;
	} catch {
		// 不是 JSON，按原文处理
	}
	return text;
}

/**
 * 把 GitHub 的错误翻译成能照着做的话。
 * 403 最容易被误读：fine-grained 令牌给成只读时，`GET /repos` 里
 * permissions.push 仍然是 true（那是账号对该仓库的权限，不是令牌的），
 * 只有真正写入才会 403。
 */
function explain(status: number, raw: string): string {
	const detail = ghMessage(raw).slice(0, 200);
	const lower = detail.toLowerCase();
	if (status === 401) {
		return "GitHub 令牌无效或已过期，重新生成一个再填进来";
	}
	if (
		status === 403 &&
		lower.includes("not accessible by personal access token")
	) {
		return "令牌只有读权限。去 GitHub → Settings → Developer settings → Fine-grained tokens 打开这个令牌，把 Contents 改成 Read and write，并确认 Repository access 里包含 cixiy1/Yuki-blog；改完立即生效，不必重新生成。";
	}
	if (status === 404) {
		return "令牌看不到这个仓库：检查 Repository access 是否包含 cixiy1/Yuki-blog";
	}
	if (status === 403) {
		return `GitHub 拒绝写入：${detail}`;
	}
	return detail || `写入失败（${status}）`;
}

/** 读远端文件当前的 sha；文件不存在返回 null（首次发布时是这种情况） */
async function currentSha(
	repo: string,
	path: string,
	branch: string,
	token: string,
): Promise<{ sha: string | null; status: number; message?: string }> {
	const res = await fetch(
		`${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
		{ headers: headers(token) },
	);
	if (res.status === 404) return { sha: null, status: 200 };
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		return {
			sha: null,
			status: res.status,
			message: explain(res.status, text),
		};
	}
	const data = (await res.json()) as { sha?: string };
	return { sha: data.sha ?? null, status: 200 };
}

/**
 * base64 编码，Worker 里没有 Buffer。
 * 分块拼字符串：一次 `String.fromCharCode(...bytes)` 传几百万个参数会爆栈。
 */
function bytesToBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	const parts: string[] = [];
	for (let i = 0; i < bytes.length; i += CHUNK) {
		parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
	}
	return btoa(parts.join(""));
}

function toBase64(text: string): string {
	return bytesToBase64(new TextEncoder().encode(text));
}

export async function putRepoFile(input: {
	repo: string;
	path: string;
	branch: string;
	content: string;
	message: string;
	token: string;
}): Promise<PutFileResult> {
	const { repo, path, branch, content, message, token } = input;
	const existing = await currentSha(repo, path, branch, token);
	if (existing.status !== 200) {
		return {
			ok: false,
			status: existing.status,
			message: existing.message ?? `读取远端文件失败（${existing.status}）`,
		};
	}

	const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
		method: "PUT",
		headers: headers(token),
		body: JSON.stringify({
			message,
			content: toBase64(content),
			branch,
			// 带上 sha 是乐观并发：别人刚推过就会 409，避免覆盖别人的改动
			...(existing.sha ? { sha: existing.sha } : {}),
		}),
	});

	if (res.status === 409) {
		return {
			ok: false,
			status: 409,
			message: "仓库里这份文件刚被改过，请重新发布",
		};
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		return {
			ok: false,
			status: res.status,
			message: explain(res.status, text),
		};
	}

	const data = (await res.json()) as { commit?: { sha?: string } };
	return { ok: true, status: 200, sha: data.commit?.sha };
}

/* ------------------------- 一批文件压成一次提交 ------------------------- */

/** 一次提交能带多少文件：媒体库一次最多传 20 张，留一倍余量 */
const MAX_FILES_PER_COMMIT = 40;

/** 单个 blob 的上限（GitHub 是 100 MB，这里按媒体库的 5 MB 规则卡死） */
const MAX_BLOB_BYTES = 5 * 1024 * 1024;

export interface RepoFileChange {
	/** 仓库内相对路径，不以 `/` 开头 */
	path: string;
	/** 文本内容；二进制走 bytes */
	content?: string;
	bytes?: Uint8Array;
	/** 为 true 表示删掉这个路径 */
	remove?: boolean;
}

export interface PutFilesResult {
	ok: boolean;
	status: number;
	message?: string;
	/** 提交 sha */
	commit?: string;
	/** 实际写进这次提交的路径 */
	paths?: string[];
}

interface GhResult<T> {
	ok: boolean;
	status: number;
	data: T | null;
	text: string;
}

/**
 * 薄薄一层 fetch 封装：统一鉴权头、超时、把体内 JSON 解出来。
 * status 0 表示连不上（DNS / TLS / 超时）。
 */
async function gh<T>(
	repo: string,
	path: string,
	token: string,
	init?: { method?: string; body?: unknown },
): Promise<GhResult<T>> {
	try {
		const res = await fetch(`${API}/repos/${repo}${path}`, {
			method: init?.method ?? "GET",
			headers: headers(token),
			body: init?.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(15_000),
		});
		const text = await res.text().catch(() => "");
		let data: T | null = null;
		if (text) {
			try {
				data = JSON.parse(text) as T;
			} catch {
				data = null;
			}
		}
		return { ok: res.ok, status: res.status, data, text };
	} catch (error) {
		console.error("[github] 请求失败", path, error);
		return { ok: false, status: 0, data: null, text: "" };
	}
}

function failure(
	status: number,
	raw: string,
	fallback: string,
): PutFilesResult {
	if (status === 0) {
		return { ok: false, status: 502, message: "连不上 GitHub，稍后再试" };
	}
	return { ok: false, status, message: raw ? explain(status, raw) : fallback };
}

/**
 * 仓库内路径的安全检查。生成文件名时已经保证是 ASCII，
 * 这里再挡一次 `..`、绝对路径和怪异字符。
 */
export function safeRepoPath(raw: string): string | null {
	const path = raw.trim().replace(/^\/+/, "");
	if (!path || path.length > 300) return null;
	if (path.includes("..") || path.includes("//")) return null;
	if (!/^[A-Za-z0-9._\-/]+$/.test(path)) return null;
	if (path.endsWith("/")) return null;
	return path;
}

/**
 * 多个文件（可含删除）合并成一次 commit。
 *
 * 为什么不复用 `putRepoFile`：Contents API 一个文件一次 commit，传 10 张图就是
 * 10 次提交、10 次构建。这里走 Git Data API——建 blob、拿当前树拼一棵新树、
 * 建 commit、移动分支指针，全过程只产生一次构建。
 *
 * 并发保护：新 commit 的父节点是刚才读到的 HEAD，如果这中间别人推了东西，
 * 移动分支指针会被拒（422，非快进），映射成 409，调用方重新拉一次再提交。
 */
export async function putRepoFiles(input: {
	repo: string;
	branch: string;
	files: RepoFileChange[];
	message: string;
	token: string;
}): Promise<PutFilesResult> {
	const { repo, branch, message, token } = input;

	if (input.files.length === 0) {
		return { ok: false, status: 400, message: "没有要提交的文件" };
	}
	if (input.files.length > MAX_FILES_PER_COMMIT) {
		return {
			ok: false,
			status: 413,
			message: `一次最多提交 ${MAX_FILES_PER_COMMIT} 个文件`,
		};
	}

	// 先全部校验，别写到一半才发现某个路径不合法
	const changes: Array<{ path: string; write: RepoFileChange | null }> = [];
	for (const file of input.files) {
		const path = safeRepoPath(file.path);
		if (!path) {
			return { ok: false, status: 400, message: `路径不合法：${file.path}` };
		}
		if (file.remove) {
			changes.push({ path, write: null });
			continue;
		}
		const size =
			file.bytes?.byteLength ??
			(file.content === undefined
				? 0
				: new TextEncoder().encode(file.content).byteLength);
		if (size === 0) {
			return { ok: false, status: 400, message: `${path} 是空的` };
		}
		if (size > MAX_BLOB_BYTES) {
			return {
				ok: false,
				status: 413,
				message: `${path} 超过 ${Math.round(MAX_BLOB_BYTES / 1024 / 1024)} MB`,
			};
		}
		changes.push({ path, write: file });
	}

	// 1) 当前分支头部
	const ref = await gh<{ object?: { sha?: string } }>(
		repo,
		`/git/ref/heads/${encodeURI(branch)}`,
		token,
	);
	if (!ref.ok || !ref.data?.object?.sha) {
		return failure(
			ref.status,
			ref.text,
			`读不到分支 ${branch}，检查令牌与分支名`,
		);
	}
	const headSha = ref.data.object.sha;

	// 2) 头部提交指向的树，作为新树的底
	const head = await gh<{ tree?: { sha?: string } }>(
		repo,
		`/git/commits/${headSha}`,
		token,
	);
	if (!head.ok || !head.data?.tree?.sha) {
		return failure(head.status, head.text, "读不到当前提交的目录树");
	}
	const baseTree = head.data.tree.sha;

	// 3) 逐个建 blob（限并发，别把 GitHub 打成限流）
	const entries: Array<{
		path: string;
		mode: string;
		type: string;
		sha: string | null;
	}> = [];
	const queue = changes.slice();
	const workers = Array.from(
		{ length: Math.min(6, queue.length) },
		async () => {
			for (;;) {
				const change = queue.shift();
				if (!change) return;
				if (!change.write) {
					// 删文件：树里给 sha: null 即可，不用调接口确认它存在
					entries.push({
						path: change.path,
						mode: "100644",
						type: "blob",
						sha: null,
					});
					continue;
				}
				const base64 =
					change.write.bytes !== undefined
						? bytesToBase64(change.write.bytes)
						: toBase64(change.write.content ?? "");
				const blob = await gh<{ sha?: string }>(repo, "/git/blobs", token, {
					method: "POST",
					body: { content: base64, encoding: "base64" },
				});
				if (!blob.ok || !blob.data?.sha) {
					throw new Error(
						JSON.stringify({
							status: blob.status,
							text: blob.text,
							path: change.path,
						}),
					);
				}
				entries.push({
					path: change.path,
					mode: "100644",
					type: "blob",
					sha: blob.data.sha,
				});
			}
		},
	);

	try {
		await Promise.all(workers);
	} catch (error) {
		const detail = error instanceof Error ? error.message : "";
		let parsed: { status?: number; text?: string; path?: string } = {};
		try {
			parsed = JSON.parse(detail) as typeof parsed;
		} catch {
			// 不是我们抛的结构，按未知错误处理
		}
		const result = failure(
			parsed.status ?? 0,
			parsed.text ?? "",
			"上传文件内容失败",
		);
		return {
			...result,
			message: parsed.path
				? `${parsed.path}：${result.message}`
				: result.message,
		};
	}

	// 4) 拼新树
	const tree = await gh<{ sha?: string }>(repo, "/git/trees", token, {
		method: "POST",
		body: { base_tree: baseTree, tree: entries },
	});
	if (!tree.ok || !tree.data?.sha) {
		return failure(tree.status, tree.text, "生成目录树失败");
	}

	// 5) 建提交
	const commit = await gh<{ sha?: string }>(repo, "/git/commits", token, {
		method: "POST",
		body: { message, tree: tree.data.sha, parents: [headSha] },
	});
	if (!commit.ok || !commit.data?.sha) {
		return failure(commit.status, commit.text, "创建提交失败");
	}

	// 6) 移动分支指针（force:false = 只接受快进）
	const moved = await gh<unknown>(
		repo,
		`/git/refs/heads/${encodeURI(branch)}`,
		token,
		{
			method: "PATCH",
			body: { sha: commit.data.sha, force: false },
		},
	);
	if (!moved.ok) {
		if (moved.status === 422) {
			return {
				ok: false,
				status: 409,
				message: "仓库刚被别的提交改过，刷新后重试",
			};
		}
		return failure(moved.status, moved.text, "更新分支失败");
	}

	return {
		ok: true,
		status: 200,
		commit: commit.data.sha,
		paths: entries.map((entry) => entry.path),
	};
}

export interface RepoTreeEntry {
	path: string;
	bytes: number;
}

/**
 * 整棵树一次拿全（`recursive=1`），媒体库「刷新索引」用它。
 * 比 Contents API 一层层列目录省事，也不会撞上单目录 1000 条的上限。
 * 仓库太大时 GitHub 会截断（truncated），这时返回 truncated 让调用方说明。
 */
export async function listRepoTree(input: {
	repo: string;
	branch: string;
	token: string;
}): Promise<{
	ok: boolean;
	status: number;
	message?: string;
	truncated?: boolean;
	entries: RepoTreeEntry[];
}> {
	const res = await gh<{
		tree?: Array<{ path?: string; type?: string; size?: number }>;
		truncated?: boolean;
	}>(
		input.repo,
		`/git/trees/${encodeURI(input.branch)}?recursive=1`,
		input.token,
	);
	if (!res.ok || !res.data?.tree) {
		const result = failure(res.status, res.text, "读取仓库目录失败");
		return { ...result, entries: [] };
	}

	const entries: RepoTreeEntry[] = [];
	for (const item of res.data.tree) {
		if (item.type !== "blob" || typeof item.path !== "string") continue;
		entries.push({
			path: item.path,
			bytes: typeof item.size === "number" ? item.size : 0,
		});
	}
	return {
		ok: true,
		status: 200,
		truncated: res.data.truncated === true,
		entries,
	};
}
