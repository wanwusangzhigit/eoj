# 参与贡献指南 (Contributing Guide)

欢迎参与 **OJ System**(在线判题系统)的开发!本指南帮助你理解项目结构、工作流程与代码规范,让协作更加顺畅。

## 目录

- [项目概览](#项目概览)
- [技术栈](#技术栈)
- [开发环境准备](#开发环境准备)
- [分支策略与并行开发](#分支策略与并行开发)
- [本地运行](#本地运行)
- [目录结构](#目录结构)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [密钥与环境变量安全](#密钥与环境变量安全)

---

## 项目概览

基于 **Cloudflare Workers + GitHub Actions** 的现代在线判题系统(Online Judge),覆盖题目管理、用户认证、提交评测、竞赛、讨论、题单、后台管理与可选广告位配置。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + Vite + TypeScript |
| 后端 | Hono(Cloudflare Workers)+ Cloudflare D1(SQLite)|
| 判题 | GitHub Actions 异步判题(nsjail 沙箱)|
| 部署 | Cloudflare Workers / Pages |
| CI | GitHub Actions |

---

## 开发环境准备

需要:
- **Node.js ≥ 18**(建议 20 LTS 及以上)
- **npm** 或 **pnpm**
- **Wrangler CLI**(`@cloudflare/wrangler`)用于本地 D1 / Worker 调试

安装前端依赖:

```bash
cd frontend
npm install
```

安装后端依赖:

```bash
cd backend
npm install
```

> 提示:若使用 worktree 并行开发(见下),每个 worktree 都需单独执行 `npm install`。

---

## 分支策略与并行开发

本项目采用 **`main` / `dev` 双分支** 策略:

- **`main`**:稳定发布分支,对应线上生产(oj.wanwusangzhi.top)。只接受经过验证的功能合并。
- **`dev`**:开发分支,承载进行中的 SSR 迁移等实验性工作,可自由提交。

### 使用 Git Worktree 并行开发

为方便 `dev` 与 `main` 分支并行开发,推荐使用 **Git Worktree**,避免频繁切分支造成的工作区冲突:

```bash
# 在主仓库目录(dev)之外新增 main 的工作区
git worktree add ../eoj-main main

# 查看 worktree 列表
git worktree list
# /home/admin/Desktop/eoj       <hash> [dev]
# /home/admin/Desktop/eoj-main   <hash> [main]

# 在各自目录内独立开发、独立构建
cd ../eoj-main && npm install      # 每个 worktree 需各自安装依赖
```

- `dev` 工作目录:`<仓库>/`(例如 `/home/admin/Desktop/eoj`)
- `main` 工作目录:`<仓库>-main/`(例如 `/home/admin/Desktop/eoj-main`)

> `git worktree` 共享同一个 `.git`,提交、分支、标签在所有 worktree 间可见,但**工作区与 node_modules 相互独立**。

---

## 本地运行

### 后端 + SSR(Wrangler)

```bash
cd backend
wrangler dev            # 本地起 Worker,含 API + SSR
```

启用 SSR 需保证 `wrangler.toml`(或 `.env`)中:

```toml
[assets]
not_found_handling = "none"
run_worker_first = true
```

并确认 `compatibility_flags = ["nodejs_compat"]`。

### 前端(纯开发 HMR)

```bash
cd frontend
npm run dev
```

### 构建

```bash
# 前端:客户端 + SSR + 拷贝到后端
cd frontend && npm run build:site

# 后端类型检查
cd backend && npx tsc --noEmit

# 后端 Lint
cd backend && npm run lint

# 本地 D1 迁移
cd backend && npm run db:migrate:local
```

---

## 目录结构

```
backend/
  src/index.ts        # Hono 入口、路由、catch-all SSR 入口
  src/ssr.ts          # SSR 渲染管线 + Worker 全局 polyfill
  src/loaders.ts      # route → pageKey loader 映射(SSR 数据注入依据)
  src/routes/         # 各业务模块路由
  migrations/         # D1 SQL 迁移
frontend/
  src/pages/          # 页面组件
  src/pages/admin/    # 管理后台页面
  src/ssr/            # useSSRPage / hydrate 机制
  src/api/client.ts   # 前端 API 客户端
  src/i18n/           # zh / en 多语言
```

---

## 代码规范

- **TypeScript 严格模式**,优先使用类型定义而非 `any`(历史遗留 `any` 除外)。
- 后端在 `no-explicit-any` 上保持宽松(lint 只报不阻断)。
- 组件遵循现有命名与目录习惯。

---

## Commit 提交规范

遵循 **语义化提交**(Conventional Commits):

```
<type>(<scope>): <subject>
```

- `feat` — 新功能
- `fix` — 缺陷修复
- `chore` — 工程杂项(依赖、脚本、配置)
- `refactor` — 重构
- `docs` — 文档
- `ci` — CI 配置

示例:

```
feat(contest): 比赛页新增详情(Overview)tab
fix(ssr): 修复 Cloudflare Workers 下 SSR 无法启动
chore(backend): 新增 ESLint 配置与 lint 脚本
```

---

## Pull Request 流程

1. 从最新基线上切出功能分支(如 `feat/xxx`)或基于 `dev` 开发。
2. 完成开发并在本地跑通构建与检查:
   - `frontend`: `npx tsc -b` && `npm run build:site`
   - `backend`: `npx tsc --noEmit` && `npm run lint`
3. 提交(见提交规范),推送到远端。
4. 创建 PR,说明改动目的、影响范围与验证步骤。
5. 等待 review 与 CI 通过后合并到目标分支。

---

## 密钥与环境管理(重要)

**严禁把任何真实密钥明文提交到仓库。**

- `.gitignore` 已忽略 `backend/.env` / `.env` / `.wrangler/`。
- 真实密钥统一存放在 **`backend/.env`**(本地)与 Cloudflare 控制台(线上)。
- `wrangler.toml` 仅保留**占位/空值**,部署/本地时由 `.env` 或平台注入(见上方部署提示)。
- 常见的敏感键以 `_SECRET` / `_TOKEN` / `account_id` / `database_id` 开头/结尾,请勿在提交内容或日志中暴露。

防泄漏检查示例:

```bash
# 全历史扫描 wrangler.toml 是否混入真实密钥(应无输出)
git log --all --format="%h" -- backend/wrangler.toml | while read c; do
  git show "$c:backend/wrangler.toml" 2>/dev/null | grep -E "ghp_|_SECRET = \"[A-Za-z0-9/+=]{8}" && echo "!! $c 含密钥"
done
```

---

感谢你的贡献!如有问题请提 [Issue](https://github.com/wanwusangzhigit/eoj/issues)。