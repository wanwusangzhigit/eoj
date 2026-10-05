# OJ System

<p align="center">
  <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/wanwusangzhigit/eoj/ci.yml?branch=main" />
  <img alt="License" src="https://img.shields.io/badge/license-Custom%20protocol%20based%20on%20MIT-8A2BE2" />
  <img alt="Language" src="https://img.shields.io/badge/language-TypeScript-blue" />
  <img alt="Frontend" src="https://img.shields.io/badge/frontend-React%2019-61dafb" />
  <img alt="Backend" src="https://img.shields.io/badge/backend-Hono-orange" />
  <img alt="Database" src="https://img.shields.io/badge/database-Cloudflare%20D1-ff69b4" />
  <img alt="Judge" src="https://img.shields.io/badge/judge-nsjail%20sandbox-brightgreen" />
  <img alt="Website" src="https://img.shields.io/badge/website-oj.wanwusangzhi.top-blue" />
</p>

<p align="center">
  <img alt="GitHub stars" src="https://img.shields.io/github/stars/wanwusangzhigit/eoj?style=social" />
  <img alt="GitHub forks" src="https://img.shields.io/github/forks/wanwusangzhigit/eoj?style=social" />
  <img alt="GitHub watchers" src="https://img.shields.io/github/watchers/wanwusangzhigit/eoj?style=social" />
</p>

基于 **Cloudflare Workers + GitHub Actions** 的现代在线判题系统（Online Judge），覆盖题目管理、用户认证、提交评测、竞赛、讨论、题单、后台管理与可选广告位配置。

## 说明

本项目同一份代码同时支持 **服务端渲染（SSR，默认开启）** 与 **客户端渲染（CSR，可配置）** 两种模式，统一在 `main` 分支维护，功能完全等价。SSR 适配层本身是「SSR 可选」的双模式内核——`useSSRPage()` 在无 SSR 数据时返回 `null`，页面自动退化成 CSR；`renderSSR()` 失败也会静默回退到 SPA 壳子，任意环节挂掉都不会白屏。切换部署模式只需调整 `backend/wrangler.toml` 的 `[assets]` 配置（`run_worker_first` 与 `not_found_handling` 两行），无需改动业务代码。

## ✨ 功能特性

### 核心评测
- **题目管理** — 多语言支持(Python / C++ / Java / JS / C / Go / Rust)、自定义 Special Judge(7 种语言)、 GitHub 仓库托管测试数据、难度分级与标签树
- **提交评测** — 异步判题(GitHub Actions + nsjail 沙箱)、支持 ACM/ICPC、OI、IOI 三种赛制,实时状态推送(SSE)
- **打榜与评分** — 类 CF Elo 积分系统、自动 Rating 调整、排行榜、奖牌色阶

### 社区互动
- **竞赛系统** — 报名制 / 公开制、虚拟赛、封榜、OI/ICPC/IOI 评分、Excel 导出、SVG 排行榜快照
- **团队空间** — 团队内题目集 / 公告 / 讨论 / 比赛 / 成员管理 / 内部分组
- **题单与训练计划** — 题单合集、训练计划进度跟踪、个人题单收藏
- **讨论与题解** — 富文本 Markdown、代码高亮、AT-Ping、点赞、举报、审查制度
- **博客系统** — 用户博客、关注 / 粉丝、动态 feed、RSS 输出

### 用户中心
- **认证** — GitHub OAuth、CpOAuth、注册邀请、邮件验证、密码强度校验
- **个人主页** — 解题热力图、提交日历、最长连胜、标签雷达、个性签名、自定义头像
- **通知中心** — 评论 / 点赞 / 提到 / 系统通知、邮件订阅
- **私信** — 一对一加密对话、未读提醒
- **代码模板** — 用户私有 / 公开代码模板库、按语言分类

### 管理后台
- **权限组** — 6 个系统预置组(`比赛审核`、`题目审核`、`题单审核`、`工单审核`、`上传审核`、`超级管理员`) + 自定义组,细粒度权限分配
- **审计日志** — 全量敏感操作审计、IP / 设备指纹脱敏哈希、可封禁 IP / 设备
- **站点设置** — 注册开关、邮件后缀限制、广告位、自定义页面、友情链接
- **公告与页脚** — 站点公告中心、可配置页脚链接
- **工单系统** — 用户反馈工单流转

### 可选广告
- 通过后台配置 Google AdSense Client ID 与多个广告位,首页 / 题目页 / 排行榜页等位置可挂载广告位

