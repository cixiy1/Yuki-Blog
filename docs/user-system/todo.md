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

### P3.6.1 补齐增删改查（2026-11-02）

上一版只有「列表 + 改状态/角色」，而且「管理员一律不可改」——站点通常只有一个
管理员，于是那一行永远锁着，看起来就是「下拉点不了」。改法是把「一律禁止」换成
一条可校验的不变式：**任何操作之后至少还有一个 active 管理员**。

- [x] `POST /api/admin/users`：管理员建号（登录名/邮箱/昵称/初始密码/角色/状态），
      复用注册的账号规则、密码策略与 `encryptPassword`（uid 参与 AAD）
- [x] `DELETE /api/admin/users/:uid`：软删除。释放账号名与邮箱（`deleted_<uid>` /
      `deleted+<uid>@deleted.invalid`），清密码与头像，`session_epoch + 1`
- [x] `PATCH` 扩展：`display_name`、`email`（改后 `email_verified_at` 清空）、
      `password`（重置并踢下线）
- [x] 守卫：不再禁改 admin / 禁提 admin；改为 `otherActiveAdmins(uid) === 0` 时拒绝
- [x] 自己那一行：角色/状态/密码仍禁（`self_forbidden`），前端不再摆一个点不动的
      下拉，改成文字 + 「锁」标记 + title 说明
- [x] 前端 `UserEditor.vue`：新建/编辑共用一个右侧抽屉，含资料、权限、重置密码、
      最近审计（中文标签）、删除（输入登录名二次确认）
- [x] 已注销行只读，详情按钮禁用；状态筛选补「已删除」
- [x] 审计新增 `admin.user.create` / `.delete` / `.profile` / `.password`，
      `detail` 白名单补 `field` / `reset` / `uid` / `role`
- [x] 验收（本地 wrangler dev + 本地 D1）：改他人昵称 200；把另一个 admin 降级 200；
      改自己角色 409；新建 201；重复登录名 409；弱密码 400；改邮箱后
      `email_verified=0`；删除后账号名/邮箱释放、再删 409；删自己 409；
      浏览器走完「新建 → 列表出现 → 详情 → 删除 → 列表消失」

## P3.7 站点设置（管理端配置全站，2026-11-02）

已完成，本地验收通过，未部署。设计与落地细节见 `site-config-design.md`。

- [x] `config/site.json` 改为分区文档（site / profile / music / friends / banner / announcement）
- [x] 六个 config 模块接覆盖层：`siteConfig` / `profileConfig` / `musicConfig` / `friendsConfig` / `backgroundWallpaper` / `announcementConfig`
- [x] `src/utils/deep-merge.ts` + `src/config/site-overrides.ts`：只合并 patch 里真实存在的键，数组整体替换
- [x] `0007_site_config_versions.sql`：发布历史表
- [x] `server/lib/site-config.ts`：嵌套白名单 `CONFIG_SPEC`（含 list 类型）、草稿/已发布读写、密钥加密存取
- [x] `server/routes/site-config.ts`：公开热字段接口 + 草稿/发布/回滚/立即应用/密钥六组端点
- [x] `server/lib/github-contents.ts`：Contents API 写文件（GET sha → PUT，冲突报 409）
- [x] `src/pages/site-defaults.json.ts`：构建期导出六分区默认值，给管理端当表单底座
- [x] 管理端 `/admin/#/settings` 九组 tab + 字段级热/冷标记 + 列表编辑器 + 状态卡 + 版本历史
- [x] 热通道：`src/utils/hot-config.ts` 运行时改 `--hue` 与 `data-wallpaper-mode`，`hueAuto` / `wallpaperModeAuto` 区分「热配置」与「访客自选」，`yb-hot-hue` 同步设置面板；管理端保存后自动 apply 热字段
- [x] 移除占位的「站点管理」页
- [x] 验收：六分区覆盖均进构建产物；接口 13 项（六分区保存、未知分区/字段、类型、越界、枚举、列表项、列表上限、立即应用、无令牌 412、公开接口只吐热字段）；浏览器 16 步（含列表增删移动、保存不丢、热色相跨刷新保持、访客自选不被覆盖）
- [ ] 发布链路需要 fine-grained PAT，未跑通真实写入；无令牌时只能「导出 JSON」手动提交
- [ ] 导航项/侧栏组件/书签导航/追番类未纳入（结构性配置，JSON 表达不清）

