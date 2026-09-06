/**
 * SSR 数据注入与消费机制
 *
 * 工作流:
 * 1. 后端 SSR 时,根据 URL 匹配路由,执行对应 loader 得到 `initialData`
 * 2. 渲染 HTML 时,把 initialData 序列化为 JSON 写入 `<script>window.__SSR_DATA__=...</script>`
 * 3. 客户端 hydrateRoot 前,从 window.__SSR_DATA__ 取出并存入内存 cache
 * 4. 页面通过 `useSSRInitialData(key)` 拿到首屏数据(直接 setState,不发请求)
 * 5. 客户端导航触发时,缓存已被消费,页面走原有的 useEffect 拉取逻辑
 *
 * 这样的设计最小侵入:页面结构不变,只是在 useState 初始值位置注入 SSR 数据。
 */

export interface SSRGlobalData {
  // 站点级数据:每次请求都加载
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
  // 用户主题设置(登录用户)
  userSettings?: { theme?: 'dark' | 'light'; custom_css?: string };
  // 客户端主题:从 cookie 或 localStorage 取到的初始值
  theme?: 'dark' | 'light';
  language?: 'zh' | 'en';
  // 服务端时间戳,用于比赛倒计时与服务端时间对齐
  serverTime?: number;
}

export interface SSRPageData {
  // 当前路由专属数据,键名由页面与 loader 协商
  [key: string]: unknown;
}

export interface SSRDataEnvelope {
  global: SSRGlobalData;
  // 当前页面路径(用于客户端校验是否匹配)
  path: string;
  // 当前页面数据,按 page key 命名空间
  page: SSRPageData;
}

const SSR_DATA_ELEMENT_ID = '__SSR_DATA__';

/**
 * 服务端渲染时注入的 HTML 片段。
 *
 * 使用 `<script type="application/json">` 而非可执行 `<script>`:
 * - JSON 类型的 script 不含可执行代码,不受 CSP `script-src` 限制(无需 'unsafe-inline')
 * - 避免内联脚本与生产环境的严格 CSP 冲突
 *
 * JSON 内 `</` 必须转义为 `<\/`,防止提前结束 <script> 标签。
 */
export function serializeSSRData(data: SSRDataEnvelope): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/--\u003e/g, '--\\u003e');
  return `<script type="application/json" id="${SSR_DATA_ELEMENT_ID}">${json}</script>`;
}

/**
 * 客户端:从 `<script type="application/json">` 元素读取 SSR 数据并移除该元素。
 * 避免污染 window(全局命名空间)与重复消费。仅在浏览器入口调用一次。
 */
export function consumeSSRData(): SSRDataEnvelope | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(SSR_DATA_ELEMENT_ID);
  if (!el || !el.textContent) return null;
  try {
    const data = JSON.parse(el.textContent) as SSRDataEnvelope;
    el.remove();
    return data;
  } catch {
    // 解析失败(不可能发生,除非被篡改)返回 null
    return null;
  }
}

/**
 * 客户端入口接管后,持有 SSR 数据的模块级缓存。
 * 页面通过 useSSRInitialData 读取。
 */
let cachedEnvelope: SSRDataEnvelope | null = null;

export function setSSRCache(envelope: SSRDataEnvelope | null): void {
  cachedEnvelope = envelope;
}

export function getSSRCache(): SSRDataEnvelope | null {
  return cachedEnvelope;
}

export function getSSRGlobal(): SSRGlobalData | null {
  return cachedEnvelope?.global ?? null;
}

/**
 * 页面调用:取出 SSR 首屏数据。返回 null 表示没有 SSR 数据(走客户端拉取)。
 * 仅在组件初始化时调用一次,数据被消费后从缓存移除。
 */
export function consumeSSRPageData(pageKey: string): unknown | null {
  if (!cachedEnvelope) return null;
  // 校验当前 pathname 与 SSR 渲染时的 path 一致(避免 SPA 跳转后误用旧数据)
  if (typeof window !== 'undefined' && window.location.pathname !== cachedEnvelope.path) {
    return null;
  }
  const data = cachedEnvelope.page[pageKey];
  if (data === undefined) return null;
  // 一次性消费:删除避免后续 useEffect 二次 setState 造成闪烁
  delete cachedEnvelope.page[pageKey];
  return data;
}

/**
 * 工具:从 cookie 字符串读取值(客户端入口对主题/语言做服务端一致初始化)。
 */
export function readBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      try {
        return decodeURIComponent(trimmed.slice(target.length));
      } catch {
        return trimmed.slice(target.length);
      }
    }
  }
  return null;
}
