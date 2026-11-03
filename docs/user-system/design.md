# 用户系统与管理端 · 设计

2026-11-02 起在分支 `feat/user-system` 上开发。不合 main、不推 main 就不上线。

## 一、目标

给 yiyu14.top 加一套自带后端的用户系统。访客可注册，站长账号为管理员，管理员有独立入口进管理端。普通用户能在站内写文章、投稿，审核通过后发布。

四块范围：

1. 认证与角色
2. 内容工作流：投稿 → 审核 → 发布
3. 编辑器：Vditor 二次开发，含页面型文章
4. 管理端：Vue 3 SPA，仅管理员可进

## 二、非目标

- 多站点 / 多租户
- 付费、会员
- 站内私信
- 改变主站的渲染模型（对外仍是静态 HTML）

## 三、已定决策

| 项 | 决定 |
| --- | --- |
| 注册 | 开放注册。邮箱验证码 + GitHub OAuth 两条路，管理端可分别开关 |
| 登录 | 邮箱验证码即登录，库里不存密码 |
| 角色 | 普通用户 / 审核员 / 管理员 |
| 后端 | 项目内自有，不接 BaaS：同域 Cloudflare Worker + D1 |
| 后端语言 | TypeScript（Hono） |
| 管理端 | Vue 3 + Vite 独立 SPA，产物挂 `/admin/` |
| 编辑器 | Vditor 二次开发。普通用户的发文入口与管理端用同一个编辑组件 |
| 内容写回 | GitHub API 提交，内容留在 git |
| 投稿 | 草稿进 `inbox/`，审核通过后由后端移动到 `src/content/posts/` |
| 媒体 | 三种并存：外链、R2 上传、提交进 git |
| 邮件 | Resend，发件地址 `mail@yiyu14.top`（不用 noreply 一类冷地址） |
| 组织 | 独立成页，作为与 category 平行的新维度，不复用 frontmatter 的分类字符串；一个用户可同时属于多个组织 |
| 邀请 | 组织管理端发起 → 系统邮件发链接 → 站内自行同意；个人中心也有一份待处理列表；允许邀请未注册邮箱，对方注册后可见 |
| 预览 | 编辑器右侧实时 iframe，真跑 HTML / JS / 数据 |
| 组件 | 文章专属组件与正文同目录；用户级可复用组件放该用户自己的目录 |

## 四、现状约束

动手前必须先认这些事实，否则会踩坑。

1. **站点是纯静态的。** `astro.config.mjs` 里 `process.env.CF_WORKERS` 决定是否挂 `@astrojs/cloudflare` 适配器，而全仓库（含全部提交历史、两个 workflow、package.json、无 `.env` / `.dev.vars`）没有任何地方设置它。现在产物是 `dist/index.html` + `dist/api/*.json`，没有 `dist/client`、`dist/server`、`_worker.js`。

2. **没有任何服务端能力。** 0 个 POST 接口，无 D1 / KV / R2 绑定，无 `src/middleware.ts`，无 `Astro.request` / `cookies` 用法。

3. **`slug` 已经生效，但 schema 里没有声明。** Astro 的 `glob` loader（`node_modules/astro/dist/content/loaders/glob.js` 的 `generateIdDefault`）在生成 `entry.id` 时会优先用 frontmatter 的 `slug`；没写才用路径分段（每段过 `github-slugger`，并去掉尾部 `/index`）。所以 `新生组队匹配.md` 的地址是 `/posts/dorm-match/`，靠的就是 frontmatter。**推论**：文章地址由 frontmatter `slug` 决定，与所在目录无关——用户文章放进 `posts/u/12/` 只要写了 `slug` 就不影响地址。但 schema 里没有声明 `slug` 字段，`entry.data.slug` 是 undefined，需要读它的代码读不到，所以要在 schema 补一行声明（不影响 id 生成）。

4. **`.gitignore` 锁着旧管理台的路径**：`src/pages/admin.astro`、`src/pages/api/admin/`、`src/components/admin/`、`src/utils/admin/`、`src/config/adminConfig.ts`、`src/types/adminConfig.ts`。新建这些路径不会被 git 追踪，要先解开。

5. **`trailingSlash: "always"`。** 无扩展名路径的 POST 会被 308。API 不走 Astro 路由就没有这个问题，但路径写法要统一。

