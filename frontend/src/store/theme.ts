import { create } from 'zustand';
import { getSSRGlobal, readBrowserCookie } from '../ssr/hydrate';

interface ThemeState {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  applyServerTheme: (theme: 'dark' | 'light') => void;
}

/**
 * 解析初始主题。优先级:
 * 1. SSR 注入的全局数据(theme,来自后端读 cookie)
 * 2. 客户端 cookie(theme=dark|light)
 * 3. 客户端 localStorage(保留兼容)
 * 4. 系统偏好(matchMedia)
 *
 * 注意:本函数仅在客户端入口执行一次(useThemeStore 创建时),
 * SSR 阶段服务端会用从 cookie 读到的值注入 html data-theme 属性,避免 FOUC。
 */
function resolveInitialTheme(): 'dark' | 'light' {
  // 1. SSR 注入
  const ssrTheme = getSSRGlobal()?.theme;
  if (ssrTheme === 'dark' || ssrTheme === 'light') return ssrTheme;
  // 仅浏览器继续往下走
  if (typeof window === 'undefined') return 'dark';

  // 2. cookie
  const cookieTheme = readBrowserCookie('theme');
  if (cookieTheme === 'dark' || cookieTheme === 'light') return cookieTheme;

  // 3. localStorage(老用户)
  try {
    const v = localStorage.getItem('theme');
    if (v === 'dark' || v === 'light') return v;
  } catch { /* ignore */ }

  // 4. 系统偏好
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function persistTheme(theme: 'dark' | 'light') {
  // cookie 让服务端下次 SSR 时能读到(注意需可见,不要 HttpOnly)
  try {
    document.cookie = `theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch { /* ignore */ }
  try {
    localStorage.setItem('theme', theme);
  } catch { /* ignore */ }
}

function applyThemeAttr(theme: 'dark' | 'light') {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// 服务端创建 store 时 resolveInitialTheme 走 SSR 分支;客户端入口创建时
// resolveInitialTheme 走 cookie/localStorage 分支。这是一个模块级单例,
// 由于 SSR 服务端每次请求都重新执行模块(Wrangler 隔离),不会跨请求污染。
const initialTheme = resolveInitialTheme();
applyThemeAttr(initialTheme);

// 主题切换时同步到服务端 user_settings(仅登录用户),实现跨设备恢复
async function syncToServer(theme: 'dark' | 'light') {
  try {
    const hasUser = !!useAuthStore.getState?.().user;
    if (!hasUser) return;
    const { api } = await import('../api/client');
    await api.saveUserSettings({ theme });
  } catch {
    // 同步失败不影响本地切换
  }
}

// 延迟引入 auth store,避免循环依赖
let useAuthStore: { getState: () => { user: unknown | null } } = {
  getState: () => ({ user: null }),
};
(async () => {
  try {
    const mod = await import('../store/auth');
    useAuthStore = mod.useAuthStore as any;
  } catch { /* ignore */ }
})();

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      persistTheme(newTheme);
      applyThemeAttr(newTheme);
      syncToServer(newTheme);
      return { theme: newTheme };
    }),
  setTheme: (theme) => {
    persistTheme(theme);
    applyThemeAttr(theme);
    syncToServer(theme);
    set({ theme });
  },
  applyServerTheme: (theme) => {
    // SSR 注入或 /user/settings 拿到服务端主题后,仅当客户端没有显式选择时才覆盖
    let manual: string | null = null;
    try {
      manual = readBrowserCookie('theme');
      if (manual !== 'dark' && manual !== 'light') {
        manual = localStorage.getItem('theme');
      }
    } catch { /* ignore */ }
    if (manual === 'dark' || manual === 'light') return;
    persistTheme(theme);
    applyThemeAttr(theme);
    set({ theme });
  },
}));

// 跟随系统主题(仅客户端,且仅当用户未显式选择时)
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', (e) => {
    let manual: string | null = null;
    try {
      manual = readBrowserCookie('theme') || localStorage.getItem('theme');
    } catch { /* ignore */ }
    if (manual !== 'dark' && manual !== 'light') {
      const next = e.matches ? 'dark' : 'light';
      applyThemeAttr(next);
      useThemeStore.setState({ theme: next });
    }
  });
}
