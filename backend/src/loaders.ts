/**
 * SSR 数据加载器:按路由调用现有 API 拿首屏数据。
 *
 * 用 app.request() 直接在 Worker 进程内调用 Hono 路由(无网络开销、无子请求计数),
 * 复用 routes/*.ts 已实现的全部业务逻辑与认证检查。
 *
 * 加载器签名:
 *   (ctx) => Promise<Record<string, unknown>>
 *
 * 返回的对象会被序列化进 window.__SSR_DATA__.page[pageKey],
 * 页面通过 useSSRData(pageKey, fetcher) 消费。
 *
 * 路由匹配说明:仅匹配路径名(忽略 query),loader 自己再解析需要的参数。
 * 未匹配到 loader 的路径会返回 null,触发后端只渲染 SPA 壳子(等同纯 CSR)。
 */
import type { Hono } from 'hono';
import type { AppType } from './types';
import { verifyJWT } from './utils/jwt';
import { getAuthTokenFromRequest, readCookie } from './utils/cookie';

export interface LoaderCtx {
  app: Hono<AppType>;
  env: AppType['Bindings'];
  /** 已认证的用户(payload),未登录时为 null */
  user: Awaited<ReturnType<typeof resolveUserFromRequest>>;
  /** 当前请求的 URL(包含 pathname + search) */
  url: URL;
  /** 原始请求,用于把 cookie 等头透传给 sub-request */
  originalRequest: Request;
}

async function callApi<T = unknown>(
  ctx: LoaderCtx,
  pathAndQuery: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    // 透传 cookie 让子请求继承认证状态(API 中间件会从 cookie 取 token)
    const headers = new Headers(init?.headers);
    const cookie = ctx.originalRequest.headers.get('Cookie');
    if (cookie) headers.set('Cookie', cookie);
    headers.delete('authorization'); // 避免与 cookie 重复
    const res = await ctx.app.request(
      pathAndQuery,
      { ...init, headers },
      ctx.env,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { success: boolean; data?: T; error?: unknown };
    if (!body.success || body.data === undefined) return null;
    return body.data;
  } catch {
    return null;
  }
}

