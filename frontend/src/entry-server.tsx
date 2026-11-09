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
import { serializeSSRData, SSREnvelopeContext } from './ssr/hydrate';
import { setLanguage } from './i18n';
import { getSiteConfig } from './hooks/useSiteConfig';
import { injectThemeAttributesIntoHtml } from './utils/siteTheme';
import type { SSRDataEnvelope } from './ssr/hydrate';

export interface RenderResult {
  html: string;
  status: number;
  error?: string;
}

const PEND_MARK = '<!--$?-->';
const SEG_CLOSE = '</div>';

/**
 * 从 `<div hidden …>` 的开标签之后开始,返回其配对 `</div>` 的下标。
 * 扫描时跳过注释(React 的边界标记 `<!--$…-->` 本身也是注释),避免把标记当成标签。
 */
function findMatchingDivEnd(html: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    if (html.startsWith('<div', i)) {
      depth++;
      i += 4;
      continue;
    }
    if (html.startsWith(SEG_CLOSE, i)) {
      depth--;
      if (depth === 0) return i;
      i += SEG_CLOSE.length;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * 把流式 SSR 的挂起边界回填成同步渲染的形态:
 * `<!--$?--><template id="B:n"></template>{fallback}<!--/$-->`
 * 换成 `<!--$-->{分段内容}<!--/$-->`,并删掉 `<div hidden id="S:n">` 分段与 `$RC` 调用。
 * 搬运后的 HTML 与 React 自己"边界在壳落盘前完成"的输出一致,因此水合路径不变。
 */
function inlineCompletedBoundaries(html: string): string {
  let out = html;
  // 嵌套边界逐层搬运(实际最深 1 层,上限只是防御)
  for (let guard = 0; guard < 8; guard++) {
    const markIndex = out.indexOf(PEND_MARK);
    if (markIndex < 0) break;
    const tmpl = /^<template id="B:(\d+)"><\/template>/.exec(out.slice(markIndex + PEND_MARK.length));
    const segmentTag = `<div hidden id="S:${tmpl ? tmpl[1] : ''}">`;
    const segmentIndex = tmpl ? out.indexOf(segmentTag) : -1;
    if (!tmpl || segmentIndex < 0) break;
    const fallbackEnd = out.indexOf('<!--/$-->', markIndex + PEND_MARK.length + tmpl[0].length);
    if (fallbackEnd < 0) break;
    const contentStart = segmentIndex + segmentTag.length;
    const contentEnd = findMatchingDivEnd(out, contentStart);
    if (contentEnd < 0) break;
    const content = out.slice(contentStart, contentEnd);
    out =
      out.slice(0, markIndex) +
      `<!--$-->${content}<!--/$-->` +
      out.slice(fallbackEnd + '<!--/$-->'.length, segmentIndex) +
      out.slice(contentEnd + SEG_CLOSE.length);
    out = out.replace(new RegExp(`\\$RC\\("B:${tmpl[1]}","S:${tmpl[1]}"\\)`, 'g'), '');
  }
  // 搬运之后,React 为"把 hidden 分段搬进边界"准备的那两个内联运行时脚本($RT/$RB/$RV/$RC)
  // 已经没有作用,留着只会被 CSP(script-src 'self')拦下并在控制台报违规。
  return out.replace(/<script>(?:\$[A-Za-z]+=|requestAnimationFrame\(function\(\)\{\$RT)[\s\S]*?<\/script>/g, '');
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
  let initError: string | undefined;

  const renderPass = async (): Promise<string> => {
    let stream;
    try {
      stream = await renderToReadableStream(
        <StrictMode>
          <SSREnvelopeContext.Provider value={envelope}>
            <App ssrLocation={location} />
          </SSREnvelopeContext.Provider>
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
      initError = 'SSR init error';
      return '<!--SSR_INIT_ERROR:' + escapeForComment(stack) + '-->';
    }

    await stream.allReady.catch((err: unknown) => {
      status = 500;
      const stack = err instanceof Error ? err.stack || err.message : String(err);
      console.error('[SSR] stream not ready:', stack);
      if (!diagnosticComment) {
        diagnosticComment = '<!--SSR_STREAM_ERROR:' + escapeForComment(stack) + '-->';
      }
    });

    return await new Response(stream).text();
  };

  // React 的流式 SSR 会把"壳先落盘后才渲染完"的 Suspense 边界写成
  // `<!--$?-->` + fallback,真实内容放进 #root 末尾的 hidden 分段,再靠内联
  // `$RC()` 脚本搬运。生产 CSP(script-src 'self')拦掉了这些脚本:首屏永远停在
  // "加载中",DOM 里残留整页重复节点(重复 id / 重复 h1),水合随之报 #419/#418。
  // 内容已经全部渲染出来了,只是放错了位置,返回前搬运一次即可。
  const body = inlineCompletedBoundaries(await renderPass());

  return { html: inject(indexHtml, body + diagnosticComment), status, error: status === 500 ? 'SSR partial' : initError };
}