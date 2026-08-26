/**
 * 服务端渲染入口。由后端 Worker 在 SSR 时调用:
 *
 * ```ts
 * import { render } from '../public/ssr/server.js';
 * const { html, status } = await render(url, initialData);
 * ```
 *
 * 该文件会被 Vite 单独打包成 SSR bundle(esm),输出到 frontend/dist/server/。
 * 通过 Workers 的 import 或 fetch ASSETS binding 加载。
 *
 * 关键点:
 * - 使用 react-dom/server 的 renderToReadableStream (Web Streams,Workers 兼容)
 * - 复用客户端 App.tsx 的路由树,但外层用 StaticRouter
 * - Suspense + lazy 可在服务端 stream 渲染(React 19 支持)
 * - 错误时返回基础 HTML 让客户端 hydrate 走 CSR 兜底
 */
import { StrictMode } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import App from './App';
import type { SSRDataEnvelope } from './ssr/hydrate';

export interface RenderResult {
  html: string;
  status: number;
  error?: string;
}

/**
 * 渲染当前 URL 为 HTML 字符串。同时把 SSR 数据 envelope 序列化注入。
 *
 * @param url 当前请求的完整路径(含 query,如 /problems?page=2)
 * @param envelope SSR 数据容器(由后端 loader 准备好)
 * @param indexHtml 原始 index.html 模板(用于替换 #root 与注入 <script>)
 */
export async function render(
  url: string,
  envelope: SSRDataEnvelope,
  indexHtml: string,
): Promise<RenderResult> {
  // 仅取 pathname 给 StaticRouter,query 不影响路由匹配
  const urlObj = new URL(url, 'http://localhost');
  const location = urlObj.pathname + urlObj.search;

  let status = 200;
  let responseBody: string;

  try {
    const stream = await renderToReadableStream(
      <StrictMode>
        <App ssrLocation={location} />
      </StrictMode>,
      {
        onError(err: unknown) {
          // 任何渲染期错误都退回 500 但仍返回完整 HTML(让客户端 hydrate 兜底)
          status = 500;
          console.error('[SSR] render error:', err);
        },
      },
    );

    // 等待所有 Suspense 边界完成(React 19 支持)
    await stream.allReady.catch((err: unknown) => {
      status = 500;
      console.error('[SSR] stream not ready:', err);
    });

    const body = await new Response(stream).text();

    // 注入 SSR 数据:在 <head> 末尾或 <body> 开头插入 <script>
    const ssrScript = `<script>window.__SSR_DATA__=${JSON.stringify(envelope).replace(/</g, '\\u003c').replace(/--\u003e/g, '--\\u003e')};</script>`;
    let withScript = indexHtml;
    if (withScript.includes('</head>')) {
      withScript = withScript.replace('</head>', `${ssrScript}\n  </head>`);
    } else {
      withScript = ssrScript + withScript;
    }

    // 替换 <div id="root"></div> 为带渲染结果的版本
    responseBody = withScript.replace(
      /<div id="root"[^>]*><\/div>/,
      `<div id="root">${body}</div>`,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[SSR] fatal:', msg);
    // 兜底:返回原始模板,让客户端走 CSR
    const ssrScript = `<script>window.__SSR_DATA__=${JSON.stringify(envelope).replace(/</g, '\\u003c').replace(/--\u003e/g, '--\\u003e')};</script>`;
    responseBody = indexHtml.replace(
      /<div id="root"[^>]*><\/div>/,
      `<div id="root"></div>${ssrScript}`,
    );
    status = 200; // 让客户端 hydrate 兜底,不返回 5xx 影响用户体验
  }

  return { html: responseBody, status, error: status === 500 ? 'SSR partial' : undefined };
}