/** 解析当前请求的认证用户(基于 cookie 或 Authorization 头) */
async function resolveUserFromRequest(ctx: { env: AppType['Bindings']; originalRequest: Request }) {
  const token = getAuthTokenFromRequest(ctx.originalRequest as any);
  if (!token) return null;
  try {
    const payload = await verifyJWT(token, ctx.env.JWT_SECRET, (ctx.env as any).JWT_SECRET_PREVIOUS);
    if (!payload) return null;
    const row: any = await ctx.env.DB.prepare('SELECT banned FROM users WHERE id = ?')
      .bind(payload.userId).first();
    if (!row || row.banned === 1) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── 路由 → loader 映射表 ──
// 列表中每条用 [pathPattern, pageKey, loaderFn] 三元组描述。
// pathPattern 为精确字符串或一个返回 boolean 的函数。
type PathMatcher = string | ((pathname: string) => boolean);
type LoaderFn = (ctx: LoaderCtx) => Promise<Record<string, unknown> | null>;

interface LoaderEntry {
  match: PathMatcher;
  pageKey: string;
  load: LoaderFn;
}

const ENTRIES: LoaderEntry[] = [
  // ──── 公共首页 ────
  {
    match: (p) => p === '/',
    pageKey: 'home',
    load: async (ctx) => {
      const [problems, contests, lists, discussions, rankings, dailyProblem] = await Promise.all([
        callApi(ctx, '/api/v1/problems?page=1&pageSize=5'),
        callApi(ctx, '/api/v1/contests?page=1&pageSize=5'),
        callApi(ctx, '/api/v1/lists?page=1&pageSize=5'),
        callApi(ctx, '/api/v1/discussions?page=1&pageSize=5'),
        callApi(ctx, '/api/v1/rankings?limit=10'),
        callApi(ctx, '/api/v1/problems/daily'),
      ]);
      const data: Record<string, unknown> = {
        problems, contests, lists, discussions, rankings, dailyProblem,
      };
      // 已登录用户额外的个性化数据
      if (ctx.user) {
        const [recommendations, route] = await Promise.all([
          callApi(ctx, '/api/v1/problems/recommended?limit=6'),
          callApi(ctx, '/api/v1/problems/route?limit=5'),
        ]);
        data.recommendations = recommendations;
        data.route = route;
      }
      return data;
    },
  },

  // ──── 题目列表 ────
  {
    match: (p) => p === '/problems',
    pageKey: 'problemList',
    load: async (ctx) => {
      const qs = ctx.url.search || '';
      const [problemsRes, tagsRes] = await Promise.all([
        callApi(ctx, `/api/v1/problems?page=1&pageSize=20${qs.replace(/^\?/, '&')}`),
        callApi(ctx, '/api/v1/tags/problem'),
      ]);
      const data: Record<string, unknown> = {
        problems: problemsRes,
        tags: tagsRes,
      };
      if (ctx.user) {
        data.userSolved = await callApi(ctx, '/api/v1/submissions/me/solved');
      }
      return data;
    },
  },

  // ──── 题目详情 ────
  {
    match: (p) => /^\/problems\/[^/]+$/.test(p),
    pageKey: 'problemDetail',
    load: async (ctx) => {
      const slug = ctx.url.pathname.split('/')[2];
      const [problem, related, languages, trend] = await Promise.all([
        callApi(ctx, `/api/v1/problems/${encodeURIComponent(slug)}`),
        callApi(ctx, `/api/v1/problems/${encodeURIComponent(slug)}/related`),
        callApi(ctx, `/api/v1/problems/${encodeURIComponent(slug)}/languages`),
        callApi(ctx, `/api/v1/problems/${encodeURIComponent(slug)}/trend`),
      ]);
      const data: Record<string, unknown> = { problem, related, languages, trend };
      if (ctx.user && problem) {
        const pid = (problem as any)?.problem?.id;
        if (pid) {
          const [fav, status, submissions] = await Promise.all([
            callApi(ctx, `/api/v1/problems/${encodeURIComponent(slug)}/favorite`),
            callApi(ctx, `/api/v1/problems/${encodeURIComponent(slug)}/status`),
            callApi(ctx, `/api/v1/submissions?problem_id=${pid}&pageSize=5`),
          ]);
          data.favorite = fav;
          data.status = status;
          data.submissions = submissions;
        }
      }
      return data;
    },
  },

  // ──── 比赛列表 ────
  {
    match: (p) => p === '/matches',
    pageKey: 'contests',
    load: async (ctx) => callApi(ctx, '/api/v1/contests?page=1&pageSize=20'),
  },

  // ──── 比赛详情 ────
  {
    match: (p) => /^\/match\/[^/]+$/.test(p),
    pageKey: 'contestDetail',
    load: async (ctx) => {
      const id = ctx.url.pathname.split('/')[2];
      const contest = await callApi(ctx, `/api/v1/contests/${id}`);
      const data: Record<string, unknown> = { contest };
      if (contest) {
        const [announcements, clarifications] = await Promise.all([
          callApi(ctx, `/api/v1/contests/${id}/announcements`),
          ctx.user ? callApi(ctx, `/api/v1/contests/${id}/clarifications`) : null,
        ]);
        data.announcements = announcements;
        data.clarifications = clarifications;
      }
      return data;
    },
  },

  // ──── 排行榜 ────
  {
    match: (p) => p === '/rankings',
    pageKey: 'rankings',
    load: async (ctx) => callApi(ctx, '/api/v1/rankings?limit=100'),
  },

  // ──── 用户主页 / profile ────
  {
    match: (p) => p === '/profile' || /^\/users\/[^/]+$/.test(p),
    pageKey: 'profile',
    load: async (ctx) => {
      const username = ctx.url.pathname.startsWith('/users/')
        ? decodeURIComponent(ctx.url.pathname.split('/')[2])
        : undefined;
      const path = username ? `/api/v1/users/${encodeURIComponent(username)}` : '/api/v1/users/me';
      const data: Record<string, unknown> = {
        profile: await callApi(ctx, path),
      };
      return data;
    },
  },

  // ──── 题单列表 ────
  {
    match: (p) => p === '/lists',
    pageKey: 'problemLists',
    load: async (ctx) => callApi(ctx, '/api/v1/lists?page=1&pageSize=20'),
  },

  // ──── 题单详情 ────
  {
    match: (p) => /^\/lists\/[^/]+$/.test(p),
    pageKey: 'problemListDetail',
    load: async (ctx) => {
      const id = ctx.url.pathname.split('/')[2];
      return { list: await callApi(ctx, `/api/v1/lists/${id}`) };
    },
  },

  // ──── 题解列表 ────
  {
    match: (p) => p === '/solutions/all' || p === '/solutions',
    pageKey: 'solutions',
    load: async (ctx) => callApi(ctx, '/api/v1/solutions?page=1&pageSize=20'),
  },

  // ──── 题解详情 ────
  {
    match: (p) => /^\/solutions\/[^/]+$/.test(p),
    pageKey: 'solutionDetail',
    load: async (ctx) => {
      const id = ctx.url.pathname.split('/')[2];
      return { solution: await callApi(ctx, `/api/v1/solutions/${id}`) };
    },
  },

  // ──── 讨论列表 ────
  {
    match: (p) => p === '/discussions/all' || p === '/discussions',
    pageKey: 'discussions',
    load: async (ctx) => callApi(ctx, '/api/v1/discussions?page=1&pageSize=20'),
  },

  // ──── 讨论详情 ────
  {
    match: (p) => /^\/discussions\/[^/]+$/.test(p),
    pageKey: 'discussionDetail',
    load: async (ctx) => {
      const id = ctx.url.pathname.split('/')[2];
      return { discussion: await callApi(ctx, `/api/v1/discussions/${id}`) };
    },
  },

  // ──── 博客列表 ────
  {
    match: (p) => p === '/blogs',
    pageKey: 'blogs',
    load: async (ctx) => callApi(ctx, '/api/v1/blogs?page=1&pageSize=20'),
  },

  // ──── 博客详情 ────
  {
    match: (p) => /^\/blogs\/[^/]+$/.test(p),
    pageKey: 'blogDetail',
    load: async (ctx) => {
      const id = ctx.url.pathname.split('/')[2];
      return { blog: await callApi(ctx, `/api/v1/blogs/${id}`) };
    },
  },

  // ──── 工单列表 ────
  {
    match: (p) => p === '/tickets',
    pageKey: 'tickets',
    load: async (ctx) => callApi(ctx, '/api/v1/tickets?page=1&pageSize=20'),
  },

  // ──── 工单详情 ────
  {
    match: (p) => /^\/tickets\/[^/]+$/.test(p),
    pageKey: 'ticketDetail',
    load: async (ctx) => {
      const id = ctx.url.pathname.split('/')[2];
      return { ticket: await callApi(ctx, `/api/v1/tickets/${id}`) };
    },
  },

  // ──── 公告 ────
  {
    match: (p) => p === '/announcements',
    pageKey: 'announcements',
    load: async (ctx) => callApi(ctx, '/api/v1/announcements?page=1&pageSize=20'),
  },

  // ──── 训练 ────
  {
    match: (p) => p === '/training',
    pageKey: 'training',
    load: async (ctx) => callApi(ctx, '/api/v1/training?page=1&pageSize=20'),
  },

  // ──── 搜索 ────
  {
    match: (p) => p === '/search',
    pageKey: 'search',
    load: async (ctx) => {
      const q = ctx.url.searchParams.get('q') || '';
      if (!q) return { results: null };
      return { results: await callApi(ctx, `/api/v1/search?q=${encodeURIComponent(q)}&limit=20`) };
    },
  },

  // ──── 自定义页面 ────
  {
    match: (p) => /^\/page\/[^/]+$/.test(p),
    pageKey: 'customPage',
    load: async (ctx) => {
      const slug = ctx.url.pathname.split('/')[2];
      return { page: await callApi(ctx, `/api/v1/pages/${encodeURIComponent(slug)}`) };
    },
  },
];

/**
 * 给定 pathname,找出匹配的 loader。返回 null 表示无 SSR 数据(走纯客户端)。
 */
export function findLoader(pathname: string): LoaderEntry | null {
  for (const e of ENTRIES) {
    const matched = typeof e.match === 'string' ? e.match === pathname : e.match(pathname);
    if (matched) return e;
  }
  return null;
}

/** 解析当前请求认证用户(供 SSR 全局数据准备使用) */
export { resolveUserFromRequest };

/**
 * 准备 SSR 全局数据(站点设置、友情链接、自定义页面、当前用户、未读消息、用户主题)。
 * 这些数据原本由 Layout/App 在客户端 useEffect 中拉取,SSR 时直接预取注入。
 */
export async function buildGlobalData(ctx: LoaderCtx) {
  const [settings, friendLinksData, pagesData, unreadData, userSettings] = await Promise.all([
    callApi<Record<string, string>>(ctx, '/api/v1/settings'),
    callApi<{ links?: any[] }>(ctx, '/api/v1/friend-links'),
    callApi<{ pages?: any[] }>(ctx, '/api/v1/pages'),
    ctx.user ? callApi<{ count?: number }>(ctx, '/api/v1/messages/unread-count') : null,
    ctx.user ? callApi<{ settings?: any }>(ctx, '/api/v1/user/settings') : null,
  ]);

  // 解析客户端主题(cookie):SSR 注入让客户端 store 直接读取
  const cookieHeader = ctx.originalRequest.headers.get('Cookie') || '';
  let theme: 'dark' | 'light' | undefined;
  const themeCookie = readCookie(cookieHeader, 'theme');
  if (themeCookie === 'dark' || themeCookie === 'light') theme = themeCookie;

  // 解析客户端语言(cookie)
  let language: 'zh' | 'en' | undefined;
  const langCookie = readCookie(cookieHeader, 'lang');
  if (langCookie === 'zh' || langCookie === 'en') language = langCookie;

  return {
    settings: settings ?? {},
    friendLinks: friendLinksData?.links ?? [],
    pages: pagesData?.pages ?? [],
    user: ctx.user
      ? await (async () => {
          const row: any = await ctx.env.DB.prepare(
            'SELECT id, username, avatar_url, role, permissions, created_at FROM users WHERE id = ?',
          ).bind(ctx.user!.userId).first();
          if (!row) return null;
          try {
            const parsed = row.permissions ? JSON.parse(row.permissions) : [];
            row.permissions = Array.isArray(parsed) ? parsed : [];
          } catch {
            row.permissions = [];
          }
          return row;
        })()
      : null,
    unreadMessages: unreadData?.count ?? 0,
    userSettings: userSettings?.settings as { theme?: 'dark' | 'light'; custom_css?: string } | undefined,
    theme,
    language,
    serverTime: Date.now(),
  };
}

/** 对外暴露的入口:执行 SSR loader 并返回 envelope.page 部分 */
export async function runPageLoader(
  app: Hono<AppType>,
  env: AppType['Bindings'],
  originalRequest: Request,
): Promise<{ envelope: import('./ssr-types').SSRDataEnvelope | null; status: number }> {
  const url = new URL(originalRequest.url);
  const user = await resolveUserFromRequest({ env, originalRequest });
  const ctx: LoaderCtx = { app, env, user, url, originalRequest };
  const entry = findLoader(url.pathname);

  const global = await buildGlobalData(ctx);
  const page: Record<string, unknown> = (entry ? (await entry.load(ctx)) : null) ?? {};

  return {
    envelope: {
      global,
      path: url.pathname,
      page,
    },
    status: 200,
  };
}
