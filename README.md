# OJ System

这是一个基于 Cloudflare Workers 的在线判题系统，覆盖题目管理、用户认证、提交评测、竞赛、讨论、题单、后台管理与可选广告位配置。

> **UI 主题**：本仓库提供三种前端视觉风格，可通过 `frontend/config.yaml` 中的 `site.theme` 字段切换：
> - **`default`**（默认）— 暗色为主，大圆角（10px），靛蓝渐变强调色，全宽导航栏
> - **`luogu`** — 洛谷风格复刻，50px 蓝粉渐变顶栏 + 240px 左侧边栏双栏布局，9 级难度色板，3-4px 小圆角扁平设计
> - **`hydro`** — HydroOJ 风格，蓝色主调 `#5f9fd6`，完全扁平（border-radius: 0），极简设计，浅灰背景


## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite |
| 后端 | Hono (Cloudflare Workers) |
| 数据库 | Cloudflare D1 (SQLite) |
| 认证 | GitHub OAuth + CpOAuth + JWT + bcrypt |
| 状态管理 | Zustand |
| 代码编辑器 | CodeMirror 6 |
| 评测引擎 | GitHub Actions |
| 样式 | CSS Variables + 自定义 CSS |

## 部署指南

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

## 本地开发

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

## API 概览

所有接口返回统一格式：`{ success: true, data: {...} }` 或 `{ success: false, error: { message, code } }`

| 模块 | 路径前缀 | 说明 |
|------|----------|------|
| 认证 | `/api/v1/auth` | GitHub/CpOAuth OAuth、注册、登录 |
| 题目 | `/api/v1/problems` | 题目 CRUD、收藏、统计 |
| 提交 | `/api/v1/submissions` | 代码提交、结果查询 |
| 用户 | `/api/v1/users` | 用户资料、已解决题目 |
| 排名 | `/api/v1/rankings` | 全站排行榜 |
| 竞赛 | `/api/v1/contests` | 竞赛管理、参与、排行 |
| 题单 | `/api/v1/lists` | 题单 CRUD |
| 题解 | `/api/v1/solutions` | 题解发布、投票 |
| 讨论 | `/api/v1/discussions` | 讨论区 |
| 工单 | `/api/v1/tickets` | 工单提交、处理 |
| 设置 | `/api/v1/settings` | 站点配置读写 |
| 管理 | `/api/v1/admin` | 管理员专用接口 |
| 内部 | `/api/v1/internal` | 评测回调（GitHub Actions 调用） |

## 数据库表

| 表名 | 说明 |
|------|------|
| users | 用户（GitHub/CpOAuth/密码认证） |
| problems | 题目 |
| testcases | 测试用例 |
| submissions | 提交记录 |
| favorites | 收藏 |
| contests | 竞赛 |
| contest_problems | 竞赛题目关联 |
| contest_participants | 竞赛参与者 |
| tickets | 工单 |
| ticket_replies | 工单回复 |
| problem_lists | 题单 |
| problem_list_items | 题单题目关联 |
| solutions | 题解 |
| solution_votes | 题解投票 |
| discussions | 讨论 |
| discussion_replies | 讨论回复 |
| rate_limits | 限流记录 |
| settings | 站点设置（键值对） |

## License

MIT
