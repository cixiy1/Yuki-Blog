# 用户系统 · TODO

勾选状态以实际提交为准。详细设计见 `design.md`。

## P0 文档与 slug 归一

- [x] 需求与设计文档落库（本目录）
- [ ] `src/content.config.ts` posts schema 补 `slug`
- [ ] `src/pages/posts/[...slug].astro` 改为 `entry.data.slug || removeFileExtension(entry.id)`
- [ ] 排查其余按 `entry.id` 算地址的位置：RSS、Atom、sitemap、OG、系列、上下篇、相关推荐
- [ ] 给现有 38 篇文章补显式 `slug`（值 = 当前实际 URL 的末段）
- [ ] 验收：构建后逐条比对 URL，一个都不能变

## P1 Worker 运行时骨架

- [ ] `server/index.ts`（Hono 入口，`/api/*` 全接，其余回落 `env.ASSETS.fetch`）
- [ ] `wrangler.jsonc` 加 `main`、`assets.binding`、`run_worker_first`
- [ ] 建 D1 库，写 `server/db/schema.sql` 与迁移脚本
- [ ] 建 R2 桶，绑 `media.yiyu14.top`
- [ ] `GET /api/health`
- [ ] 本地三进程开发脚本（astro dev / wrangler dev / vite dev）
- [ ] 验收：deploy 后主站 11 个页面 200，`/api/dynamic.json` 仍是静态文件

## P2 认证

- [ ] `server/auth/` —— 验证码生成、Resend 发送、校验
- [ ] 会话表与 cookie 签发、校验
- [ ] 角色中间件（user / reviewer / admin）
- [ ] GitHub OAuth start + callback
- [ ] 限流（KV 或 D1）
- [ ] 管理端登录页
- [ ] 验收：注册、登录、刷新保持、退出；401 / 403 分支正确

## P3 用户中心与编辑器

- [ ] `admin/` Vite + Vue 3 骨架，`base: "/admin/"`，hash 路由
- [ ] 路由守卫与登录态注入
- [ ] Vditor 封装：工具栏裁剪、图片上传钩子、主题跟随
- [ ] 「我的文章」列表（草稿 / 待审 / 已发布 / 被退）
- [ ] 草稿编辑与自动保存
- [ ] 用户级组件管理（增删改、列表）
- [ ] 页面型文章：把 `ClassSchedule.astro`、todo 的组件逻辑抽成 `public/assets/js/` 小部件
- [ ] 实时预览 iframe（HTML + JS + 数据拼装，注入主题 CSS）
- [ ] 验收：能写能存能传图；组件能建能在文章里 import

## P4 审核与发布

- [ ] `inbox/` 目录约定与写入逻辑
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

- [ ] 评论是否也要审核
- [ ] 审核员怎么产生
- [ ] 组织是协作组还是分类
- [ ] 普通用户能否用公共组件
- [ ] 旧 dev 中间件删还是改
- [ ] Resend 发信子域
