# 站点配置管理（管理端）架构与交互设计

> 目标：在 `/admin/` 里配置本站信息，改完能尽快看到效果，重要改动可回滚。

## 一、硬约束

站点是 **Astro 静态构建 + Cloudflare Worker（Assets 直出）**。这条约束决定了什么能热、什么只能构建：

| 类型 | 例子 | 能否运行时改 |
| --- | --- | --- |
| 结构 | 页面开关（`/gallery/` 是否存在）、导航项数量、侧栏组件组成 | **不能**，路由与 HTML 在构建时定型 |
| 构建产物 | 字体子集、OG 图、图片格式与质量、RSS | **不能** |
| 文本 | 标题、副标题、描述、横幅文案、公告 | 能，但首屏会闪，`<meta>` 与分享卡片仍旧值 |
| 样式变量 | 主题色相、页宽 | 能，改 CSS 变量即可 |

因此「全部热更新」不成立；「全部等构建」又太慢。方案是**单一来源 + 两种生效速度**。

## 二、架构：D1 是唯一来源，git 是发布快照

```
                    ┌──────────────────────────────┐
   管理端编辑 ──────▶│ D1 settings                  │
                    │  site.config.draft           │
                    │  site.config.published       │
                    │  site.secrets (AES-GCM)      │
                    └───────┬──────────────┬───────┘
                            │              │
              热字段（文本/色相）      发布（全部字段）
                            │              │
                GET /api/site-config   写 config/site.json 进 git
                            │              │
                            ▼              ▼
                    前端覆盖层 ◀──── Cloudflare 构建（约 90 秒）
                    （改 DOM / CSS 变量）   │
                                           ▼
                                  构建产物 = 已发布值
```

**收敛性**：发布 = 把 `draft` 原样写进 `config/site.json`，同时把 `published` 更新为同一份。构建完成后，HTML 里的值与 `/api/site-config` 返回的值完全相等，覆盖层成为 no-op。所以不存在长期分叉的两套真相：

- 只热改、没发布 → D1 领先 git（覆盖层在起作用），管理端标「有 N 项未发布」
- 发布了 → 二者相等
- 手动改代码触发构建 → 构建产物回到 git 值，但 `/api/site-config` 仍返回 D1 值，覆盖层把热字段拉回 D1 值；冷字段回到 git 值（管理端会标出哪些还没发布）

**热字段清单**：主题色相、壁纸模式。其余一律「需发布」。

原本想把标题、副标题、公告这些文本也算热字段，实测后否掉了：它们进 `<title>`、RSS、分享卡片、sitemap 里的站点名，运行时改只会让「页面上的标题」和「搜索结果里的标题」长期不一致，而且首屏还会先闪旧值。色相之所以能热，是因为它在站点里只有一处消费（根节点的 `--hue`），不参与任何 SEO 与结构。

壁纸模式（`banner.mode`）能热，前提是 `displaySettingsConfig.wallpaperModeSwitchable` 为 true：构建期已经把各模式所需的资源都渲染出来（代价约 +33 KB/页），运行时切只改 `data-wallpaper-mode` 与导航栏透明模式，不重建 DOM。关掉这个开关时页面上只有当前模式那一套，`hot-config.ts` 会直接跳过，避免切到不存在的结构。

> 2026-11-03 补：壁纸模式起初只走发布通道，站主在管理端切了下拉却看不到任何反应（保存的是草稿，要发布 + 等构建）。现在它进 `HOT_FIELDS`，管理端保存时自动调 `/apply`，刷新首页即生效；发布仍然要做，只是作用变成「让新访客首屏就用新模式渲染」，不再是生效的前提。

## 三、数据模型

复用 `0001` 里一直空着的 `settings(key, value_json, updated_by, updated_at)`：

| key | 内容 |
| --- | --- |
| `site.config.draft` | 全量可配字段的 JSON（管理端编辑的即时结果） |
| `site.config.published` | 最近一次发布时的快照，`/api/site-config` 与构建都读它 |
| `site.secrets` | 加密后的密钥集合（`v1.<iv>.<ct>` 信封，AAD 绑 `site-secrets`） |

新增 `0007_site_config_versions.sql`：

