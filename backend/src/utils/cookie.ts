import type { Context } from 'hono';
import type { AppType } from '../types';

/**
 * 从 Cookie header 取出指定名字的值(解码)。找不到返回 null。
 */
export function getCookie(c: Context<AppType>, name: string): string | null {
  const cookieHeader: string = c.req.header('Cookie') || '';
  if (!cookieHeader) return null;
  const target = `${name}=`;
  for (const part of cookieHeader.split(';')) {
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

/**
 * 从请求里取出认证 token:优先 httpOnly cookie,然后回退到 Authorization 头。
 * 保留 Header 通道是为了渐进迁移期兼容旧客户端(SPA 老缓存、移动端等)。
 */
export function getAuthTokenFromRequest(c: Context<AppType>): string | null {
  const cookieToken = getCookie(c, 'token');
  if (cookieToken) return cookieToken;
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/**
 * 设置认证 Cookie。HttpOnly + Secure + SameSite=Lax + Path=/
 * 让 SSR 与同源 fetch 都能读到。生产用 Secure,本地 http 调试时通过
 * `wrangler dev --local` 的 localhost 不强制 Secure。
 */
export function setAuthCookie(c: Context<AppType>, token: string): void {
  const isHttps = new URL(c.req.url).protocol === 'https:'
    || c.req.header('x-forwarded-proto') === 'https';
  const secure = isHttps ? '; Secure' : '';
  // 注意:SameSite=Lax 让 OAuth 跨域回跳后落地 cookie 到目标域时仍可用,
  // 同时阻止跨站 POST 自动携带 cookie(抵御大部分 CSRF)。
  // 实际 CSRF 由 API 仅接受 application/json + 校验自定义头来兜底。
  c.header(
    'Set-Cookie',
    `token=${encodeURIComponent(token)}; Path=/; Max-Age=604800; SameSite=Lax${secure}; HttpOnly`,
    { append: true },
  );
}

/**
 * 清除认证 Cookie。用于 logout 与 401 自动登出场景。
 */
export function clearAuthCookie(c: Context<AppType>): void {
  const isHttps = new URL(c.req.url).protocol === 'https:'
    || c.req.header('x-forwarded-proto') === 'https';
  const secure = isHttps ? '; Secure' : '';
  c.header(
    'Set-Cookie',
    `token=; Path=/; Max-Age=0; SameSite=Lax${secure}; HttpOnly`,
    { append: true },
  );
}
