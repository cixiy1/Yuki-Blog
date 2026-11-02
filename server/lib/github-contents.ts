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

/** 读远端文件当前的 sha；文件不存在返回 null（首次发布时是这种情况） */
async function currentSha(
	repo: string,
	path: string,
	branch: string,
	token: string,
): Promise<{ sha: string | null; status: number }> {
	const res = await fetch(
		`${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
		{ headers: headers(token) },
	);
	if (res.status === 404) return { sha: null, status: 200 };
	if (!res.ok) return { sha: null, status: res.status };
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
			message: `读取远端文件失败（${existing.status}）`,
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
			message: text.slice(0, 200) || `写入失败（${res.status}）`,
		};
	}

	const data = (await res.json()) as { commit?: { sha?: string } };
	return { ok: true, status: 200, sha: data.commit?.sha };
}