## P3.8 个人中心与交互补完（一部分已完成）

- [x] **账号设置独立成页**：`/me/profile/`（`src/components/user/ProfileEditor.astro`）+
      `PATCH /api/me/profile`，改昵称、头像链接、简介；账号 / 邮箱 / UID 只读展示。
      - 校验：昵称 1–32 字；头像只收 `https` 外链与以 `/` 开头的站内路径（`http` 会混合内容、
        `data:` 会把库撑大），空串即清空；简介 ≤200 字。`session_epoch` 不动。
      - `SessionUser` 补 `bio`，`/api/auth/me` 一并返回；审计动作 `user.profile.update`。
      - 入口在个人中心账号信息下方，样式与「写文章」等卡片一致。
- [x] **改密码并入同一页**：`POST /api/auth/password`（当前密码 + 新密码 + 确认框），
      改完 `session_epoch + 1` 踢掉其它设备，当前浏览器原地续票。个人中心原来那张单独的
      「修改密码」卡已删，入口只留一处；GitHub 登录、从没设过密码的，当前密码可留空。
      - ⚠️ 同一容器里放两个 form 时，submit 监听要绑在具体 form 上。绑在容器上会把密码表单的
        提交一起收走，改密与保存资料并发，后者带着旧 epoch 换回 401「请先登录」。
- [ ] 改邮箱：`email_verified_at` 清空 + 发确认信给新地址，确认前按未验证处理（登录仍可用账号名）。
      目前资料页只展示邮箱并说明「换邮箱要先验证新地址」。
- [ ] 头像上传（等媒体库 P6.1）；现在只能填链接。
- [ ] 管理端右侧抽屉改成居中弹窗：`admin/src/components/UserEditor.vue` 现在是 `position: fixed` 贴右边的面板，
      改为遮罩 + 居中卡片（宽 `min(32rem, 92vw)`，高 `max-height: 90vh` 内部滚动），Esc 与点遮罩关闭，
      关闭后焦点回到触发按钮。新建与编辑共用同一个弹窗，别做成两套。

## P4 审核与发布

- [ ] `inbox/` 目录约定与写入逻辑
- [ ] 用户级组件管理（`src/components/user/<uid>/`，import 白名单：只允许 `./`、`../` 与自己的目录）
- [ ] 页面型文章的实时预览 iframe（HTML + JS + 数据拼装，注入主题 CSS）
- [x] 审核队列 UI：列表只给标题/摘要/字数，点标题或「看正文」进 `#/review/<id>` 读全文
      （`GET /api/admin/review/:id` 返回正文与 meta，正文用 Vditor 静态预览渲染，深浅主题跟着切）
- [ ] 通过：读 `inbox/` → 写 `src/content/posts/u/<uid>/<slug>/` → 删 `inbox/` 原件 → 一次 commit
- [x] 退回：写理由、作者可见
- [x] 划词批注（`post_notes`）：审核员选中正文任意一段写建议，正文高亮并标序号，
      作者在编辑页顶部「审核意见」卡里按条看到引用与建议；通过时清空批注
      - 作者侧正文同步高亮：用 CSS Custom Highlight API（`::highlight(yb-review-note)`）给被划的
        句子染色，点一下弹出批注气泡；点卡片里的某条会滚到对应高亮。**不往 DOM 插 `<mark>`**——
        编辑器保存时读的是 DOM，插标签会被序列化进 Markdown。引用找不到时提示换个说法。
