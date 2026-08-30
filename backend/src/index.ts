import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AppType } from './types';
import auth from './routes/auth';
import problems from './routes/problems';
import submissions from './routes/submissions';
import rankings from './routes/rankings';
import users from './routes/users';
import internal from './routes/internal';
import admin from './routes/admin';
import contests from './routes/contests';
import tickets from './routes/tickets';
import problemLists from './routes/problemLists';
import solutions from './routes/solutions';
import discussions from './routes/discussions';
import settings from './routes/settings';
import uploads from './routes/uploads';
import ai from './routes/ai';
import audit from './routes/audit';
import tags from './routes/tags';
import ratings from './routes/ratings';
import training from './routes/training';
import notifications from './routes/notifications';
import messages from './routes/messages';
import teams from './routes/teams';
import blogs from './routes/blogs';
import captcha from './routes/captcha';
import notes from './routes/notes';
import achievements from './routes/achievements';
import search from './routes/search';
import templates from './routes/templates';
import userSettings from './routes/userSettings';
import collections from './routes/collections';
import announcements from './routes/announcements';
import rss from './routes/rss';
import codeShares from './routes/codeShares';
import friendLinks from './routes/friendLinks';
import customPages from './routes/customPages';
import { seedDatabase } from './seed';
import { auditMiddleware, banCheckMiddleware } from './middleware/audit';

const app = new Hono<AppType>();

// Validate required environment variables
const REQUIRED_ENV_VARS = ['JWT_SECRET', 'CALLBACK_SECRET', 'GITHUB_TOKEN', 'JUDGE_REPO', 'FRONTEND_URL'];
let envValidated = false;

app.use('/api/*', async (c, next) => {
  if (!envValidated) {
    for (const key of REQUIRED_ENV_VARS) {
      if (!(c.env as any)[key]) {
        console.error(`Missing required env var: ${key}`);
        return c.json({ success: false, error: { message: `Server config error: ${key} not set`, code: 'CONFIG_ERROR' } }, 500);
      }
    }
    envValidated = true;
  }
  await next();
});

app.use('/api/*', async (c, next) => {
  // 允许的跨域来源:站点主域 + 站点设置里通过 cors_origins(逗号分隔)配置的
  // 第三方域名(跨域社交登录时,来源域名 B 需要能调用 /auth/exchange 换取 token)。
  const origins = [c.env.FRONTEND_URL || 'http://localhost:5173'];
  try {
    const row: any = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'cors_origins'").first();
    if (row && row.value) {
      for (const o of row.value.split(',').map((s: string) => s.trim()).filter(Boolean)) {
        if (origins.indexOf(o) === -1) origins.push(o);
      }
    }
  } catch { /* DB 不可用时忽略 */ }

  const corsMiddleware = cors({
    origin: origins,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Fingerprint'],
    credentials: true,
  });
  return corsMiddleware(c, next);
});

// Security headers on ALL responses — use c.header() instead of c.res.headers.set()
// to avoid "Can't modify immutable headers" errors in Hono v4
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-XSS-Protection', '0');
  // Strict-Transport-Security only on HTTPS origins
  const url = new URL(c.req.url);
  if (url.protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  await next();
});

// Ban check + audit logging for all API routes
app.use('/api/*', banCheckMiddleware);
app.use('/api/*', auditMiddleware);

// Cache control for public GET endpoints
app.use('/api/*', async (c, next) => {
  await next();
  if (c.req.method === 'GET' && c.res.status === 200) {
    const path = c.req.path;
    // 仅缓存公开、非 admin/internal/auth 接口;
    // 进一步对个性化接口(/me、/users/:id、/notifications、/messages、/audit、
    // /user/settings、/submissions?me=1 等)使用 private 指令,避免共享缓存(如
    // CDN、代理)把 A 用户的个人信息返回给 B 用户。
    if (!path.includes('/admin/') && !path.includes('/internal/') && !path.includes('/auth/')) {
      const personalizedPatterns = [
        '/me', '/notifications', '/messages', '/audit', '/user/settings',
        '/collections/me', '/submissions/me',
      ];
      const isPersonalized = personalizedPatterns.some((p) => path.includes(p))
        || path.startsWith('/api/v1/users/')      // 用户主页包含个人统计
        || path.startsWith('/api/v1/templates')    // 代码模板按用户存储
        || path.startsWith('/api/v1/notes');       // 笔记按用户存储
      c.res.headers.set(
        'Cache-Control',
        isPersonalized ? 'private, max-age=10' : 'public, max-age=10, s-maxage=30'
      );
    }
  }
});

