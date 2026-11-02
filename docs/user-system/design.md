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
| 邮件 | Resend |
| 预览 | 编辑器右侧实时 iframe，真跑 HTML / JS / 数据 |
| 组件 | 文章专属组件与正文同目录；用户级可复用组件放该用户自己的目录 |

## 四、现状约束

动手前必须先认这些事实，否则会踩坑。

1. **站点是纯静态的。** `astro.config.mjs` 里 `process.env.CF_WORKERS` 决定是否挂 `@astrojs/cloudflare` 适配器，而全仓库（含全部提交历史、两个 workflow、package.json、无 `.env` / `.dev.vars`）没有任何地方设置它。现在产物是 `dist/index.html` + `dist/api/*.json`，没有 `dist/client`、`dist/server`、`_worker.js`。

2. **没有任何服务端能力。** 0 个 POST 接口，无 D1 / KV / R2 绑定，无 `src/middleware.ts`，无 `Astro.request` / `cookies` 用法。

3. **`slug` 字段是摆设。** 38 篇文章里多篇写了 `slug:`，但 `src/content.config.ts` 的 posts schema 里没有这个字段，zod 静默丢弃。实际 URL 由 `src/pages/posts/[...slug].astro:57` 的 `removeFileExtension(entry.id)` 决定，即文件路径。所以现有一切正常是「文件名恰好等于想要的地址」的巧合。按用户分目录之后地址会变成 `/posts/u/12/foo/`，必须先做 slug 归一。

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
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "yuki-blog", "database_id": "..." }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "yuki-blog-media" }]
}
```

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

frontmatter 的 `slug` 会成为唯一 URL 来源，目录只决定仓库里的组织方式。做法：

1. `src/content.config.ts` 给 posts schema 补 `slug: z.string().optional()`
2. `[...slug].astro` 的 `getStaticPaths` 改成 `entry.data.slug || removeFileExtension(entry.id)`
3. 同步改 RSS、Atom、sitemap、OG 图、系列导航、上下篇、相关推荐里所有按 id 算地址的地方

老文章回落到文件名，**URL 一个都不会变**。

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
| GET/PATCH | `/api/admin/users`、`/api/admin/users/:uid` | 用户列表 / 改角色、封禁 |
| GET/POST | `/api/admin/orgs` | 组织管理 |
| GET/PUT | `/api/admin/settings` | 站点配置（含密钥写入，只写不回显） |
| GET | `/api/admin/audit` | 审计日志 |
| POST | `/api/admin/build-status` | 查最近一次构建状态 |

## 九、阶段计划

每阶段独立可验、独立可停。全部落在 `feat/user-system`。

### P0 文档与 slug 归一

- 本目录文档
- schema 补 `slug`，改 `[...slug].astro` 及所有按 id 算地址的地方（约 8 个文件）
- 验收：`astro check` 通过，`pnpm build` 后逐条比对 38 篇文章的 URL 与改动前一致；`dist/rss.xml`、`sitemap-0.xml`、`og/` 路径不变

### P1 Worker 运行时骨架

- `server/` 目录（Hono 入口）、`wrangler.jsonc` 升级、D1 建库与迁移脚本
- 只加一个 `GET /api/health` 返回 `{ ok, db, time }`
- 验收：`wrangler dev` 下 `/api/health` 通；`wrangler deploy` 后主站 11 个页面仍 200，`/api/dynamic.json` 仍是静态文件

### P2 认证

- 验证码发送（Resend）、验证、会话 cookie、角色中间件
- GitHub OAuth
- 验收：能注册、能登录、刷新保持、退出清 session；未登录访问受限接口返回 401；普通用户访问管理员接口返回 403

### P3 用户中心与编辑器

- admin SPA 骨架、路由守卫、Vditor 封装（工具栏、上传钩子、主题联动）
- 「我的文章」列表与草稿编辑、用户组件管理
- 验证码登录页
- 验收：能建草稿、能存、刷新不丢；能上传图片并回填；能建用户级组件并在文章里 import

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
- **CSRF**：所有写操作校验 `Origin`/`Referer` 同源；关键操作再带一次性 nonce。
- **限流**：验证码按邮箱与 IP 双维度（10 分钟 3 次、每日 10 次）；登录失败、评论、上传各自独立额度。
- **密码**：不存密码，无相关风险面。
- **上传**：只收白名单 MIME（jpg/png/webp/avif/gif/webp/svg 需净化/mp3/mp4/pdf），单文件上限 20MB，SVG 一律重写过滤。
- **XSS**：评论走严格白名单过滤（无 `script`/`style`/`on*`/`javascript:`）；文章正文本身是作者可控，视为可信，但用户投稿在审核时才发布。
- **密钥**：GitHub token、Resend key、OAuth secret 存在 Worker secret（`wrangler secret put`），管理端只能写入不能读取回显，库里只存掩码。
- **后台暴露**：`/admin` 加 `noindex`、`robots.txt` 排除、`statsConfig.excludePaths` 排除、无 sitemap 条目。
- **审计**：所有管理端写操作落 `audit_log`。

## 十一、待确认

1. **审核粒度**：目前设的是「文章发布需审核」。评论是否也要审核？还是只做事后删除？
2. **谁能成为审核员**：管理员手动指定，还是管理员 + 组织 owner 自动有权限？
3. **组织的用途**：是「多人协作的写作组」，还是只是给文章分类？这决定 `orgs` 表要不要做邀请流程。
4. **普通用户能否直接用 `src/components/widget/` 里的公共组件**（如 `ClassSchedule`）？如果能，课表数据谁维护？
5. **旧 dev 中间件**：`astro.config.mjs` 里那两个 `/api/admin/write-config`、`/api/admin/upload` 是旧管理台留下的，鉴权可伪造、无调用方。删掉还是改造成 Worker 接口？
6. **`Resend` 域名**：发信要用 `yiyu14.top` 的哪个子域（如 `noreply@yiyu14.top`），需要先在 Resend 验证 DNS。
