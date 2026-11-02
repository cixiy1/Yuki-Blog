# 用户系统 · TODO

勾选状态以实际提交为准。详细设计见 `design.md`。

## P0 文档与前置清理

- [x] 需求与设计文档落库（本目录）
- [x] 核实 slug 机制：Astro glob loader 已用 frontmatter `slug` 当 entry.id，不需要改路由
- [x] `src/content.config.ts` posts schema 补 `slug` 声明（只为 `entry.data.slug` 可读）
- [x] `.gitignore` 解开旧管理台的 6 条忽略规则
- [x] 删除 `astro.config.mjs` 里旧的 dev-only Vite 中间件
- [x] 验收：`astro check`、`biome ci ./src`、`pnpm build` 通过，文章 URL 逐条一致

## P1 Worker 运行时骨架

已完成于 `89bb9aa5`。

- [x] `server/index.ts`（Hono 入口）+ `app.ts`：`/api/*` 由 Worker 接，未命中的 API 返回 JSON 404，非 API 路径回落 `env.ASSETS.fetch`
- [x] `wrangler.jsonc` 加 `main`、`assets.binding`、`run_worker_first`、`not_found_handling: 404-page`
- [x] 建 D1 库 `yuki-blog`（`b1a82660-fba5-4586-9799-a73ce5b04ab7`），迁移在 `server/db/migrations/`
- [ ] 建 R2 桶，绑 `media.yiyu14.top`（账号未开通 R2，报 code 10042，P3 做媒体前再开）
- [x] `GET /api/health`（探 D1，不通返回 503）
- [ ] 本地三进程开发脚本（等 P3 有 Vite admin 再补，现在 `astro dev` + `wrangler dev` 够用）
- [x] 验收：`wrangler dev` 下 health 200、两个静态 JSON 内容与 dist 一致、首页与文章页字节一致、未知路径返回站点 404 页；`deploy --dry-run` 打包 81 KiB

## P2 认证

已完成（`2487d42e` 主链路、`399702b4` GitHub OAuth、登录页随第四步提交），本地验收通过，未部署。

- [x] `server/auth/` 拆成 `lib/` + `middleware/` + `routes/`（原计划的单目录会把算法、中间件、路由混在一起，P5 评论也要中间件）
- [x] 验证码生成、Resend 发送、校验（6 位、10 分钟、只存 hash、attempts 上限 5）
- [x] 会话表与 cookie 签发、校验（32 字节 token 存 sha256、30 天、Secure 按协议推导）
- [x] 角色中间件（user / reviewer / admin），401 与 403 分开
- [x] GitHub OAuth start + callback（HMAC state + cookie 绑定、只认 verified 邮箱）
- [x] 限流（用 `email_codes` 自身计数，一条 SQL 出五个额度）
- [x] 登录页：Worker 直出 `GET /login`，不进 Astro 构建；P3 admin SPA 上线后删
- [x] 验收：注册、登录、刷新保持、退出；401 / 403 分支正确；限流 429；开放重定向兜底
- [ ] 线上可用：等 Resend 域名验证与 GitHub OAuth App 配置（代码侧已就绪）

## P3 用户中心与编辑器

已完成（`a79fc02d` 骨架、`0ec9d254` 草稿接口、`b842b04e` 列表与编辑器、`48fef3ad` 媒体），本地验收通过，未部署。

- [x] `admin/` Vite + Vue 3 骨架，`base: "/admin/"`，hash 路由，产物落 `public/admin/`（不进 git）
- [x] 路由守卫与登录态注入（401 跳 `/login/?next=/admin/`，登录后跳回）
- [x] 主题跟随：tokens.css 与主站 variables.styl 对齐，共用 localStorage 的 `theme` 与 `hue`
- [x] Vditor 封装：工具栏裁剪、主题联动、上传钩子、资源自托管（只拷 lute/icons/i18n/highlight/katex）
- [x] 「我的文章」列表（全部/草稿/待审/已发布/被退 + 计数 + 状态徽标 + 被退理由）
- [x] 草稿编辑与自动保存（1.5 秒防抖 + Ctrl/Cmd+S），待审与已发布只读
- [x] 草稿图片上传：客户端压缩 → D1 `media_blobs` → `/api/media/<id>` 直出
- [x] 验收：能写能存、刷新不丢、能传图并回填、深浅色正常
- [ ] 用户级组件管理 —— 移入 P4（要写进 `src/components/user/<uid>/` 才能 import，依赖 Contents API）
- [ ] 页面型文章的实时预览 iframe —— 移入 P4（依赖发布链路）

## P3.5 账号系统重建（2026-11-02，参考 Fatfish-Study-Platform）

已完成，本地验收通过，未部署。详见 design.md 第十二节。

