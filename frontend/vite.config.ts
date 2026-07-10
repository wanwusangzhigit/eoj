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
  ],
  define: {
    SITE_CONFIG: JSON.stringify(siteConfig),
  },
  base: isProduction ? '/' : '/',
  build: {
    // ASSETS 模式下不拆分 chunk，生成单一入口
    rollupOptions: isProduction ? {
      output: {
        manualChunks: undefined,
      },
    } : {},
  },
})