- [x] 新稿待审邮件提醒：收件人在「站点设置 → 集成 → 发信 → 管理员邮箱」配置（可填多个，
      留空回退到所有启用中的管理员与审核员账号），提交审核时异步发出，同一篇 10 分钟内不重复提醒
- [x] 作者撤回审核：待审稿在「我的文章」或编辑页直接撤回成草稿继续改，不用等退回；
      撤回同时给审核人发一封「不用再审」，并清空提醒时间戳，改完重提必发新提醒
- [x] 通过时回信给作者：审核页「通过并发布」先展开备注框（可留空），确认后异步发一封
      「已通过」到作者邮箱，备注作正文；作者没填邮箱则提示发不出去，通过本身照常完成
- [x] GitHub API 封装（token 从 secret 取，Contents API + 批量 tree 提交）
      - 单文件写走 Contents API（`putRepoFile`，发布链路在用）
      - 多文件合并走 Git Data API（`putRepoFiles`：ref → blobs → tree → commit → 移动分支），
        非快进映射成 409
- [ ] 构建状态展示（最近一次 commit 与部署结果）
- [ ] 验收：提交到线上可访问，1–3 分钟内完成

## P5 评论（第一版已完成）

**运行方式先说清楚**：评论只在 D1，**不进构建**。前端每次进文章页现拉，审核与开关改完立即生效；
只有改评论组件代码才需要重新部署。`config/site.json` 里没有评论相关配置，别往里加。

- [x] 评论表 `0011_comments.sql`：`target`（文章 slug / `guestbook` / `dynamic:<路径>`）+ `parent_id`
      一层嵌套 + 游客昵称与邮箱摘要；`0001` 里那张占位表是空的，直接 DROP 重建
- [x] 接口 `server/routes/comments.ts`：`GET /api/comments?target=`（列表 + 运行配置 + 当前访客）、
      `GET /api/comments/count?targets=`、`POST /api/comments`、`DELETE /api/comments/:id`；
      管理端 `GET/POST/DELETE /api/admin/comments*` 挂在 reviewer 权限下
- [x] 审核开关：`enabled` / `requireApproval` / `allowGuest` / `maxLength` / `rateSeconds`
      存 `settings` 的 `comments.config`，管理端改完下一次请求即生效（不走站点配置的发布通道）
- [x] 默认先发后审（发出即显示）；站长与审核员发言同样直接 approved。
      「先审后发」是可选开关，管理端打开后新评论才进 pending
- [x] 反刷：同一 IP 最小间隔（默认 20 秒）+ 每小时 20 条，复用 `rate_limits`；IP 只存 HMAC
- [x] XSS：正文存 Markdown，客户端 `marked` 解析后**按白名单重建 DOM**（不用 innerHTML，
      也不用 sanitize-html 那种 Node 向的包）。`script/img/iframe` 整棵丢弃，`href` 只放行
      `http(s)/mailto/站内路径`——`javascript:` 链接会被剥成纯文本
- [x] 文章页、留言板、说说三处接入：`Comment/index.astro` 加 `self-hosted` 分支；
      说说 iframe 用 `?path=` 拼成 `dynamic:<路径>`
- [x] `commentConfig.type` 已切到 `"self-hosted"`；想换回 giscus/twikoo 改这一行即可（要重新构建）
- [x] 管理端 `#/comments`：待审/已通过/已拒绝/全部、按 target 筛选、通过/拒绝/删除、设置弹窗
- [x] 游客凭证：游客没有 uid，评论发出去原本谁都删不掉（连他自己）。发表时服务端返回一次
      32 字节令牌，摘要存 `comments.guest_token_hash`（`0012`），原文由浏览器 localStorage 保管，
      删除时走 `x-comment-token` header 比对。
      **不用邮箱做认领**——邮箱从没核验过，填别人的地址就能接管别人的评论。
      已知限制：换设备/清缓存即失效，这是没有账号的必然代价，不做补救。