- [x] `0005_accounts.sql`：重建 users（account / password_enc / email_verified_at / session_epoch，status 改 pending/active/disabled/deleted），删 sessions 与 email_codes
- [x] `0006_auth_tokens.sql`：email_verification_tokens / password_reset_tokens / rate_limits + 审计索引
- [x] `server/lib/password.ts`：HKDF + AES-256-GCM，信封 `v1.<iv>.<ct>`，AAD 绑 uid，`PASSWORD_ENC_KEY_PREV` 惰性重加密
- [x] `server/lib/session.ts`：无状态 HMAC cookie，载荷只有 uid/epoch/时间戳；`__Host-` 双轨
- [x] `server/lib/ratelimit.ts`：D1 固定窗口计数，替掉进程内 Map 式的思路
- [x] `server/lib/tokens.ts` / `users.ts` / `audit.ts`：一次性 token 原子消费、用户查询、审计写入
- [x] 认证端点重写：注册 / 登录 / 登出 / 退出所有设备 / me / 验证邮箱 / 重发验证 / 忘记密码 / 重置密码 / 改密
- [x] GitHub OAuth 走三级匹配，去掉占位邮箱
- [x] 前端：登录表单换密码、账号安全块（改密 + 退出所有设备），新增注册 / 找回 / 重置 / 验证四个页面
- [x] sitemap、统计、robots 同步排除新页面
- [x] 验收：注册 202 → 激活自动登录 → 账号与邮箱两种 identifier 登录 → 错密码 401 → 未验证 403 → 禁用 403 → 第 11 次错密码 429 → 篡改 cookie 401 → 封禁后旧票失效

## P3.6 管理端用户管理 + 审计（2026-11-02）

已完成，本地验收通过，未部署。

- [x] `GET /api/admin/users`（q/role/status/page，显式列白名单，响应无 password_enc）
- [x] `GET /api/admin/users/:uid`（附最近 20 条审计）
- [x] `PATCH /api/admin/users/:uid`：禁改自己、禁改任何 admin、禁写 deleted，
      封禁时 `session_epoch + 1` 让旧 cookie 立刻失效，`WHERE status = ?` 乐观并发
- [x] `GET /api/admin/audit`（按 action 筛、分页）
- [x] 管理端 `/admin/#/users` 用户表与 `/admin/#/audit` 审计页
- [x] 验收：未登录 401 / 普通用户 403 / admin 200；改自己 409；提管理员 409；
      停用后其旧 cookie 401、重新登录 403；恢复并改角色 200；写 deleted 400；
      审计按动作筛选可用且 detail 里没有密码

## P4 审核与发布

- [ ] `inbox/` 目录约定与写入逻辑
- [ ] 用户级组件管理（`src/components/user/<uid>/`，import 白名单：只允许 `./`、`../` 与自己的目录）
- [ ] 页面型文章的实时预览 iframe（HTML + JS + 数据拼装，注入主题 CSS）
- [ ] 审核队列 UI
- [ ] 通过：读 `inbox/` → 写 `src/content/posts/u/<uid>/<slug>/` → 删 `inbox/` 原件 → 一次 commit
- [ ] 退回：写理由、作者可见
- [ ] GitHub API 封装（token 从 secret 取，Contents API + 批量 tree 提交）
- [ ] 构建状态展示（最近一次 commit 与部署结果）
- [ ] 验收：提交到线上可访问，1–3 分钟内完成

## P5 评论

- [ ] 评论表与接口（发表、列表、嵌套、删除）
- [ ] 审核开关（先审后发 / 先发后审）
- [ ] XSS 过滤（白名单）
- [ ] 文章页接入
- [ ] 留言板接入
- [ ] 说说接入
- [ ] `commentConfig` 加 `self-hosted` 类型，可切回 giscus
- [ ] 验收：三处都能发能显示，切换开关生效

## P6 管理端其余模块

- [ ] 用户管理（列表、角色、封禁）
- [ ] 组织管理
- [ ] 说说管理
- [ ] 项目管理
- [ ] 友链管理
- [ ] 媒体库
- [ ] 站点配置编辑（含密钥写入，只写不回显）
- [ ] 审计日志
- [ ] 验收：每块读写正常，写操作都有审计记录

## 待确认（阻塞对应阶段）

- [x] 评论是否也要审核 —— 做成开关：先审后发 / 先发后审，管理端可切
- [x] 审核员怎么产生 —— 管理员手动指定；组织可向管理员申请审核自己成员文章的权限（`orgs.can_review`）
- [x] 组织是协作组还是分类 —— 两者都是，但独立成页，另开维度，不复用 frontmatter 的 category
- [x] 普通用户能否用公共组件 —— 待定，等 P3 编辑器成型再定
- [x] 旧 dev 中间件删还是改 —— 已删（鉴权只比对时间戳，可伪造）
- [x] Resend 发信子域 —— `mail@yiyu14.top`，域名验证待做

## P2.5 组织与邀请（下一个阶段）

- [ ] `0003` 迁移：`org_invites` 表
- [ ] 组织 CRUD 与成员管理 API
- [ ] 邀请：发信、链接落地页、站内同意、个人中心待处理列表、撤销与过期
- [ ] 主站 `/orgs/`、`/orgs/<slug>/`，文章 frontmatter 加 `org` 字段
- [ ] 渲染改造：`PostMeta`、`CategoryBar`、`ArchivePanel`、两个索引页、SEO `article:section`
- [ ] 39 篇没有 org 的老文章兜底（不显示组织徽标即可）