### 工程特性
- **SSR / CSR 双模** — 默认服务端渲染(SSR),可一键切换客户端渲染(CSR),仅改 `wrangler.toml` 两行配置,业务代码无需变更
- **多主题** — 内置三种视觉风格:`default`(暗色大圆角)、`classic`(经典双栏)、`flat`(扁平直角),用户可自定义强调色 / 圆角 / 字体
- **i18n** — 中文 / 英文双语,1695 个翻译键全部对齐
- **结构化日志** — 统一 `trace_id` 贯穿请求链路,生产环境脱敏输出
- **Cloudflare 原生** — D1(SQLite)、R2(对象存储)、Workers KV(缓存)、Send Email 全部使用边缘服务,零服务器成本

## 🛠 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端框架 | **React 19** + **Vite 6** | 同步双模式渲染(SSR + CSR) |
| 前端语言 | **TypeScript 5** | 全量类型,严格模式 |
| 前端样式 | 原生 CSS + CSS Variables | 三主题切换、用户自定义主题变量 |
| 后端框架 | **Hono** | Cloudflare Workers 原生 |
| 后端语言 | **TypeScript 5** | 类型安全的 Hono 路由 |
| 数据库 | **Cloudflare D1** | 边缘 SQLite,57 个迁移 |
| 对象存储 | **Cloudflare R2** | 上传文件存储 |
| 缓存层 | **Workers KV** | 限流、配置缓存 |
| 邮件服务 | **Cloudflare Email Routing** | 注册 / 重置密码邮件 |
| 判题引擎 | **GitHub Actions** + **nsjail** | 异步沙箱判题,7 种语言 |
| 部署平台 | **Cloudflare Workers** | 全球边缘节点,零冷启动 |
| CI/CD | **GitHub Actions** | 自动测试、构建、部署 |
| 认证方案 | **JWT** + **GitHub OAuth** | httpOnly Cookie 携带 Token |
| 字体渲染 | KaTeX + highlight.js + DOMPurify | 数学公式 / 代码高亮 / XSS 防护 |

## 🎨 主题

本仓库提供四种前端视觉风格，可通过 `frontend/config.yaml` 中的 `site.theme` 字段切换：

- **`default`**（默认）— 暗色为主，大圆角（10px），靛蓝强调色，全宽导航栏
- **`classic`** — 经典双栏布局，50px 顶栏 + 240px 左侧边栏，9 级难度色板，3-4px 小圆角
- **`flat`** — 极简扁平设计，蓝色主调 `#5f9fd6`，完全直角（border-radius: 0），浅灰背景
- **`aurora`** — 极光风格，深空蓝底 + 靛紫青三色极光渐变，全高侧边栏（支持折叠成 72px 图标栏）+ 玻璃态顶栏，大圆角（12-20px）+ 柔和辉光，深浅双色板

## 📄 License

本项目许可证是基于 MIT 的自定义许可证。

> **特别提醒**：如果您使用本项目盈利，您需要在产品上线/发布之日起 30 个工作日内通知 `13818403352@163.com`，谢谢。

## 🚀 部署指南

### 前置要求

