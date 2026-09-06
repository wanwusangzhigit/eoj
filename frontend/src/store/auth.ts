import { create } from 'zustand';
import { api } from '../api/client';
import { getSSRGlobal, setSSRCache, type SSRDataEnvelope } from '../ssr/hydrate';

interface User {
  id: number;
  username: string;
  role: string;
  permissions?: string[];
  avatar_url?: string;
  created_at?: string;
}

interface AuthState {
  user: User | null;
  // token 字段保留用于老代码读取,但不再做 localStorage 持久化(SSR 时代由 httpOnly cookie 承载)
  token: string | null;
  isLoading: boolean;
  fetchUser: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

// 服务端 SSR 已经查询过 /me 并把结果注入到 SSR 全局数据里;客户端入口会把
// SSR envelope 注入 cache,这里读一次即可拿到首屏 user 状态(不发请求)。
const ssrGlobal = getSSRGlobal();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: ssrGlobal?.user ?? null,
  token: null,
  isLoading: false,

  fetchUser: async () => {
    // SSR 已注入 user 时跳过首次拉取
    if (get().user) return;
    set({ isLoading: true });
    try {
      const { user } = await api.getMe();
      set({ user, isLoading: false });
    } catch {
      set({ user: null, isLoading: false });
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      // 即使服务端调用失败也清空本地状态
    }
    set({ user: null });
  },

  setUser: (user) => set({ user }),
}));

// 监听 API client 抛出的 auth:expired 事件(SSR 后 token 过期场景)
if (typeof window !== 'undefined') {
  window.addEventListener('auth:expired', () => {
    useAuthStore.setState({ user: null });
  });
}

/**
 * 客户端入口调用:把 SSR 注入的 envelope 推入 cache,并预热 auth store。
 */
export function primeAuthFromSSR(envelope: SSRDataEnvelope | null): void {
  setSSRCache(envelope);
  if (envelope?.global?.user) {
    useAuthStore.setState({ user: envelope.global.user });
  }
}
