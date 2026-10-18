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
import { getSiteConfig } from './hooks/useSiteConfig';
import { injectThemeAttributesIntoHtml } from './utils/siteTheme';
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
    let withData = html.includes('</head>')
      ? html.replace('</head>', `${ssrDataTag}\n  </head>`)
      : ssrDataTag + html;
    // 首屏直接输出主题属性(SSR HTML 默认写死 default/dark),
    // 避免 hydrate 前闪一下默认主题配色。
    // notebook 主题特殊：保留 data-theme-style="default" 同时注入 data-theme-flavor="notebook"。
    try {
      const siteTheme = getSiteConfig().site.theme;
      withData = injectThemeAttributesIntoHtml(withData, siteTheme);
    } catch { /* 读不到配置就保持默认 */ }
    const ssrTheme = envelope.global.theme;
    if (ssrTheme === 'dark' || ssrTheme === 'light') {
      withData = withData.replace('data-theme="dark"', `data-theme="${ssrTheme}"`);
    }
    return withData.replace(
      /<div id="root"[^>]*><\/div>/,
      `<div id="root">${rootContent}</div>`,
    );
  };

  // SSR 渲染。任何 render 抛错都不再静默吞掉——返回空 root 会让客户端
  // hydrate 时报 #418(因为客户端能正常渲染,但 DOM 与"服务端空 root"不一致)。
  // 让错误向上抛,后端 ssr.ts 的 catch 会返回 null,触发 SPA 壳子回退。
  //
  // 诊断模式:把错误堆栈作为 HTML 注释注入到 root 内,方便排查生产 SSR 故障。
  // 渲染成功时 root 内容是真实 React DOM,诊断注释只挂在失败路径。
  const escapeForComment = (s: string): string => s.replace(/-/g, '\\u002d').slice(0, 800);
  let diagnosticComment = '';
  let stream;
  try {
    stream = await renderToReadableStream(
      <StrictMode>
        <App ssrLocation={location} />
      </StrictMode>,
      {
        onError(err: unknown, info?: { componentStack?: string }) {
          status = 500;
          const stack = err instanceof Error ? err.stack || err.message : String(err);
          console.error('[SSR] render error:', stack);
          if (info?.componentStack) {
            console.error('[SSR] componentStack:', String(info.componentStack).slice(0, 600));
          }
          // 累积首个错误的栈,作为 HTML 注释注入到 root
          if (!diagnosticComment) {
            const cs = info?.componentStack ? '\\nCOMPONENT_STACK:' + String(info.componentStack).slice(0, 400) : '';
            diagnosticComment = '<!--SSR_ERROR:' + escapeForComment(stack) + escapeForComment(cs) + '-->';
          }
        },
      },
    );
  } catch (e: unknown) {
    const stack = e instanceof Error ? e.stack || e.message : String(e);
    console.error('[SSR] renderToReadableStream threw:', stack);
    return { html: inject(indexHtml, '<!--SSR_INIT_ERROR:' + escapeForComment(stack) + '-->'), status: 200, error: 'SSR init error' };
  }

  await stream.allReady.catch((err: unknown) => {
    status = 500;
    const stack = err instanceof Error ? err.stack || err.message : String(err);
    console.error('[SSR] stream not ready:', stack);
    if (!diagnosticComment) {
      diagnosticComment = '<!--SSR_STREAM_ERROR:' + escapeForComment(stack) + '-->';
    }
  });

  const body = await new Response(stream).text();
  const responseBody = inject(indexHtml, body + diagnosticComment);

  return { html: responseBody, status, error: status === 500 ? 'SSR partial' : undefined };
}