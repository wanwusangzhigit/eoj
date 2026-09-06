import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import App from './App.tsx';
import { getSiteConfig } from './hooks/useSiteConfig';
import { consumeSSRData, setSSRCache, readBrowserCookie } from './ssr/hydrate';
import { primeAuthFromSSR } from './store/auth';
import { setLanguage } from './i18n';

/**
 * 客户端入口(hydrate 模式)。
 *
 * 流程:
 * 1. 从 window.__SSR_DATA__ 取出后端注入的 SSR 数据 envelope
 * 2. 推入模块级 cache,供各 store 与页面读取
 * 3. 用初始数据预热 auth store(免去一次 /me 请求)
 * 4. 用 SSR 的主题/语言同步设置 html 属性,避免 FOUC
 * 5. hydrateRoot(在 SSR 渲染好的 DOM 上挂载事件,而非 createRoot 全量重渲)
 */

// 1. 消费 SSR 数据
const ssrEnvelope = consumeSSRData();
setSSRCache(ssrEnvelope);

// 2. 预热 auth store(把 SSR 注入的 user 写入 zustand 初始状态)
primeAuthFromSSR(ssrEnvelope);

// 3. 应用主题样式(SSR 已在 html 标签上设置 data-theme,这里仅同步 store 状态)
//    由 store/theme.ts 模块加载时执行 resolveInitialTheme 完成首次同步。
const siteTheme = getSiteConfig().site.theme;
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme-style', siteTheme);
}

// 4. 设置语言(SSR 注入优先,然后查 cookie,默认 zh)
const ssrLang = ssrEnvelope?.global.language;
const cookieLang = readBrowserCookie('lang');
const lang = (ssrLang || cookieLang) as 'zh' | 'en';
if (lang === 'zh' || lang === 'en') {
  setLanguage(lang);
}

// 5. PWA:注册 service worker(仅生产环境,避免开发模式 HMR 被缓存干扰)
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 注册失败(如隐私模式/不支持)不影响应用使用
    });
  });
}

// 6. Hydrate SSR 渲染好的 DOM(关键:用 hydrateRoot 替代 createRoot)
const rootEl = document.getElementById('root');
if (rootEl) {
  hydrateRoot(
    rootEl,
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