app.onError((err, c) => {
  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return c.json({
      success: false,
      error: {
        message: 'Invalid JSON',
        code: 'BAD_REQUEST'
      }
    }, 400);
  }

  // 生成 trace_id 便于日志关联排查(不向客户端暴露内部错误细节)
  const traceId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  // 结构化日志:生产环境仅记录 trace_id 与消息概要,不写入完整堆栈,
  // 避免内部实现细节泄漏到 Workers logs,同时降低日志噪声。
  // 在本地开发环境(NODE_ENV !== 'production')保留堆栈便于调试。
  const isProd = (c.env as any).NODE_ENV === 'production' ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production');
  console.error(JSON.stringify({
    level: 'error',
    trace_id: traceId,
    timestamp: new Date().toISOString(),
    method: c.req.method,
    path: c.req.path,
    message: err.message,
    ...(isProd ? {} : { stack: err.stack }),
  }));

  return c.json({
    success: false,
    error: {
      message: 'An internal server error occurred',
      code: 'INTERNAL_ERROR',
      trace_id: traceId,
    }
  }, 500);
});

app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      message: 'Resource not found',
      code: 'NOT_FOUND'
    }
  }, 404);
});

const api = new Hono<AppType>();

api.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
  } catch (e) {
    return c.json({ success: false, error: { message: 'Database unavailable' } }, 503);
  }
});

api.route('/auth', auth);
api.route('/problems', problems);
api.route('/submissions', submissions);
api.route('/rankings', rankings);
api.route('/users', users);
api.route('/admin', admin);
api.route('/internal', internal);
api.route('/contests', contests);
api.route('/tickets', tickets);
api.route('/lists', problemLists);
api.route('/solutions', solutions);
api.route('/discussions', discussions);
api.route('/uploads', uploads);
api.route('/settings', settings);
api.route('/ai', ai);
api.route('/audit', audit);
api.route('/tags', tags);
api.route('/ratings', ratings);
api.route('/training', training);
api.route('/notifications', notifications);
api.route('/messages', messages);
api.route('/teams', teams);
api.route('/blogs', blogs);
api.route('/captcha', captcha);
api.route('/notes', notes);
api.route('/achievements', achievements);
api.route('/search', search);
api.route('/templates', templates);
api.route('/user/settings', userSettings);
api.route('/collections', collections);
api.route('/announcements', announcements);
api.route('/rss', rss);
api.route('/shares', codeShares);
api.route('/friend-links', friendLinks);
api.route('/pages', customPages);

app.route('/api/v1', api);

// GET /sitemap.xml — SEO sitemap(自动使用当前请求域名生成,便于收录题目/博客/题解/讨论/公告页)
app.get('/sitemap.xml', async (c) => {
  const origin = new URL(c.req.url).origin;

  const staticUrls = [
    '', '/problems', '/matches', '/lists', '/blogs', '/discussions',
    '/announcements', '/rankings', '/solutions/all', '/search',
  ];

  const [problems, blogs, solutions, discussions, announcements] = await Promise.all([
    c.env.DB.prepare("SELECT slug FROM problems WHERE is_public = 1 ORDER BY id DESC LIMIT 500").all(),
    c.env.DB.prepare("SELECT id FROM blogs WHERE status = 'published' ORDER BY id DESC LIMIT 500").all(),
    c.env.DB.prepare("SELECT id FROM solutions WHERE review_status = 'approved' ORDER BY id DESC LIMIT 500").all(),
    c.env.DB.prepare("SELECT id FROM discussions ORDER BY id DESC LIMIT 500").all(),
    c.env.DB.prepare("SELECT id FROM site_announcements WHERE status = 'published' ORDER BY id DESC LIMIT 200").all(),
  ]);

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const url = (loc: string) =>
    `  <url>\n    <loc>${esc(origin + loc)}</loc>\n  </url>`;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const p of staticUrls) lines.push(url(p));
  for (const r of (problems.results as any[])) lines.push(url(`/problems/${r.slug}`));
  for (const r of (blogs.results as any[])) lines.push(url(`/blogs/${r.id}`));
  for (const r of (solutions.results as any[])) lines.push(url(`/solutions/${r.id}`));
  for (const r of (discussions.results as any[])) lines.push(url(`/discussions/${r.id}`));
  for (const r of (announcements.results as any[])) lines.push(url(`/announcements`));
  lines.push('</urlset>');

  c.header('Content-Type', 'application/xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(lines.join('\n'));
});

