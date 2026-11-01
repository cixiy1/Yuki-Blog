# 雪穗博客

[yiyu14.top](https://yiyu14.top) 的源码。主题是 Firefly，Astro 静态站，推 `master` 触发线上构建。

## 技术栈

- Astro 7.3 静态输出，Svelte 5 跑交互组件
- Tailwind CSS 4
- TypeScript 6，Biome 负责格式化与 lint
- Pagefind 全文搜索、Shiki 代码高亮、KaTeX / Mermaid 渲染

## 本地运行

要求 Node >= 22，包管理器 pnpm（`preinstall` 会拦下 npm / yarn）。

```bash
pnpm install
pnpm dev         # http://localhost:4321
pnpm build       # 产出 dist/：LQIP、VNDB 封面、Astro 构建、字体子集、Pagefind
pnpm preview     # 预览构建结果
pnpm check       # astro check，内容与类型校验
pnpm type-check  # tsc --noEmit
pnpm lint        # biome 检查并修
```

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/config/` | 站点配置，全部 TypeScript，经 `index.ts` 统一导出 |
| `src/content/posts/` | 文章 |
| `src/content/dynamic/` | 说说 |
| `src/content/projects/` | 项目展示页数据 |
| `src/content/spec/` | 关于、留言板等特殊页 |
| `src/pages/` | 路由 |
| `src/components/` | 组件，按 `layout/`、`widget/`、`pages/` 等领域分目录 |
| `src/plugins/` | 自定义 remark / rehype 插件（Mermaid、PlantUML、KaTeX、GitHub 卡片等） |
| `src/styles/` | 全局样式与主题变量 |
| `public/` | 图片、音乐、字体等直接对外文件 |
| `scripts/` | 构建期脚本（LQIP、字体子集、新建文章等） |
| `cms/` | 本地内容管理界面 |

配置文件对照：`siteConfig.ts` 站点基础信息与主题色、`sidebarConfig.ts` 侧栏布局、`backgroundWallpaper.ts` 横幅与壁纸、`musicConfig.ts` 播放器、`profileConfig.ts` 侧栏名片、`navBarConfig.ts` 导航、`friendsConfig.ts` 友链、`statsConfig.ts` 访问统计。

## 写文章

文件放 `src/content/posts/`，`.md` 或 `.mdx` 都行，URL 默认取文件名。也可以 `pnpm new-post <文件名>` 建骨架。

```yaml
---
title: 标题
published: 2026-11-01
description: 首页摘要
tags: [Astro, 前端]
category: 技术
---

正文。
```

常用 frontmatter：

| 字段 | 说明 |
| --- | --- |
| `title` | 必填 |
| `published` | 必填，发布日期 |
| `updated` | 更新日期 |
| `description` | 摘要，也进 SEO |
| `tags` | 标签数组 |
| `category` | 单个分类 |
| `draft` | 草稿，不发布 |
| `pinned` | 置顶 |
| `image` | 封面图 |
| `comment` | 是否开启评论 |
| `password` / `passwordHint` | 加密文章与密码提示 |
| `series` / `seriesOrder` | 系列名与系列内顺序 |
| `sourceLink` | 转载原文链接，转载必填 |
| `licenseName` / `licenseUrl` | 自定义许可 |
| `provenance` | 来源标注：本人手写 / 代笔 / 代笔后本人改写 |

### 来源标注

文章和说说都能标出这段文字是谁写的。

```yaml
provenance: handwritten        # 本人手写
provenance: ghostwritten       # 代笔
provenance: co-written         # 代笔 + 本人改写

provenance:                    # 带详情
  kind: ghostwritten
  model: DeepSeek-V4.1-Flash   # 哪个模型
  agent: WorkBuddy             # 哪个 agent
  note: 大纲模型给，正文我重写    # 可选，悬浮提示里显示
```

显示文案、图标、配色，以及出现位置（文章页、封面横幅、列表卡片、说说）都在 `src/config/provenanceConfig.ts`。新增一种标注只要在 `kinds` 里加一项，frontmatter 直接写这个键名；`showUntagged` 控制没写该字段的文章是否显示「来源未标注」。

说说放 `src/content/dynamic/`，字段是 `published`、`pinned`、`location`。项目页数据放 `src/content/projects/`，字段是 `title`、`published`、`order`、`description`、`image`、`tags`、`link`、`status`。

## 部署

推 `master` 即由 Cloudflare Pages 构建上线，约一分钟。仓库里的 `vercel.json`、`wrangler.jsonc` 是主题自带的备选部署配置，当前不用。

## 其他

- `AGENTS.md`：仓库结构与编码约定，给 AI 编码工具读的
- `stats-proxy-worker.README.md`：统计代理 Worker 的部署步骤
- `cms/`：本地内容管理界面，`cd cms && pnpm dev` 后访问 4322 端口