6. **`src/pages/[...page].astro` 现在是分页路由**，`getStaticPaths` 只生成 `/2/`、`/3/`。一旦切 `output: 'server'` 它会变成吃掉所有未匹配路径的真通配，`Astro.props.page` 为 undefined 直接抛错。`posts/[...slug]`、`gallery/[album]`、`projects/[slug]`、`og/[...slug]` 同理。这是不切 SSR 的第二个理由（第一个是构建链）。

7. **构建链后处理依赖 `dist/` 位置。** `scripts/site-root.ts` 的 `resolveSiteRoot()` 用 `existsSync("dist/client") ? "dist/client" : "dist"` 定位产物，`run-pagefind`、`minify-inline-scripts`、`prune-pio-assets`、`subset-fonts` 全走它。只要不改产物结构，这四步不受影响。

8. **内容里的 `.astro` 组件只能在构建期跑。** 浏览器里没有 Astro 运行时，所以页面型文章要做编辑页实时预览，必须把组件逻辑改成独立 JS 小部件。

## 五、架构

主站不动。`wrangler.jsonc` 从「纯静态资源」升级成「Worker + Static Assets」：

```jsonc
{
  "name": "yuki-blog",
  "main": "./server/index.ts",
  "compatibility_date": "2025-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page",
    "run_worker_first": ["/api", "/api/*", "!/api/dynamic.json", "!/api/allPostMeta.json"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "yuki-blog",
      "database_id": "b1a82660-fba5-4586-9799-a73ce5b04ab7",
      "migrations_dir": "server/db/migrations"
    }
  ]
  // r2_buckets 待账号开通 R2 后加，媒体上线前补
}
```

`run_worker_first` 里的 `!` 取反优先级高于通配，作用是把两个静态 JSON 端点留在 Assets 直出：它们本来就是 Astro 构建产物，不该因为 Worker 故障跟着挂。`not_found_handling: "404-page"` 让未匹配路径返回 `dist/404.html`（默认值 `none` 会返回 Cloudflare 自己的 404 页）。

请求分流：

- `/api/*` → Worker（Hono）处理
- 其余 → 静态资源直出，不经 Worker

这样 pagefind 索引、字体子集化、内联脚本压缩、分页路由全部保持原状；Worker 挂了也不影响文章页返回。

同域不另开子域：cookie 同站、无 CORS、入口统一。媒体走 `media.yiyu14.top` 绑 R2 公开桶，图片直连不经 Worker。

本地开发：`astro dev`（4400 端口看主站）+ `wrangler dev`（8787 端口跑 Worker 与 D1）+ `vite dev` 跑 admin（proxy `/api` 到 8787）。

## 六、内容与组件模型

### 目录结构

```
inbox/                                  投稿收件箱，不进 Astro 构建
  u/<uid>/<slug>/index.mdx
  u/<uid>/<slug>/Chart.astro            文章专属组件
  u/<uid>/<slug>/data.json
  org/<orgId>/<slug>/...

src/content/posts/
  ...现有文章保持不变
  u/<uid>/<slug>/index.mdx              审核通过后移到这里
  u/<uid>/<slug>/Chart.astro

src/components/user/<uid>/              该用户的可复用组件
  StatCard.astro
```

`glob` 的 pattern 是 `**/*.{md,mdx}`，同目录的 `.astro`、`.json` 不会被当成内容条目，可以安全共存。

### 组件三级

| 级别 | 位置 | 谁能改 | 引用方式 |
| --- | --- | --- | --- |
| 文章专属 | 与正文同一目录 | 文章作者 | `import Chart from "./Chart.astro"` |
| 用户级复用 | `src/components/user/<uid>/` | 该用户自己 | `import StatCard from "@/components/user/12/StatCard.astro"` |
| 站点公共 | `src/components/widget/` | 仅管理员 | 现状不变 |

上传组件时后端校验 import 路径：只允许 `./`、`../` 与 `@/components/user/<自己的 uid>/`，拒绝外部 URL、`node:` 内置模块、`@/config/` 之类的站点内部路径。

### URL 与 slug

地址的唯一来源是 frontmatter 的 `slug`，目录只决定仓库里的组织方式。这不是新约定，是 Astro 本来就这么工作（`glob` loader 用 `data.slug` 当 `entry.id`）。

规则：

