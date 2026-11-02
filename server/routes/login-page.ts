import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "../types";

/**
 * P2 的临时登录页：Worker 直出，不经过 Astro 构建。
 *
 * 为什么不放 src/pages：wrangler dev 的静态资源来自 dist/，进构建就要先跑
 * 完整的 7 步后处理、改一行重建一次；还会被 pagefind 索引、进 sitemap，
 * 页面里的内联脚本也会被 swup 的容器替换机制影响。
 * P3 的 Vue admin 上线后，这个文件整份删掉。
 */

function renderPage(githubEnabled: boolean): string {
	const githubBlock = githubEnabled
		? `<a class="ghost" href="/api/auth/github/start?next=/login">用 GitHub 登录</a>`
		: "";

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>登录 · Yuki Blog</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f6f7; --card: #fff; --fg: #1f2328; --muted: #59636e;
    --line: #d8dee4; --accent: #2f6feb; --err: #c9302c; --ok: #1a7f37;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16181c; --card: #1d2025; --fg: #e6edf3; --muted: #9198a1;
            --line: #30363d; --accent: #6cb6ff; --err: #ff7b72; --ok: #3fb950; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: var(--bg); color: var(--fg);
    font: 15px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .card {
    width: 100%; max-width: 380px; background: var(--card); border: 1px solid var(--line);
    border-radius: 14px; padding: 28px 26px 24px;
  }
  h1 { margin: 0 0 6px; font-size: 20px; }
  .sub { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
  label { display: block; margin: 14px 0 6px; font-size: 13px; color: var(--muted); }
  input {
    width: 100%; padding: 10px 12px; font: inherit; color: inherit; background: transparent;
    border: 1px solid var(--line); border-radius: 8px; outline: none;
  }
  input:focus { border-color: var(--accent); }
  button {
    width: 100%; margin-top: 14px; padding: 10px 12px; font: inherit; font-weight: 600;
    color: #fff; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer;
  }
  button:disabled { opacity: .55; cursor: default; }
  .ghost {
    display: block; text-align: center; margin-top: 12px; padding: 9px 12px; font-size: 14px;
    color: var(--fg); text-decoration: none; border: 1px solid var(--line); border-radius: 8px;
  }
  #msg { min-height: 20px; margin: 12px 0 0; font-size: 13px; }
  #msg.err { color: var(--err); } #msg.ok { color: var(--ok); }
  dl { margin: 16px 0 0; font-size: 13px; }
  dl div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--line); }
  dt { color: var(--muted); } dd { margin: 0; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<main class="card">
  <section id="guest">
    <h1>登录 Yuki Blog</h1>
    <p class="sub">邮箱验证码登录，首次登录自动注册。</p>
    <form id="form" novalidate>
      <label for="email">邮箱</label>
      <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
      <button id="send" type="button">发送验证码</button>
      <div id="code-block" hidden>
        <label for="code">验证码</label>
        <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位数字">
        <button id="submit" type="submit">登录</button>
      </div>
    </form>
    ${githubBlock}
    <p id="msg"></p>
  </section>
  <section id="me" hidden>
    <h1 id="me-title">已登录</h1>
    <dl>
      <div><dt>昵称</dt><dd id="me-name"></dd></div>
      <div><dt>uid</dt><dd id="me-uid"></dd></div>
      <div><dt>角色</dt><dd id="me-role"></dd></div>
      <div><dt>邮箱</dt><dd id="me-email"></dd></div>
    </dl>
    <button id="logout" type="button">退出登录</button>
    <p id="me-msg"></p>
  </section>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var guest = $("guest"), me = $("me");

  function say(el, text, kind) {
    el.textContent = text || "";
    el.className = kind || "";
  }

  async function call(path, init) {
    var res = await fetch(path, Object.assign({ credentials: "same-origin" }, init || {}));
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    return { ok: res.ok, status: res.status, data: data };
  }

  function showGuest() { guest.hidden = false; me.hidden = true; }
  function showMe(user) {
    $("me-name").textContent = user.display_name || "";
    $("me-uid").textContent = String(user.uid);
    $("me-role").textContent = user.role || "";
    $("me-email").textContent = user.email || "";
    guest.hidden = true;
    me.hidden = false;
  }

  async function refresh() {
    var r = await call("/api/auth/me");
    if (r.status === 200 && r.data.authenticated) showMe(r.data.user);
    else showGuest();
  }

  $("send").addEventListener("click", async function () {
    var email = $("email").value.trim();
    if (!email) return say($("msg"), "先填邮箱", "err");
    say($("msg"), "发送中…", "");
    var r = await call("/api/auth/email-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email })
    });
    if (!r.ok) {
      var hint = r.data.message || r.data.error || "发送失败";
      if (r.status === 429 && r.data.retry_after) hint += "（" + r.data.retry_after + " 秒后可重试）";
      return say($("msg"), hint, "err");
    }
    $("code-block").hidden = false;
    $("code").focus();
    if (r.data.debug_code) {
      $("code").value = r.data.debug_code;
      say($("msg"), "本地调试模式，验证码已自动填入：" + r.data.debug_code, "ok");
    } else {
      say($("msg"), "验证码已发送，10 分钟内有效", "ok");
    }
  });

  $("form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var email = $("email").value.trim();
    var code = $("code").value.trim();
    if (!/^\\d{6}$/.test(code)) return say($("msg"), "验证码是 6 位数字", "err");
    say($("msg"), "登录中…", "");
    var r = await call("/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email, code: code })
    });
    if (!r.ok) return say($("msg"), r.data.message || r.data.error || "登录失败", "err");
    say($("msg"), "", "");
    await refresh();
  });

  $("logout").addEventListener("click", async function () {
    var r = await call("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" } });
    if (!r.ok) return say($("me-msg"), "退出失败", "err");
    say($("me-msg"), "", "");
    await refresh();
  });

  refresh();
})();
</script>
</body>
</html>`;
}

export const loginPage: Hono<AppEnv> = new Hono<AppEnv>();

function handler(c: Context<AppEnv>): Response {
	return c.html(renderPage(Boolean(c.env.GITHUB_CLIENT_ID)), 200, {
		"cache-control": "no-store",
		"x-robots-tag": "noindex",
	});
}

loginPage.get("/login", handler);
loginPage.get("/login/", handler);
