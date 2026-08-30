import { create } from 'zustand';
import { api } from '../api/client';

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
  token: string | null;
  isLoading: boolean;
  setToken: (token: string) => void;
  fetchUser: () => Promise<void>;
  logout: () => void;
}

// Listen for auth:expired events from API client
if (typeof window !== 'undefined') {
  window.addEventListener('auth:expired', () => {
    useAuthStore.setState({ user: null, token: null });
  });
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  isLoading: false,

  setToken: (token: string) => {
    localStorage.setItem('token', token);
    set({ token });
  },

  fetchUser: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ user: null, token: null });
      return;
    }
    set({ isLoading: true });
    try {
      const { user } = await api.getMe();
      set({ user, isLoading: false });
    } catch {
      localStorage.removeItem('token');
      set({ user: null, token: null, isLoading: false });
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null });
  },
}));