1. **所有用户文章必须显式写 `slug`。** 审核通过时由后端写入，值取作者创建时定的地址。
2. 不写 `slug` 的文章回落到路径分段。中文文件名会被 `github-slugger` 转成中文串并做百分号编码（如 `/posts/新生组队匹配/`），所以别依赖回落。
3. `src/content.config.ts` 的 schema 补 `slug: z.string().optional().default("")`，让 `entry.data.slug` 可读（id 生成用的是原始 frontmatter，不受 schema 影响）。
4. 现有 38 篇文章里写了 `slug` 的已经生效、没写的沿用文件名，**这次不需要动任何文章**。

后端在发布时必须校验 `slug`：只允许 `[a-z0-9-]`、长度 2–60、全站唯一（查 `posts` 表）。

## 七、数据模型

D1 表清单（字段略去 `created_at` 这类通用列）：

| 表 | 用途 | 关键字段 |
| --- | --- | --- |
| `users` | 账号 | `id`、`uid`（短数字，用于目录名）、`email`、`email_verified`、`role`、`status`、`display_name`、`avatar_url`、`last_login_at` |
| `oauth_accounts` | 第三方绑定 | `provider`、`provider_uid`、`user_id`、`access_token_enc` |
| `sessions` | 会话 | `token_hash`、`user_id`、`expires_at`、`ip_hash`、`user_agent` |
| `email_codes` | 验证码 | `email`、`code_hash`、`purpose`、`expires_at`、`consumed_at`、`attempts` |
| `orgs` | 组织 | `id`、`slug`、`name`、`owner_uid` |
| `org_members` | 组织成员 | `org_id`、`uid`、`role` |
| `posts` | 文章元数据（正文在 git） | `id`、`uid`、`org_id`、`repo_path`、`slug`、`title`、`status`、`commit_sha`、`published_at`、`reviewer_uid`、`review_note` |
| `post_revisions` | 版本记录 | `post_id`、`commit_sha`、`message` |
| `comments` | 评论 | `id`、`post_slug`、`uid`、`parent_id`、`content_html`、`status`、`ip_hash` |
| `media` | 媒体 | `id`、`uid`、`kind`、`storage`(git/r2/external)、`url`、`bytes`、`sha256` |
| `settings` | 站点设置 | `key`、`value_json`、`updated_by` |
| `audit_log` | 操作审计 | `actor_uid`、`action`、`target`、`detail_json` |

待建（组织与邀请阶段，`0003` 迁移）：

| 表 | 用途 | 关键字段 |
| --- | --- | --- |
| `org_invites` | 组织邀请 | `org_id`、`inviter_uid`、`email`、`role`、`token_hash`、`expires_at`、`accepted_at`、`accepted_uid`、`revoked_at` |

索引：`users(email)` 唯一、`users(uid)` 唯一、`sessions(token_hash)` 唯一、`posts(slug)` 唯一、`posts(status, updated_at)`、`comments(post_slug, status)`、`email_codes(email, purpose)`。

加密与脱敏：`oauth_accounts.access_token_enc` 用 AES-256-GCM（密钥在 Worker secret）；评论与登录记录的 IP 只存 `sha256(ip + salt)`，不存原文。

## 八、API 路由

统一前缀 `/api`，不带尾斜杠。四组权限：

**公开**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/email-code` | 发验证码（限流 + 人机校验） |
| POST | `/api/auth/verify` | 验证码换会话 |
| GET | `/api/auth/github/start` | GitHub OAuth 跳转 |
| GET | `/api/auth/github/callback` | OAuth 回调 |
| GET | `/api/auth/me` | 当前登录态 |
| GET | `/api/comments` | 某篇已发布文章的可见评论 |
| GET | `/api/public/settings` | 公开设置（站点开关等） |

**登录用户**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/logout` | 注销 |
| GET/POST | `/api/me/posts` | 我的文章列表 / 新建 |
| GET/PUT/DELETE | `/api/me/posts/:id` | 读 / 存 / 删草稿 |
| POST | `/api/me/posts/:id/submit` | 提交审核 |
| GET/POST | `/api/me/components` | 我的可复用组件 |
| POST | `/api/media` | 上传（R2 或 git） |
| POST | `/api/comments` | 发评论 |

