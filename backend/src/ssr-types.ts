/**
 * SSR 数据 envelope 的类型镜像(后端版本)。
 * 前端 src/ssr/hydrate.ts 中的 SSRDataEnvelope 与之保持一致。
 * 这里独立一份是为了让后端打包不依赖前端的导入路径。
 */
export interface SSRGlobalData {
  settings?: Record<string, string>;
  friendLinks?: { id: number; name: string; url: string; description: string; icon: string }[];
  pages?: { id: number; slug: string; title: string }[];
  user?: {
    id: number;
    username: string;
    role: string;
    permissions?: string[];
    avatar_url?: string;
    created_at?: string;
  } | null;
  unreadMessages?: number;
  userSettings?: { theme?: 'dark' | 'light'; custom_css?: string };
  theme?: 'dark' | 'light';
  language?: 'zh' | 'en';
  serverTime?: number;
}

export interface SSRPageData {
  [key: string]: unknown;
}

export interface SSRDataEnvelope {
  global: SSRGlobalData;
  path: string;
  page: SSRPageData;
}