```sql
CREATE TABLE IF NOT EXISTS site_config_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot     TEXT NOT NULL,          -- 发布时的全量 JSON
  note         TEXT,                   -- 提交信息
  commit_sha   TEXT,                   -- 写 git 后的 sha，失败为 NULL
  published_by INTEGER,
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

密钥与配置分开存，理由：配置是可公开的（会进 git），密钥永远不进 git、不回显、不进审计 detail。

## 四、API

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/site-config` | 公开 | 只返回热字段，`cache-control: public, max-age=10` |
| GET | `/api/admin/site-config` | admin | `{ draft, published, dirty, versions }` |
| PUT | `/api/admin/site-config` | admin | 存草稿，返回 `{ dirty: true }` |
| POST | `/api/admin/site-config/apply` | admin | **只把热字段盖到 published**，不写 git、不等构建 |
| POST | `/api/admin/site-config/publish` | admin | 写 git → 更新 published → 记版本 |
| POST | `/api/admin/site-config/rollback` | admin | 把某版本灌回 draft（不直接发布） |
| GET | `/api/admin/secrets` | admin | 只返回「是否已配置 + 更新时间 + 末四位」 |
| PUT | `/api/admin/secrets` | admin | 写入（AES-GCM），值不回显 |

发布流程（`publish`）：

1. 读 draft，做一次服务端校验（枚举值、数字范围、URL 格式）
2. 用 `github.ts` 的 Contents API 写 `config/site.json`（GET 拿 sha → PUT 带 sha，冲突则报 409 让用户重试）
3. 更新 `site.config.published` 与 draft 一致
4. 写 `site_config_versions`（含 commit sha）+ 审计
5. 返回 `{ commit_sha, build: "triggered" }`；管理端轮询 `/api/admin/site-config/build-status?sha=` 拿部署状态

没有 PAT 时 `publish` 返回 412 `github_token_missing`，管理端把「发布」换成「导出 JSON」并给出配置入口。

## 五、页面信息架构

侧栏「管理」组里的「站点管理」换成「站点设置」，进去是二级 tab（内容区顶部，横向可滚）：

```
站点设置
├─ 概览      站点快照、未发布变更数、版本历史（可回滚）
├─ 基本信息   标题 / 副标题 / 描述 / 关键词 / 站点 URL / 语言 / 时区 / 建站日 / 版权 / 备案
├─ 外观      色相 / 默认模式 / 页宽 / 卡片边框 / 分类栏样式 / 标签样式 / 列表布局 / 网格参数
├─ 页面      页面开关（相册·追番·项目·友链·书签·动态·留言板·打赏）/ 分类栏 / 每页文章数
├─ 文章      分享 / 相关 / 随机 / 上次编辑 / 沉浸阅读 / OG 图 / RSS 模式 / 图片格式与质量
├─ 首页      横幅（图·文案·高度）/ 公告 / 特效
├─ 个人资料   昵称 / 头像 / 简介 / 社交链接 / 打赏方式
├─ 音乐      播放模式 / 歌单（增删排序 / 封面预览）
├─ 友链      分组与条目（增删排序）
└─ 集成      密钥（GitHub PAT / Resend / OAuth）、构建触发、连接自检
```

「导航项增删排序」「侧栏组件开关」「书签导航」「追番/VNDB/MAL」属于第二批（结构性强、半年动一次）。

## 六、交互

### 顶部操作条（每个 tab 都有，固定在内容区顶部）

```
站点设置 / 外观                     ● 未保存 3 处   [预览变更]  [保存草稿]  [发布]
```

- `● 未保存 N 处`：与 `draft` 比；已保存但未发布的另外显示 `待发布 N 项`
- `预览变更`：右侧抽屉，按分组列出 `字段：旧值 → 新值`
- `发布`：确认抽屉 + 影响提示 + 可编辑提交信息 + 进度条（写仓库 → 构建中 → 已上线）
- 若改动全在热字段：`发布` 旁边多一个 `立即应用`（只写 `published` 不写 git，覆盖层秒生效，标「未落盘」）

### 字段级

- 每个字段右侧标记 `热`（绿点）或 `需发布`（灰点），hover 出处一句解释
- 改动后字段左侧出现 2px 主题色竖线，tab 标题出现圆点
- 数字用 stepper，布尔用开关，枚举用分段控件（≤4 项）或下拉，颜色用色相环滑块 + 实时色块
- 危险字段（`站点 URL`、`语言`、`时区`）标黄，改动后二次确认再保存

### 分组页内布局

