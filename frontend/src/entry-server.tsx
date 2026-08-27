/**
 * 服务端渲染入口。由后端 Worker 在 SSR 时调用:
 *
 * ```ts
 * import { render } from '../ssr/entry-server.js';
 * const { html, status } = await render(url, initialData);
 * ```
 *
 * 该文件会被 Vite 单独打包成 SSR bundle(esm),输出到 frontend/dist/server/。
 *
 * 关键点:
 * - 使用 react-dom/server 的 renderToReadableStream (Web Streams,Workers 兼容)
 * - 复用客户端 App.tsx 的路由树,但外层用 StaticRouter
 * - Suspense + lazy 可在服务端 stream 渲染(React 19 支持)
 * - 错误时返回基础 HTML 让客户端 hydrate 兜底
 */
import { StrictMode } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import App from './App';
import { serializeSSRData } from './ssr/hydrate';
import { setLanguage } from './i18n';
import type { SSRDataEnvelope } from './ssr/hydrate';

export interface RenderResult {
  html: string;
  status: number;
  error?: string;
}

/**
 * 渲染当前 URL 为 HTML 字符串,并把 SSR 数据 envelope 注入。
 */
export async function render(
  url: string,
  envelope: SSRDataEnvelope,
  indexHtml: string,
): Promise<RenderResult> {
  const urlObj = new URL(url, 'http://localhost');
  const location = urlObj.pathname + urlObj.search;

  // 服务端渲染前,先按请求的 lang cookie 设置 i18n 语言,
  // 保证 SSR 输出的文案与客户端 hydrate 一致(避免 hydration mismatch)。
  const lang = envelope.global.language;
  if (lang === 'zh' || lang === 'en') {
    setLanguage(lang);
  }

  let status = 200;

  // 注入 SSR 数据:用 application/json script 标签,不触发 CSP 拦截。
  // 同时把 #root 替换为渲染结果。
  const inject = (html: string, rootContent: string): string => {
    const ssrDataTag = serializeSSRData(envelope);
    const withData = html.includes('</head>')
      ? html.replace('</head>', `${ssrDataTag}\n  </head>`)
      : ssrDataTag + html;
    return withData.replace(
      /<div id="root"[^>]*><\/div>/,
      `<div id="root">${rootContent}</div>`,
    );
  };

  let responseBody: string;
  try {
    const stream = await renderToReadableStream(
      <StrictMode>
        <App ssrLocation={location} />
      </StrictMode>,
      {
        onError(err: unknown) {
          status = 500;
          console.error('[SSR] render error:', err);
        },
      },
    );

    await stream.allReady.catch((err: unknown) => {
      status = 500;
      console.error('[SSR] stream not ready:', err);
    });

    const body = await new Response(stream).text();
    responseBody = inject(indexHtml, body);
  } catch (e: unknown) {
    console.error('[SSR] fatal:', e instanceof Error ? e.message : String(e));
    responseBody = inject(indexHtml, '');
    status = 200;
  }

  return { html: responseBody, status, error: status === 500 ? 'SSR partial' : undefined };
}