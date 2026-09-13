/**
 * 后端 SSR 渲染管线入口。由 index.ts 的 catch-all 调用:
 *
 * ```ts
 * import { renderSSR } from './ssr';
 * const html = await renderSSR(c, app, url);
 * ```
 *
 * 流程:
 * 1. 通过 loaders 准备 SSR envelope(全局数据 + 当前页 loader 数据)
 * 2. 读取 index.html 模板(从 ASSETS binding 或本地 fs)
 * 3. 调用 Vite 构建出的 frontend/dist/server/entry-server.js 的 render()
 * 4. 把渲染好的 HTML + 内联数据 envelope 返回给浏览器
 */
import type { Context } from 'hono';
import type { AppType } from './types';
import { runPageLoader } from './loaders';
import type { SSRDataEnvelope } from './ssr-types';

const g = globalThis as any;
if (typeof g.setImmediate !== 'function') {
  g.setImmediate = (fn: (...args: any[]) => void, ...args: any[]) => {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(() => fn(...args));
    } else {
      setTimeout(() => fn(...args), 0);
    }
    return 0;
  };
  g.clearImmediate = g.clearImmediate || ((id: number) => {});
}

// SSR 渲染器由前端构建产物提供(esm 模块,由 Wrangler 在打包时引入)
// 路径相对于 backend/src/,实际文件位于 backend/ssr/entry-server.js
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — 编译期不存在(dev 时),由 wrangler 打包时解析
import { render } from '../ssr/entry-server.js';

/**
 * 读取 index.html 模板。优先用 ASSETS binding(生产),否则本地 dev 时读 fs。
 */
async function readIndexHtml(c: Context<AppType>): Promise<string | null> {
  const assets = (c.env as any).ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    try {
      const req = new Request(new URL('/index.html', c.req.url).toString());
      const res = await assets.fetch(req);
      if (res.ok) return await res.text();
    } catch { /* fallthrough */ }
  }
  if (typeof process !== 'undefined') {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const bases = [
        path.join(process.cwd(), 'public', 'index.html'),
        path.join(process.cwd(), 'backend', 'public', 'index.html'),
        path.join(process.cwd(), '..', 'backend', 'public', 'index.html'),
        path.join(process.cwd(), 'dist', 'index.html'),
      ];
      for (const b of bases) {
        if (fs.existsSync(b)) return fs.readFileSync(b, 'utf-8');
      }
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * 判断请求是否适合 SSR 渲染:
 * - 方法为 GET(POST/PUT 等不渲染页面)
 * - Accept 头包含 text/html(浏览器导航;fetch 通常用 application/json)
 * - 不是 /api/* 路径
 * - 不是已知的静态资源后缀
 */
export function shouldSSR(c: Context<AppType>): boolean {
  if (c.req.method !== 'GET') return false;
  const path = c.req.path;
  if (path.startsWith('/api/')) return false;
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|map|webmanifest|txt|xml|json)$/.test(path)) {
    return false;
  }
  const accept = c.req.header('Accept') || '';
  return accept.includes('text/html');
}

/**
 * 执行 SSR 渲染。返回完整的 HTML Response 或 null(失败/降级到 SPA 壳子)。
 */
export async function renderSSR(c: Context<AppType>, app: any): Promise<Response | null> {
  try {
    // 1. 准备数据
    const { envelope } = await runPageLoader(app as any, c.env, c.req.raw);

    // 2. 读 index.html 模板
    const indexHtml = await readIndexHtml(c);
    if (!indexHtml) return null;

    // 3. SSR 渲染
    if (!envelope) return null;
    const { html, status } = await render(
      c.req.url,
      envelope as SSRDataEnvelope,
      indexHtml,
    );

    return new Response(html, {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // SSR 内容含个性化数据(用户名/未读消息等),禁止共享缓存
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[SSR] renderSSR failed:', msg);
    return null; // 让上层回退到 SPA 壳子
  }
}