左侧表单（`max-w-[42rem]`），右侧「实时预览」粘性卡片（仅外观/首页/个人资料有）：
外观页预览卡展示一个迷你文章卡与按钮，用当前色相实时渲染；首页页预览横幅文案；个人资料预览侧栏卡片。

### 离开与冲突

- 有未保存改动时切 tab / 关标签：`confirm` 拦一次
- 保存时带 `updated_at` 做乐观并发：他人改过则 409，提示「已有人保存，刷新看最新」

## 七、安全

- 密钥用与密码同一套 `AES-256-GCM`（HKDF 派生，AAD `yb-secret:v1:<key名>`），根密钥 `SECRET_ENC_KEY` 只在环境变量
- 密钥永不回显，只返回 `已配置 / 未配置` + 更新时间 + 末四位
- 写密钥、发布、回滚都进审计（`admin.settings.*`），detail 里不留密文与明文
- `/api/site-config` 只暴露热字段白名单，避免整份配置被爬

## 八、分阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| S1 | 合并层（`config/site.json` 覆盖 `src/config/*`）+ 设置页骨架（概览/基本信息/外观）+ D1 草稿 + 保存草稿 + diff 抽屉 | 改标题存草稿，导出 JSON 手动提交后构建，线上标题变化 |
| S2 | 密钥页 + GitHub Contents 写入 + 一键发布 + 版本历史与回滚 | 后台填 PAT → 发布 → 90 秒后线上生效 → 回滚回上一版 |
| S3 | 页面/文章/首页/个人资料四组字段 + 热字段覆盖层 + 构建状态轮询 | 关掉「相册」页发布后 `/gallery/` 404、导航项消失 |
| S4 | 音乐/友链列表编辑器 + 结构项（导航增删排序） | 加一首歌、拖一个友链顺序，发布后生效 |

## 九、落地细节（S1/S2 已实现部分见 git）

- `config/site.json` 默认不存在（视为空对象），首次发布时创建
- `src/config/overrides.ts` 负责读它并做深合并，缺字段一律用代码里的默认值
- 管理端 schema 单一来源：`admin/src/lib/settings-schema.ts` 描述分组、字段、类型、默认值、是否热；服务端只做白名单校验，不重复描述表单
- 构建期把 `published` 注入 `<script id="site-config-published" type="application/json">`，覆盖层以它为初值，保证无闪烁

---

## 十、落地实况（2026-11-02）

上面是方案；这一节记实际做出来的样子与过程中改掉的判断。

### 配置文档按「配置文件」分命名空间

`config/site.json` 不是一份扁平对象，而是一份带分区的文档：

```json
{
  "_comment": "给人看的，不参与合并",
  "site":         { "title": "...", "pages": { "gallery": true } },
  "profile":      { "name": "...", "links": [ ... ] },
  "music":        { "local": { "playlist": [ ... ] } },
  "friends":      { "page": { ... }, "links": [ ... ] },
  "banner":       { "common": { "homeText": { ... } } },
  "announcement": { "content": "..." }
}
```

一个分区对应一个 config 模块，各取各的：

| 分区 | 消费方 | 接入方式 |
| --- | --- | --- |
| `site` | `src/config/siteConfig.ts` | `applySiteOverrides()` |
| `profile` | `src/config/profileConfig.ts` | `applyNamespace("profile", base)` |
| `music` | `src/config/musicConfig.ts` | 同上 |
| `friends` | `src/config/friendsConfig.ts` | `page` 深合并、`links` 整体替换 |
| `banner` | `src/config/backgroundWallpaper.ts` | 同上（只覆盖白名单字段） |
| `announcement` | `src/config/announcementConfig.ts` | 同上 |

`mergeConfig`（`src/utils/deep-merge.ts`）的规则：只合并 patch 里真实存在的键、数组整体替换、类型对不上以默认值为准。所以「删掉一首歌」在 JSON 里表现为整个 `playlist` 少一项，而不是留个空位。

### 数据流（与第二节的差异）

- 公开接口 `/api/site-config` 的返回体也是分区的：`{ config: { site: { themeColor: { hue } } } }`
- 管理端页面的「底座」是构建期生成的 `/site-defaults.json`（`src/pages/site-defaults.json.ts`），六分区全导出。没有它，草稿里没改过的输入框就是空的，看起来像配置丢了
- 表单 = 默认值 ← 已发布 ← 草稿 三层叠加，**每层都要深拷贝**：`merge` 是浅拷贝，patch 为空时子对象会和 base 共享引用，导致「改表单」等于「改已发布值」，差异恒为 0，发布按钮永远灰着（踩过）
- 保存时只提交**与已发布值不同的字段**（`collectPatch()`），不整份提交。否则默认值会被固化进仓库，以后改代码里的默认值就盖不动了
- 导出 JSON 同理，只导补丁，并补回 `_comment`

