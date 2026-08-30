import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { getSiteConfig } from './hooks/useSiteConfig'

// Synchronously apply the configured site theme-style BEFORE first paint.
// This avoids a flash of unstyled/wrong-theme content: the CSS relies on
// [data-theme-style] (default/luogu/hydro) to scope variables and rules,
// so the attribute must be set before React renders.
const siteTheme = getSiteConfig().site.theme
document.documentElement.setAttribute('data-theme-style', siteTheme)

// PWA:注册 service worker(仅生产环境,避免开发模式 HMR 被缓存干扰)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 注册失败(如隐私模式/不支持)不影响应用使用
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