**审核员**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/review/queue` | 待审列表 |
| POST | `/api/review/:id/approve` | 通过 → 移动文件 + 提交 + 发布 |
| POST | `/api/review/:id/reject` | 退回并附理由 |
| POST | `/api/comments/:id/moderate` | 评论审核 |

**管理员**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST/PATCH/DELETE | `/api/admin/users`、`/api/admin/users/:uid` | 列表 / 新建 / 改资料、角色、状态、密码 / 软删除 |
| GET/POST | `/api/admin/orgs` | 组织管理 |
| GET/PUT | `/api/admin/settings` | 站点配置（含密钥写入，只写不回显） |
| GET | `/api/admin/audit` | 审计日志 |
| POST | `/api/admin/build-status` | 查最近一次构建状态 |

### P2 实际落地的端点

| 方法 | 路径 | 权限 | 备注 |
| --- | --- | --- | --- |
| POST | `/api/auth/email-code` | 公开 | 发码；五重限流（邮箱 60s/10min/1d、IP 1h/1d） |
| POST | `/api/auth/verify` | 公开 | 码换会话，邮箱首次出现即注册 |
| GET | `/api/auth/me` | 登录 | 未登录返回 401 + `authenticated:false` |
| POST | `/api/auth/logout` | 公开（幂等） | 没带 cookie 也返回 200，不给探测面 |
| GET | `/api/auth/github/start` | 公开 | 未配 client id 返回 503 |
| GET | `/api/auth/github/callback` | 公开 | 失败一律 302 `/login?error=...` |
| GET | `/api/admin/ping` | admin | 401/403 分支的验收锚点 |

错误体统一 `{ error, message, field?, ... }`。`/api/*` 响应全部 `Cache-Control: no-store`。

## 九、阶段计划

每阶段独立可验、独立可停。全部落在 `feat/user-system`。

### P0 文档与前置清理

- 本目录文档
- schema 补 `slug` 声明（只为让 `entry.data.slug` 可读，不改 id 生成，URL 零变化）
- `.gitignore` 解开旧管理台的 6 条忽略规则
- 删除 `astro.config.mjs` 里旧的 dev-only Vite 中间件（`/api/admin/write-config`、`/api/admin/upload`）
- 验收：`astro check`、`biome ci ./src`、`pnpm build` 通过；构建后文章 URL 与改动前逐条一致

### P1 Worker 运行时骨架

已完成于 `89bb9aa5`，本地验收全部通过，未部署。

- `server/` 目录（Hono 入口）、`wrangler.jsonc` 升级、D1 建库与迁移脚本
- 只加一个 `GET /api/health` 返回 `{ ok, db, time }`
- 验收：`wrangler dev` 下 `/api/health` 通；`wrangler deploy --dry-run` 打包 81 KiB（gzip 20 KiB）；主站页面与两个静态 JSON 与改动前逐字节一致；`pnpm build` 产物 22 篇文章 / 385 个文件不变
- 遗留：R2 未开通（账号报 code 10042），`r2_buckets` 绑定留到媒体阶段；远端 D1 未 apply 迁移，等 P2 真要用再跑 `db:migrate:remote`

### P2 认证

已完成（`2487d42e` 主链路 + `399702b4` GitHub + 登录页），本地验收通过，未部署。

- 验证码发送（Resend）、验证、会话 cookie、角色中间件
- GitHub OAuth
- 验收：能注册、能登录、刷新保持、退出清 session；未登录访问受限接口返回 401；普通用户访问管理员接口返回 403
- 落地细节见第八节「P2 实际落地的端点」。登录页由 Worker 直出 `GET /login`，不占 Astro 构建；P3 的 admin SPA 上线后删掉
- 遗留：Resend 域名与 GitHub OAuth App 要用户自己配，代码侧已就绪；`access_token` 本轮不落库

### P3 用户中心与编辑器

已完成（`a79fc02d` 骨架 + `0ec9d254` 草稿接口 + `b842b04e` 列表与编辑器 + `48fef3ad` 媒体），本地验收通过，未部署。

- admin SPA 骨架：`admin/` 作为 pnpm workspace 成员独立管依赖（vue / vite 不进主站），Vite `base: "/admin/"`、hash 路由，产物出到 `public/admin/` 再由 `astro build` 拷进 `dist/`（产物不进 git）
- 路由守卫：进页面先调 `/api/auth/me`，401 整页跳 `/login/?next=/admin/`，登录成功后由登录页跳回
- 主题跟随：`admin/src/styles/tokens.css` 与主站 `variables.styl` 逐条对齐，`--hue` 与深浅色读同一份 localStorage
- 「我的文章」：四态过滤、状态徽标、被退理由、提交/撤回/删除
- 编辑器：Vditor 即时渲染，1.5 秒防抖自动保存 + Ctrl/⌘+S，待审与已发布只读
- 媒体：草稿图片存 D1 `media_blobs`，`/api/media/<id>` 直出，客户端先压再传
- 验收：能建草稿、能存、刷新不丢；能上传图片并回填；深浅色两套正常

遗留（转入 P4）：

- **用户级组件管理不做在 P3**。组件要写进 `src/components/user/<uid>/` 才能在文章里 import，而写仓库要 Contents API 与 PAT，本来就是 P4 的地基；先在 D1 里存一份没有意义——不能 import 就等于不可用。等 P4 一并做，届时连同草稿正文、媒体一起写进 git
- 页面型文章的实时预览 iframe（HTML + JS + 数据拼装）同样依赖发布链路，挪到 P4

### P3 实际落地的端点

| 方法 | 路径 | 权限 | 备注 |
| --- | --- | --- | --- |
| GET | `/api/me/posts` | 登录 | 自己名下文章，按更新时间倒序，上限 200 |
| POST | `/api/me/posts` | 登录 | 建草稿，slug 不传则给 `draft-xxxxxx` |
| GET | `/api/me/posts/:id` | 登录 | 带正文与 meta |
| PUT | `/api/me/posts/:id` | 登录 | 只允许 draft/rejected，否则 409 |
| DELETE | `/api/me/posts/:id` | 登录 | 同上 |
| POST | `/api/me/posts/:id/submit` | 登录 | 置 pending，响应里带 `git.written=false` 如实说明还没写仓库 |
| POST | `/api/me/posts/:id/withdraw` | 登录 | pending → draft |
| POST | `/api/media` | 登录 | base64 JSON，png/jpeg/webp/gif/avif，≤900KB |
| GET | `/api/media/:id` | 公开 | `Cache-Control: public, max-age=31536000, immutable` |

草稿正文落 D1 的 `posts.body`，与「正文在 git」不冲突：git 里的是已发布文章，草稿每 1.5 秒自动保存一次，走 GitHub API 会产生大量无意义提交。`posts.meta_json` 存 frontmatter 里 title/summary/tags/cover 之外的字段（category、series、password 等），原样透传，构建时再由 schema 校验。

### P4 审核与发布

- 收件箱、审核队列、审核通过后的 GitHub 提交（移动文件 + 写 slug + 触发构建）
- 预览 iframe（HTML / JS / 数据三段拼装）
- 验收：提交 → 审核 → 1–3 分钟后线上可访问；URL 与 frontmatter 的 slug 一致

### P5 评论

- 自建评论替代 giscus：发表、嵌套、审核、限流、XSS 过滤
- 文章页、留言板、说说三处接入
- 验收：三处都能发能显示；`commentConfig` 可切回 giscus

### P6 管理端其余

- 用户 / 组织 / 说说 / 项目 / 友链 / 媒体库 / 站点配置 / 审计日志
- 验收：每块都能读能改，改完有审计记录

## 十、安全清单

- **构建期代码风险**：`.astro` 在构建时编译执行，等同任意代码。所以用户组件只能在审核通过后进入 `src/content/posts/`；`inbox/` 里的组件不参与构建。Cloudflare 构建环境不放任何密钥。
- **import 白名单**：见第六节。
- **会话 cookie**：`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`、30 天过期；会话表存 token 的 SHA-256，不存原文。
- **CSRF**：写操作校验 `Origin` 同源；不带 `Origin` 的请求放行（curl、服务端调用），浏览器发起的跨站 POST 一定带 `Origin`。不能用 Hono 自带的 `csrf()`——它只拦表单类 content-type，本站写接口全是 JSON，会被直接放过。
- **限流**：验证码按邮箱与 IP 双维度——邮箱 60 秒冷却、10 分钟 3 次、每日 10 次；IP 每小时 20 次、每日 60 次。用 `email_codes` 自身计数，不另建表。计数与 INSERT 之间无锁，并发下会超发约等于并发数，属已知偏差。
- **密码**：不存密码，无相关风险面。
- **上传**：只收白名单 MIME（jpg/png/webp/avif/gif/webp/svg 需净化/mp3/mp4/pdf），单文件上限 20MB，SVG 一律重写过滤。
- **XSS**：评论走严格白名单过滤（无 `script`/`style`/`on*`/`javascript:`）；文章正文本身是作者可控，视为可信，但用户投稿在审核时才发布。
- **密钥**：GitHub token、Resend key、OAuth secret 存在 Worker secret（`wrangler secret put`），管理端只能写入不能读取回显，库里只存掩码。
- **后台暴露**：`/admin` 加 `noindex`、`robots.txt` 排除、`statsConfig.excludePaths` 排除、无 sitemap 条目。
- **审计**：所有管理端写操作落 `audit_log`。

## 十一、已定与待确认

已定（2026-11-02）：

1. **评论审核**：做成开关，管理端可切「先审后发 / 先发后审」。
2. **审核员**：管理员手动指定；组织可向管理员申请审核自己成员文章的权限（`orgs.can_review`）。
3. **组织的用途**：既是成员协作单元，也是分类维度，但独立成页（`/orgs/`、`/orgs/<slug>/`），不复用 frontmatter 的 `category` 字符串。一个用户可属于多个组织。
4. **邀请**：组织管理端发起，系统邮件发链接；对方可在站内同意，个人中心也有待处理列表。允许邀请未注册邮箱，注册后自动可见。
5. **旧 dev 中间件**：已删（鉴权只比对时间戳，可伪造）。
6. **发信地址**：`mail@yiyu14.top`，需在 Resend 验证 `yiyu14.top` 的 DNS。

仍未定：

- **普通用户能否直接用 `src/components/widget/` 里的公共组件**（如 `ClassSchedule`）？如果能，课表数据谁维护？
- **组织是用邀请制还是也允许申请加入**？邀请已定，申请加入是否需要？
- **组织的分类维度与现有 category 如何共存**：文章可同时挂 org 与 category，前端两个入口是否都要出现在导航？

---

## 十二、账号系统重建（P3.5，2026-11-02）

> 本节**取代**第七、八节里关于认证的描述。原「邮箱验证码登录、不存密码」方案已下线，
> 参考 `cixiy1/Fatfish-Study-Platform` 的账号模型重做：账号 + 密码 + 邮件激活 + 找回密码。

### 为什么改

验证码登录只适合「只读 + 偶尔发帖」的轻量场景。这个站要长成有作者、有审核、有组织的地方，
需要长期稳定的身份（登录名）、可找回的凭据、可封禁可下线的能力。密码体系麻烦，但这些它都能给。

### 决定性取舍

| 议题 | 结论 | 代价 / 说明 |
| --- | --- | --- |
| 密码存储 | **AES-256-GCM 可逆加密**（不是哈希） | 见下节风险说明；这是产品决策，不是安全最佳实践 |
| 会话 | **无状态 HMAC 签名 cookie**，不留会话表 | 单设备登出不彻底；全量失效靠 `users.session_epoch` |
| 每请求成本 | `loadSession` 每个 `/api/*` 查一次 `users`（uid 唯一索引） | 用一次索引读换「改角色/封禁立刻生效」 |
| 登出入口 | 单设备（删 cookie）、全部设备（epoch+1） | 前者对已流出的票无效力，后者才是硬失效 |
| 会话时效 | 不勾记住我 12 小时 + 会话 cookie；勾了 30 天 | 不做滑动续期，GET 不写 cookie |
| 限流 | D1 `rate_limits` 固定窗口计数 | Worker 无进程内 Map；边界处最多 2 倍突发 |

### 密码存储的风险与缓解（必读）

**性质**：可解密意味着「拿到密钥 = 拿到全部明文密码」。这与哈希有本质区别，
任何安全评审都会先拍这一条。写在这里是为了让后来的人知道这是**知情选择**，不是疏漏。

| 泄露组合 | 后果 | 缓解 |
| --- | --- | --- |
| 只有 D1 泄露（备份外流、误导出、注入） | 密码安全（密文无密钥解不开） | 密钥只在 Worker secret，库里没有任何派生材料 |
| 只有密钥泄露（env 外流、代码执行） | 也拿不到历史密码（没有密文） | 密钥不放 `wrangler.jsonc` 的 vars、不打日志 |
| 两者同时泄露 | 全部明文密码 | 不提供任何解密端点；`password_enc` 不进 API / 日志 / 审计；登录页提示「别复用重要密码」 |
| 用户在别处用同一密码 | 连带外站 | 只能靠提示；这也是「不该存可逆密码」的根本理由 |

**减少损害的具体做法**：

- 信封格式 `v1.<iv>.<ct>`，AAD 绑 `yb-pw:v1:<uid>`——把 A 行的密文搬到 B 行，解密直接失败
- 密钥 `PASSWORD_ENC_KEY`（hex 32 字节）经 HKDF-SHA256 派生，salt/info 与 `SESSION_SECRET` 做域分隔
- 轮换：`PASSWORD_ENC_KEY_PREV` 解出来的密码在登录时**惰性用新密钥重写**，用户无感
- 版本前缀留好位：将来若要改回哈希，登录成功后按 `version !== "v2"` 渐进重写即可，不需要一次性迁移

### 数据模型变化（0005 / 0006）

`users` 重建后：`account`（唯一、登录名）、`password_enc`（NULL = 纯 OAuth 账号）、
`password_updated_at`、`email_verified_at`、`session_epoch`；
`status` 改为 `pending / active / disabled / deleted`（原 `suspended` → `disabled`，`active` 但没验证过 → `pending`）；
`role` 默认值显式写成 `'user'`（参考实现这里是 `'admin'`，一次漏写字段就是提权）。

删表：`sessions`（改无状态 cookie）、`email_codes`（验证码链路下线）。
新表：`email_verification_tokens`（24h）、`password_reset_tokens`（1h）、`rate_limits`（固定窗口计数）。
两张 token 表都**只存 sha256**，明文只在邮件链接里出现一次。

⚠️ `0005` 含重建表的破坏性语句，**不可重复执行**，幂等性由 `d1_migrations` 保证；
本地要从零重来：`rm -rf .wrangler/state && pnpm db:migrate:local`。

### 端点（全部 `/api`，写操作一律 `sameOriginGuard` + `requireJsonBody`）

| 方法 | 路径 | 权限 | 关键行为 |
| --- | --- | --- | --- |
| POST | `/auth/register` | 公开 | **恒 202**；邮箱已存在只发「你已有账号」提醒，不建号 |
| POST | `/auth/login` | 公开 | 账号或邮箱 + 密码；错密码统一 401；只有状态不对才 403 |
| POST | `/auth/logout` | 公开 | 幂等，删 cookie |
| POST | `/auth/logout-all` | 登录 | `session_epoch + 1` |
| GET | `/auth/me` | 公开 | 未登录 401 + `authenticated:false` |
| POST | `/auth/verify-email` | 公开 | **POST 消费 token**（不用 GET，避免邮件扫描器烧掉链接），成功后自动登录 |
| POST | `/auth/resend-verification` | 公开 | 恒 202，只对 `pending` 真发信 |
| POST | `/auth/forgot-password` | 公开 | 恒 202，只对存在且设过密码的发信，1 小时有效 |
| POST | `/auth/reset-password` | 公开 | 消费 token → 改密 → 补验证 → `epoch+1`；**不自动登录** |
| POST | `/auth/password` | 登录 | 改密，当前浏览器自动续票，其它设备失效 |
| GET | `/auth/github/start`、`/callback` | 公开 | 三级匹配：绑定表 → 同邮箱并号 → 新建；不拿占位邮箱凑数 |

限流桶：`register:ip` 5/1h、`register:email` 1/10min、`login:ip` 30/15min、`login:id` 10/15min、
`verify:resend` 1/10min、`reset:email` 3/1h、`reset:ip` 10/1h、`notice:email` 1/1h。登录成功清空 `login:*`。

### 页面

`/login/`（账号或邮箱 + 密码 + 记住我 + 注册/忘记密码入口）、`/register/`、`/forgot-password/`、
`/reset-password/?token=`、`/verify/?token=`。全部 `noindex`、不进 sitemap 与统计；
涉及 token 的三个页面加 `no-referrer` 并在用完后抹掉 query。

### 已知偏差

- **没配 `RESEND_API_KEY` 时注册会 202 但发不出信**，账号停在 `pending` 无法登录。
  本地靠 `AUTH_DEBUG=1` 的 `debug_link`；生产必须先配好 Resend 再开注册
- **管理员角色不能在界面里增删**（只能改普通用户 / 审核员），防止误封锁死站点；需要时走 `wrangler d1 execute`
- `pending` 僵尸账号不清理（没有 Cron Trigger）
- 老的 `yb_session` cookie 在本次上线后全部失效，所有人需重新登录
