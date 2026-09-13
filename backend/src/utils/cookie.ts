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
 *
 * 同时接受 Hono Context 与裸 Request:SSR loader 持有原始 Request 时可直接调用。
 */
export function getAuthTokenFromRequest(c: Context<AppType>): string | null;
export function getAuthTokenFromRequest(req: { header: (name: string) => string | undefined | null }): string | null;
export function getAuthTokenFromRequest(input: any): string | null {
  // 优先 cookie。兼容三种输入:Hono Context(req.header)、Hono Request(header())、
  // 标准 Web Request(headers.get)——SSR loader 持有的是标准 Request。
  const cookieHeader: string =
    (input?.req?.header?.('Cookie') as string) ??
    (input?.header?.('Cookie') as string) ??
    (input?.headers?.get?.('Cookie') as string) ??
    '';
  const cookieToken = readCookieFromHeader(cookieHeader, 'token');
  if (cookieToken) return cookieToken;
  // 回退 Authorization 头
  const authHeader: string | undefined =
    (input?.req?.header?.('Authorization') as string) ??
    (input?.header?.('Authorization') as string) ??
    input?.headers?.get?.('Authorization') as string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

function readCookieFromHeader(cookieHeader: string, name: string): string | null {
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
 * 从 Cookie header 字符串读取值(SSR loader / 通用工具用)。
 */
export function readCookie(cookieHeader: string, name: string): string | null {
  return readCookieFromHeader(cookieHeader, name);
}

/**
 * 设置认证 Cookie。HttpOnly + Secure + SameSite=Lax + Path=/
 * 让 SSR 与同源 fetch 都能读到。
 *
 * 审计 #H-4: 旧实现基于 `x-forwarded-proto` 决定是否下发 `Secure`,
 * 该 header 在某些代理拓扑下可被客户端伪造,导致 MITM 攻击者可让
 * Workers 不下发 `Secure`,后续在 HTTP 上窃取 cookie。
 *
 * 新策略:无条件下发 `Secure`。理由:
 * 1. Cloudflare Workers 生产部署始终在 TLS 上对外服务;
 * 2. RFC 6265bis (Chrome/Firefox/Safari 已实现) 规定 `Secure` cookie
 *    仍会被发送到 `localhost`,因此本地 `wrangler dev` 不受影响;
 * 3. 即使部署在自定义反代后,若反代到 Worker 不是 TLS,那本身就是
 *    红线配置,不应通过 cookie 标志来"自适应"。
 */
export function setAuthCookie(c: Context<AppType>, token: string): void {
  // 注意:SameSite=Lax 让 OAuth 跨域回跳后落地 cookie 到目标域时仍可用,
  // 同时阻止跨站 POST 自动携带 cookie(抵御大部分 CSRF)。
  // 实际 CSRF 由 API 仅接受 application/json + 校验自定义头来兜底。
  c.header(
    'Set-Cookie',
    `token=${encodeURIComponent(token)}; Path=/; Max-Age=604800; SameSite=Lax; Secure; HttpOnly`,
    { append: true },
  );
}

/**
 * 清除认证 Cookie。用于 logout 与 401 自动登出场景。
 */
export function clearAuthCookie(c: Context<AppType>): void {
  c.header(
    'Set-Cookie',
    `token=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`,
    { append: true },
  );
}