- [ ] 说说评论只跑通了代码路径，**没有真机验收**（iframe + `?path=` 那条）
- [ ] 「有人回复你」的邮件通知：游客邮箱只存摘要，发不了信；要做只能对登录用户发
- [ ] 游客评论不能编辑（只能删）；待审的那条在审核通过前自己也看不见

## P6 管理端其余模块

- [x] 用户管理（列表、新建、改资料/角色/状态、软删除）
- [ ] 组织管理
- [ ] 说说管理
- [ ] 项目管理
- [ ] 友链管理
- [ ] 媒体库（文件管理系统，见 P6.1）
- [ ] 站点配置编辑（含密钥写入，只写不回显）
- [ ] 审计日志
- [ ] 验收：每块读写正常，写操作都有审计记录

### P6.1 文件管理系统（媒体库，同 WordPress 的「媒体 → 媒体库」）

现状：图存在仓库里，不再是 D1 blob。索引是构建期快照 + GitHub tree 现拉，
上传/删除都合并成一次 commit。

- [x] 媒体库页 `/admin/#/media`：网格 + 搜索 + 按来源筛选（站点静态 / 文章内嵌），
      每项显示缩略图、文件名、格式、大小；点开详情看路径、引用写法、引用它的文章。
      未做：分页（现在 51 个文件，全量渲染不卡）、按宽高筛、显示图片尺寸
- [x] **索引文件系统**，不新建一套存储。扫 `public/assets`、`public/gallery`、
      `public/files`、`src/content/posts/images`；跳过 `public/pio`（live2d 贴图）、
      `public/admin`（构建产物）、`public/favicon`
      - [ ] D1 `media_blobs` 的历史文件还没并进列表（接口仍在，旧草稿引用不会断）
      - [ ] 外链还没登记成条目：选择器里能填，但不入库、不统计
- [x] 文件索引走构建期快照（`src/pages/api/media-index.json.ts` → `dist/api/media-index.json`），
      Worker 读快照不扫仓库；「刷新索引」走 `GET /git/trees?recursive=1` 现拉一份
- [x] 上传：拖拽 / 粘贴 / 选文件，客户端压缩后写仓库（`public/assets/uploads/<yyyy>/<mm>/`），
      多文件合并成一次提交。文件名是 `<词干>-<内容摘要8位>.<ext>`，同一张图重复传会复用
- [x] **统一选择器弹窗**（`MediaPickerDialog.vue`）：三个入口——从库选 / 上传新图 / 外链。
      已接：封面图（编辑页属性栏）、编辑器插图（工具栏「从媒体库插图」）
      - [ ] 头像、友链头像还没接：头像在 `/me/profile`（Astro 页面，要单独挂一份客户端逻辑）
- [x] 选择后回填可直接用的路径：仓库静态图给 `/assets/...`；文章内嵌图给相对路径，
      按文章所在目录深度补 `../`（子目录文章也能用）；外链原样写入
- [x] 删除：先按文件名查引用（构建快照里的 `refs`），有引用返回 409 并列出文章；
      确认后一次 commit 移除。仅管理员可删
- [ ] 验收：上传一张 → 库里出现 → 编辑器插入 → 保存后前台显示。
      本地没有可用令牌，**上传成功那条路径还没真机跑过**；其余（列表、搜索、
      选择回填、删除拦截、批量提交请求序列）都已验证

已知约束：

- GitHub Contents API 单文件上限 100 MB，单目录条目上限 1000，超出要分目录
- 上传即一次 commit，等于一次构建；批量上传必须合并成一次提交
- `raw.githubusercontent.com` 只适合当预览源，长期直出仍走站点域名的静态产物
- 图片进仓库会把仓库越撑越大，需要考虑上限与清理策略（先按 5 MB/张、2000 张两条线卡）
- 原计划用 R2 存媒体（P1 那条），改走仓库静态文件后 R2 不再是前提，可不做

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
