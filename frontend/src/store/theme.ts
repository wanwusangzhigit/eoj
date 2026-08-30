import { create } from 'zustand';

interface ThemeState {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  applyServerTheme: (theme: 'dark' | 'light') => void;
}

// Follow the OS color scheme when the user hasn't chosen a theme manually.
const getSystemTheme = (): 'dark' | 'light' =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

const savedTheme = (() => {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem('theme') : null;
  return v === 'dark' || v === 'light' ? v : getSystemTheme();
})();

// 主题切换时同步到服务端 user_settings(仅登录用户),实现跨设备恢复
async function syncToServer(theme: 'dark' | 'light') {
  try {
    // 通过 localStorage 判断是否已登录(getToken 是 ApiClient 私有方法,不便直接访问)
    const hasToken = typeof localStorage !== 'undefined' && !!localStorage.getItem('token');
    if (!hasToken) return;
    const { api } = await import('../api/client');
    await api.saveUserSettings({ theme });
  } catch {
    // 同步失败不影响本地切换
  }
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: savedTheme,
  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', newTheme);
      document.documentElement.setAttribute('data-theme', newTheme);
      syncToServer(newTheme);
      return { theme: newTheme };
    }),
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    syncToServer(theme);
    set({ theme });
  },
  // 登录后从服务端应用用户保存的主题(仅当用户未在本机手动选择过)
  applyServerTheme: (theme) => {
    const manual = typeof localStorage !== 'undefined' ? localStorage.getItem('theme') : null;
    if (manual === 'dark' || manual === 'light') return; // 本机选择优先
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
}));

// Initialize theme on load
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', savedTheme);
}

// Follow the OS color scheme while the user hasn't manually chosen a theme.
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', (e) => {
    const manual = localStorage.getItem('theme');
    if (manual !== 'dark' && manual !== 'light') {
      const next = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      useThemeStore.setState({ theme: next });
    }
  });
}
