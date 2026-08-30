import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import YAML from 'yaml'

// Cloudflare Workers ASSETS 绑定模式：
// 生产构建时 base 设为 '/'，前端资源从 Worker 根路径提供
// API 请求走 /api/v1 前缀，由 Worker 路由处理（不经过 ASSETS）
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VITE_ASSETS_MODE;

// 读取 config.yaml
const ROOT_DIR = resolve(__dirname, '.');
const configPath = resolve(ROOT_DIR, 'config.yaml');
let siteConfig: Record<string, unknown> = {};
if (existsSync(configPath)) {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    siteConfig = YAML.parse(raw) || {};
  } catch {
    siteConfig = {};
  }
}

export default defineConfig({
  root: ROOT_DIR,
  publicDir: resolve(ROOT_DIR, 'public'),
  plugins: [
    react(),
    {
      name: 'inject-site-config',
      transformIndexHtml(html: string) {
        const name = (siteConfig as any)?.site?.name || 'OJ System';
        return html.replace(/<title>.*?<\/title>/, `<title>${name} - Online Judge</title>`);
      },
    },
    {
      // 生产构建注入 CSP meta(开发模式不注入:Vite react-refresh 需要内联脚本,
      // KaTeX/DOMPurify 渲染 markdown 时也会注入 <style> 与 style 属性,严格 CSP
      // 会破坏开发体验;生产产物全为打包后的同源资源,可启用严格策略)。
      name: 'inject-csp',
      transformIndexHtml(html: string) {
        if (!isProduction) return html;
        const csp = [
          "default-src 'self'",
          // AdSense 脚本 + Cloudflare Web Analytics beacon(可选功能,未启用广告位时不影响)
          "script-src 'self' https://pagead2.googlesyndication.com https://static.cloudflareinsights.com",
          // KaTeX 与 DOMPurify 白名单内的 style 属性需内联样式
          "style-src 'self' 'unsafe-inline'",
          // 头像/图标可能来自外部 CDN
          "img-src 'self' data: https:",
          "font-src 'self' data:",
          // API/SSE 同源;一言来自外部接口
          "connect-src 'self' https://v1.hitokoto.cn",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return html.replace(
          /<meta name="viewport"[^>]*>/,
          (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
        );
      },
    },
  ],
  define: {
    SITE_CONFIG: JSON.stringify(siteConfig),
  },
  base: isProduction ? '/' : '/',
  build: {
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: isProduction ? {
      output: {
        // Split third-party libraries into their own chunks so the main
        // entry stays small and vendors are cached across deploys.
        // NOTE: rolldown (Vite 8) only accepts a FUNCTION here.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('codemirror') || id.includes('@lezer')) return 'codemirror';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('marked') || id.includes('dompurify')) return 'markdown';
          if (id.includes('katex')) return 'katex';
          if (id.includes('zustand')) return 'state';
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
          return 'vendor';
        },
      },
    } : {},
  },
})