### 立即应用（热通道）的实现要点

`src/utils/hot-config.ts` 拉 `/api/site-config`，拿到与构建值不同的值就改 DOM：色相改根节点 `--hue`，壁纸模式调 `applyWallpaperModeToDocument()`。色相有三处必须一起做，少一处就失效：

1. **判据不能是「localStorage 里有没有 hue」**。设置面板挂载时自己的 `$effect` 会跑一次 `setHue()`，把当前值落盘，所以每个访客的键都存在，等于永远认为他调过。改成两个参照排除自动写入：等于构建值 → 面板写的默认值；等于 `hueAuto` → 我们上次写的。剩下的才是访客真拖过滑块
2. **应用后要更新 `#config-carrier` 的 `data-hue` 并派发 `yb-hot-hue`**。面板的 `hue` 状态是挂载时读的，早于接口返回，不同步的话它下一次 `setHue` 会把色相按回旧值
3. **不调 `setHue()`**，直接改 CSS 变量。否则会把站主的一次调整永久锁进访客浏览器

壁纸模式复用同一套思路，两个实现细节：

- **「我们写的」要有记录**：应用后同时写 `wallpaperMode` 与 `wallpaperModeAuto`。访客之后在设置面板手动切，只写前者，于是 `wallpaperMode !== wallpaperModeAuto` 就是他自己的选择，不再覆盖
- **存量数据要认作「没有选择」**：这段逻辑上线前，访客浏览器里只有 `wallpaperMode`，没有 `wallpaperModeAuto`，分不清是面板落的默认值还是他手选的。此时按「站主配置优先」处理一次——否则站主改完模式，自己（和所有点过切换的访客）永远看不到变化，问题原样复现
- 切换用 `applyWallpaperModeToDocument(mode, false)`，不带过渡动画：首屏已经渲染完，这里是「纠正」不是「切换」

接口的 `cache-control` 从 60 秒降到 10 秒：60 秒意味着「立即应用」之后刚刷新的人拿到的是旧响应，看着像没生效。

### 服务端校验

`server/lib/site-config.ts` 的 `CONFIG_SPEC` 是嵌套白名单，支持 `string / number / bool / str[] / enum / list（对象数组）/ obj`。未知分区、未知字段、类型不符、越界、枚举外、列表超上限全部 400 并返回逐条 `issues`，错误信息带完整路径（例如 `friends.links[1].title 应该是字符串`）。

### 页面

侧栏「管理」下的「站点设置」（原「站点管理」占位页已删），九个 tab：基本信息 / 外观 / 页面 / 文章页 / 首页 / 个人资料 / 音乐 / 友链 / 集成。

- 字段左侧：绿点 = 保存即对访客生效（热字段），灰点 = 需发布
- 改动过的字段下方出现「未保存」小字；有热字段待生效时右侧「状态」卡出现「立即应用热字段」按钮
- **保存草稿后自动 `/apply` 一次**：热字段当场生效，站长不必再点一次按钮；通知文案区分「已生效」与「仍需发布」
- 列表型字段（社交链接、歌单、友链）每行一张小卡：行标题取 `itemTitle` 那一列，右上角 ↑ ↓ 删除，下方按 `auto-fit` 排布行内字段
- 右侧常驻「状态」（未保存 / 待发布 + 变更明细）与「版本历史」（可回滚）
- 发布失败若是「没配令牌」，错误信息直接指路「集成」页

### 未做 / 已知限制

- 发布链路（写 git）需要 fine-grained PAT，**本轮没跑通完整链路**：无令牌时返回 412，只验证了「导出 JSON 手动提交」这条退路
- 没有 `build-status` 轮询接口，发布后只能等 90 秒自己看
- 变更预览是右侧列表，不是抽屉式的左右对比；tab 上的「未保存」圆点也没做
- 导航项、侧栏组件、书签导航、追番/VNDB/MAL 仍未纳入：它们改的是路由与组件清单，在 JSON 里表达不清
