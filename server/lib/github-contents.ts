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
	if (status === 403 && lower.includes("not accessible by personal access token")) {
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
		return { sha: null, status: res.status, message: explain(res.status, text) };
	}
	const data = (await res.json()) as { sha?: string };
	return { sha: data.sha ?? null, status: 200 };
}

/** base64 编码，Worker 里没有 Buffer */
function toBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
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
			message:
				existing.message ?? `读取远端文件失败（${existing.status}）`,
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