- Node.js >= 18
- [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
- [GitHub 账号](https://github.com)（用于 OAuth 和评测引擎）
- Wrangler CLI：`npm install -g wrangler`

### 第一步：创建 Cloudflare D1 数据库

```bash
# 登录 Cloudflare
wrangler login

# 创建 D1 数据库
wrangler d1 create oj-database
```

执行后会输出 `database_id`，记录下来。

### 第二步：配置 wrangler.toml

编辑 `backend/wrangler.toml`，填入你的配置：

```toml
name = "oj-backend"
main = "src/index.ts"
compatibility_date = "2024-01-01"
account_id = "你的 Cloudflare Account ID"

[[d1_databases]]
binding = "DB"
database_name = "oj-database"
database_id = "上一步获取的 database_id"

[assets]
directory = "./public"
binding = "ASSETS"
not_found_handling = "single-page-application"

[vars]
GITHUB_CLIENT_ID = "你的 GitHub OAuth Client ID"
GITHUB_CLIENT_SECRET = "你的 GitHub OAuth Client Secret"
CPOAUTH_CLIENT_ID = "你的 CpOAuth Client ID（可选）"
CPOAUTH_CLIENT_SECRET = "你的 CpOAuth Client Secret（可选）"
JWT_SECRET = "用 openssl rand -base64 32 生成的密钥"
CALLBACK_SECRET = "用 openssl rand -base64 32 生成的密钥"
GITHUB_TOKEN = "你的 GitHub PAT（需 repo 权限，用于触发评测）"
JUDGE_REPO = "your-username/oj-judge"
FRONTEND_URL = "https://你的域名"
REGISTRATION_OPEN = "true"
```

> **安全提示**：敏感信息（如 `GITHUB_CLIENT_SECRET`、`JWT_SECRET`）建议使用 `wrangler secret put` 设置，而非明文写在 wrangler.toml 中。

### 第三步：执行数据库迁移

```bash
cd backend
npx wrangler d1 migrations apply oj-database --remote
```

此命令会自动检测 `migrations/` 目录下未应用的迁移文件并按顺序执行。

> **注意**：迁移文件必须按编号顺序存放在 `migrations/` 目录中，Wrangler 会自动跟踪已应用的迁移。

### 第四步：创建 GitHub OAuth App

前往 [GitHub Developer Settings](https://github.com/settings/developers) 创建 OAuth App：

| 字段 | 值 |
|------|-----|
| Application name | OJ System |
| Homepage URL | `https://你的域名` |
| Authorization callback URL | `https://你的域名/api/v1/auth/github/callback` |

记录 **Client ID** 和 **Client Secret**，填入 wrangler.toml。

### 第五步：配置站点自定义（可选）

编辑 `frontend/config.yaml`：

```yaml
site:
  name: "My OJ"              # 站点名称
  short_name: "MyOJ"          # 站点简称
  description: "My Online Judge"
  icon: "default"             # "default" 使用内置图标，或填入图标 URL
  favicon: "/favicon.svg"

footer:
  enabled: true
  text: ""                    # 自定义页脚文本（支持 HTML），为空则显示 © 年份 站点名
  links:                      # 页脚链接
    - name: "GitHub"
      url: "https://github.com/your-org"

login:
  hero_title: ""              # 登录页大标题，为空使用默认
  hero_subtitle: ""           # 登录页副标题，为空使用默认
  show_github: true           # 是否显示 GitHub 登录按钮
  show_cpoauth: true          # 是否显示 CpOAuth 登录按钮

home:
  title: ""                   # 首页标题，为空使用默认
```

### 第六步：构建前端

```bash
cd frontend
npm install
npm run build:site
```

此命令会：
1. 编译 TypeScript 并构建前端
2. 将 `dist/` 内容自动复制到 `backend/public/`

### 第七步：部署后端

```bash
cd backend
npm install
npx wrangler deploy --config wrangler.toml
```

部署完成后，访问 Worker URL 即可看到完整站点。

### 第八步：配置评测仓库

1. 在 GitHub 创建私有仓库（如 `your-username/oj-judge`）
2. 将评测工作流和脚本推送到该仓库
3. 在仓库 **Settings > Secrets and variables > Actions** 中添加：

| Secret | 值 |
|--------|-----|
| `WORKER_API` | Worker 完整 URL（如 `https://oj.your-domain.com`） |
| `CALLBACK_SECRET` | 与 wrangler.toml 中的 `CALLBACK_SECRET` 一致 |

4. 确保 wrangler.toml 中的 `JUDGE_REPO` 指向该仓库

### 第九步：初始化管理员

首次部署后，通过 D1 控制台或 SQL 将用户提升为管理员：

```sql
UPDATE users SET role = 'admin', permissions = '["contest_admin","problem_admin","list_admin","ticket_admin"]' WHERE username = '你的用户名';
```

也可通过 `__seed` 端点插入示例数据：

```bash
curl https://你的域名/__seed
```

### 站点设置（管理页面）

部署后，管理员可在后台 **站点设置** 标签页配置：

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 开启注册 | 关闭后新用户无法注册 | 开启 |
| 强制填写邮箱 | 注册时邮箱为必填项 | 关闭 |
| 邮箱后缀限制 | 允许的邮箱后缀（逗号分隔），留空不限制 | 空 |

## 🖥 本地开发

```bash
# 终端 1：后端
cd backend
npm install
npm run dev
# → http://localhost:8787

# 终端 2：前端
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

本地开发时前端会自动代理 API 请求到后端。

### 本地数据库迁移

```bash
cd backend
# 查看待应用的迁移
npx wrangler d1 migrations list DB --local
# 应用迁移到本地 D1
npx wrangler d1 migrations apply DB --local
# 执行 SQL 查询
npx wrangler d1 execute DB --local --command "SELECT COUNT(*) as cnt FROM users"
```