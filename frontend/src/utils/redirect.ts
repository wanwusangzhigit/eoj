/**
 * 登录回跳工具：从 URL 查询参数或 sessionStorage 中安全地存取 redirect 目标。
 *
 * 安全约束（防开放重定向）：
 *  - 必须以 `/` 开头
 *  - 不能以 `//` 开头（协议相对 URL 会被浏览器解释为外部站点）
 *  - 不能指向登录流程自身（/login、/register、/auth/callback、/forgot-password、/reset-password），避免循环
 *  - 不能含空白字符（防止 `javascript:`、`data:` 等通过空白绕过 startsWith 检查）
 */

const DENY = ['/login', '/register', '/auth/callback', '/forgot-password', '/reset-password'];

export function safeRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p: string;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!p.startsWith('/')) return null;
  if (p.startsWith('//')) return null;
  const pathOnly = p.split('?', 1)[0].split('#', 1)[0];
  if (DENY.includes(pathOnly)) return null;
  if (/\s/.test(p)) return null;
  return p;
}

const STORAGE_KEY = 'login_redirect';

/**
 * 把 redirect 目标暂存到 sessionStorage，供 OAuth 流程（GitHub / CpOAuth）回跳后取回。
 * 仅在浏览器侧有效；SSR 阶段调用为 no-op。
 */
export function stashRedirect(path: string): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // sessionStorage 不可用（隐私模式等）时静默忽略
  }
}

/**
 * 取出并清除暂存的 redirect（取出即消费，避免重复跳转）。
 * 返回值会再过一次 safeRedirect 验证。
 */
export function consumeStashedRedirect(): string | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    if (v) window.sessionStorage.removeItem(STORAGE_KEY);
    return safeRedirect(v);
  } catch {
    return null;
  }
}