// GET /robots.txt — 搜索引擎爬虫规则
app.get('/robots.txt', async (c) => {
  const origin = new URL(c.req.url).origin;
  const text = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /__dev_info',
    'Disallow: /__seed',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
  ].join('\n');
  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(text);
});

app.get('/__dev_info', async (c) => {
  // 仅本地开发可用:生产环境返回 404,避免泄露服务器文件系统路径/目录探测信息
  try {
    const url = new URL(c.req.url);
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return c.json({ success: false, error: { message: 'Resource not found', code: 'NOT_FOUND' } }, 404);
    }
  } catch {
    return c.json({ success: false, error: { message: 'Resource not found', code: 'NOT_FOUND' } }, 404);
  }
  const info: any = { hasProcess: typeof process !== 'undefined' };
  if (typeof process !== 'undefined') {
    try {
      const fsMod = await import('fs');
      const pathMod = await import('path');
      const cwd = process.cwd();
      const bases = [
        pathMod.join(cwd, 'public'),
        pathMod.join(cwd, 'backend', 'public'),
        pathMod.join(cwd, '..', 'backend', 'public'),
        pathMod.join(cwd, '..', 'public'),
        pathMod.join(cwd, 'dist'),
      ];
      info.cwd = cwd;
      info.bases = [];
      for (const b of bases) {
        const exists = await fsMod.promises.stat(b).then(s => (s.isDirectory()||s.isFile())?true:false).catch(() => false);
        info.bases.push({ path: b, exists });
      }
    } catch (e) {
      info.error = String(e);
    }
  }
  return c.json({ success: true, data: info });
});

// Dev-only: seed database with sample problems (can only run once)
app.get('/__seed', async (c) => {
  try {
    await seedDatabase(c.env.DB as any, c.env);
    return c.json({ success: true, data: { message: 'Seeded database' } });
  } catch (e: any) {
    if (e.message?.includes('already been executed')) {
      return c.json({ success: false, error: { message: 'Seed has already been executed', code: 'CONFLICT' } }, 409);
    }
    console.error('Seed error:', e);
    return c.json({ success: false, error: { message: 'Seed failed', detail: String(e) } }, 500);
  }
});

app.all('*', async (c) => {
  const request = c.req.raw;
  const assets = (c.env as any).ASSETS;

  if (assets && typeof assets.fetch === 'function') {
    const assetResponse = await assets.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    const indexResponse = await assets.fetch(
      new Request(new URL('/index.html', request.url).toString(), request)
    );
    if (indexResponse.status !== 404) {
      return indexResponse;
    }
  }

  // Fallback for local development: serve files from ./public when ASSETS binding is not present or assets returned 404
  if (typeof process !== 'undefined') {
    try {
      const url = new URL(request.url);
      const fsMod = await import('fs');
      const pathMod = await import('path');

      const possibleBases = [
        pathMod.join(process.cwd(), 'public'),
        pathMod.join(process.cwd(), 'backend', 'public'),
        pathMod.join(process.cwd(), '..', 'backend', 'public'),
        pathMod.join(process.cwd(), '..', 'public'),
        pathMod.join(process.cwd(), 'dist'),
      ];

      let found = false;
      let data: Buffer | null = null;
      let filePath = '';

      for (const base of possibleBases) {
        const candidate = pathMod.join(base, url.pathname.replace(/^\//, ''));
        const stat = await fsMod.promises.stat(candidate).catch(() => null);
        if (stat && stat.isFile()) {
          data = await fsMod.promises.readFile(candidate);
          filePath = candidate;
          found = true;
          break;
        }

        // try index.html fallback inside candidate dir
        const indexCandidate = pathMod.join(base, 'index.html');
        const idxStat = await fsMod.promises.stat(indexCandidate).catch(() => null);
        if (idxStat && idxStat.isFile()) {
          data = await fsMod.promises.readFile(indexCandidate);
          filePath = indexCandidate;
          found = true;
          break;
        }
      }

      if (!found || !data) {
        return c.text('Static assets not available', 404);
      }

      const contentType = filePath.endsWith('.html') ? 'text/html' : filePath.endsWith('.js') ? 'application/javascript' : filePath.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      return new Response(new Uint8Array(data), { headers: { 'Content-Type': contentType } });
    } catch (e) {
      return c.text('Static assets not available', 404);
    }
  }

  return c.text('Static assets not available', 404);
});

export default app;
