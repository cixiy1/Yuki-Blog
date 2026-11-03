# 集成配置：GitHub 登录与发信

管理端 **站点设置 → 集成** 里能配三样东西，都存进 D1 的 `settings` 表（密钥经 AES-GCM 加密，只回显末四位），不写进仓库，也不出现在审计里。

- **GitHub 登录**：第三方登录用，需要 Client ID + Client Secret
- **发信**：注册验证、找回密码用，三选一（关闭 / Resend / SMTP）
- **发布用令牌**：管理端改仓库文章、发布稿件用的 PAT

前两个经常被混为一谈，实际互不相干：登录走 OAuth App，发布走 Personal Access Token。

---

## 一、GitHub 登录

### 建 OAuth App

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App
2. 填：
   - Application name：随便，会显示在授权页
   - Homepage URL：`https://yiyu14.top`
   - **Authorization callback URL**：`https://yiyu14.top/api/auth/github/callback`
3. 建完页面上的 **Client ID** 与 **Client Secret** 各抄一份

回调地址必须一字不差：`http` 与 `https` 算两个，末尾多了斜杠也算不同。本地调试要在同一个 OAuth App 里再加一条 `http://localhost:8787/api/auth/github/callback`（GitHub 允许一个应用登记多条回调）。

### 填进管理端

站点设置 → 集成 → GitHub 登录，把 Client ID、Client Secret 分别保存。两项都齐了登录页的 GitHub 按钮才会真的跳转；缺任意一项，点按钮会回到登录页并提示「GitHub 登录尚未配置」。

### 优先级

管理端填的值优先，环境变量（`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`）只在数据库里没配时兜底。两者都不配也不影响密码登录。

---

## 二、发信

管理端 → 站点设置 → 集成 → 发信。三种通道：

| 通道 | 适用 | 需要什么 |
|---|---|---|
| 关闭 | 本地开发 | 无。验证信只写 Worker 日志 |
| Resend | 有自己的域名，愿意配 DNS | API Key（`re_` 开头）+ 已验证的发件域名 |
| SMTP | 用现成邮箱发（QQ / 163 / 企业邮） | 主机、端口、加密方式、账号、授权码 |

### Resend

1. Resend 后台 → Domains → 添加 `yiyu14.top`
2. 按提示在 DNS 加记录（通常是 `MX` + `TXT` 的 SPF + `resend._domainkey` 的 DKIM）
3. 等域名状态变成 Verified
4. API Keys → 新建，权限选 Sending access，复制 `re_` 开头的 Key
5. 管理端：通道选 Resend、发件人填 `Yuki Blog <mail@yiyu14.top>`、Key 粘进去保存
6. 点「发送测试邮件」

**域名没验证会怎样**：Resend 只允许发给账号自己的注册邮箱，写给别人的信会被拒，接口会返回「Resend 在域名验证前只能发给账号自己的邮箱」。这是最常见的卡点。

### SMTP

以 QQ 邮箱为例：

1. QQ 邮箱 → 设置 → 账号 → 开启 POP3/SMTP 服务 → 生成**授权码**
2. 管理端填：主机 `smtp.qq.com`、端口 `465`、加密方式 `SSL`、用户名是完整邮箱、密码填授权码（不是登录密码）
3. 保存后点「发送测试邮件」

几条硬规矩：

- **授权码 ≠ 密码**。QQ / 163 / Gmail 都要单独生成，填登录密码一定失败（`535`）。
- **发件人地址要和登录账号同域**。QQ、foxmail、163、126 这类服务对 `MAIL FROM` 卡得死，写别名会被拒信（`501` / `553`）。
- **端口与加密要配对**：465 → SSL，587 → STARTTLS。选错会在 TLS 握手阶段失败。
- Worker 走 `cloudflare:sockets` 直连，出站 465/587 不需要额外白名单；「不加密」只给内网中继和本地调试用。

### 测试邮件

卡片底部的「发送测试邮件」发给当前登录管理员的邮箱（账号里没填邮箱就没法测，接口会拦下）。邮件正文里写明当前通道、主机和发件人，一眼能看出配置有没有生效。

失败时下方直接给原因，常见几种：

| 提示 | 原因 |
|---|---|
| 服务器拒绝登录 | 密码用了登录密码而不是授权码，或账号没开 SMTP 服务 |
| TLS 握手失败 | 加密方式和端口不匹配 |
| 连接超时 | 主机名错，或该主机不放通出站端口 |
| API Key 不对 | Resend Key 失效或权限不足 |
| 域名还没验证 | Resend 域名状态不是 Verified |

### 邮箱验证流程

配置好通道之后：

1. 注册 → 系统发验证信（24 小时有效）
2. 未验证的账号登录会被挡下，页面提供「重新发送」入口，走 `POST /api/auth/resend-verification`，按邮箱维度限流
3. 找回密码走 `POST /api/auth/forgot-password`，1 小时有效

本地开发想看验证链接而不发信：`.dev.vars` 里设 `AUTH_DEBUG=1` 且不填任何发信密钥，接口响应里会带 `debug_link`。这个开关只认回环地址，生产配了也不生效。

---

## 三、发布用令牌

GitHub → Settings → Developer settings → **Personal access tokens** → Fine-grained tokens → 新建：

- Repository access：只选 `cixiy1/Yuki-blog`
- Permissions：Contents 选 **Read and write**（其余全不勾）
- 生成后粘到「发布用令牌」

令牌只读（没勾写权限）时，接口会返回 `Resource not accessible by personal access token`，发布直接 412。诊断办法是 `POST /repos/{owner}/{repo}/git/blobs`——它能过才算真有写权限，`GET /repos` 里的 `permissions.push` 不可信。
