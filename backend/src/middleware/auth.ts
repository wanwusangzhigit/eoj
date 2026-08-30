import { Context, Next } from 'hono';
import { AppType } from '../types';

export async function authMiddleware(c: Context<AppType>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }

  const token = authHeader.slice(7);
  const { verifyJWT } = await import('../utils/jwt');
  const payload = await verifyJWT(token, c.env.JWT_SECRET, (c.env as any).JWT_SECRET_PREVIOUS);
  if (!payload) {
    return c.json({ success: false, error: { message: 'Invalid or expired token', code: 'UNAUTHORIZED' } }, 401);
  }

  // 服务端实时校验:从 DB 读取最新的 banned / role / permissions,
  // 防止用户被降级、封禁或权限变更后旧 token 仍长期生效。
  // 失败时 fail-closed(拒绝请求)以保证安全状态优先。
  try {
    const row: any = await c.env.DB.prepare(
      'SELECT banned, role, permissions FROM users WHERE id = ?'
    ).bind(payload.userId).first();
    if (!row) {
      return c.json({ success: false, error: { message: 'Invalid or expired token', code: 'UNAUTHORIZED' } }, 401);
    }
    if (row.banned === 1) {
      return c.json({ success: false, error: { message: 'Account banned', code: 'ACCOUNT_BANNED' } }, 403);
    }
    // 用 DB 中的最新值覆盖 token 内的权限声明
    payload.role = row.role || payload.role;
    let dbPermissions: string[] = payload.permissions || [];
    try {
      const parsed = row.permissions ? JSON.parse(row.permissions) : [];
      if (Array.isArray(parsed)) dbPermissions = parsed;
    } catch { /* 保留 token 内的 permissions */ }
    payload.permissions = dbPermissions;
  } catch (e) {
    // DB 异常时拒绝请求,防止通过制造 DB 故障绕过封禁
    return c.json({ success: false, error: { message: 'Authentication service unavailable', code: 'AUTH_UNAVAILABLE' } }, 503);
  }

  c.set('user', payload);
  await next();
}

// 可选鉴权:有有效 token 则解析用户并写入 c.get('user'),无 token 或 token 无效则放行(不 401)。
// 用于公开接口中需要区分「已登录用户」与「游客」的场景(如比赛详情返回 is_registered)。
export async function optionalAuthMiddleware(c: Context<AppType>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { verifyJWT } = await import('../utils/jwt');
    const payload = await verifyJWT(token, c.env.JWT_SECRET, (c.env as any).JWT_SECRET_PREVIOUS);
    if (payload) {
      // 同步数据库中的最新状态(role/permissions/banned),保证可选鉴权场景下的权限一致
      try {
        const row: any = await c.env.DB.prepare(
          'SELECT banned, role, permissions FROM users WHERE id = ?'
        ).bind(payload.userId).first();
        if (row && row.banned === 1) {
          // 已封禁账号在可选鉴权下视为未登录,避免污染公开接口
        } else if (row) {
          payload.role = row.role || payload.role;
          let dbPermissions: string[] = payload.permissions || [];
          try {
            const parsed = row.permissions ? JSON.parse(row.permissions) : [];
            if (Array.isArray(parsed)) dbPermissions = parsed;
          } catch { /* ignore */ }
          payload.permissions = dbPermissions;
          c.set('user', payload);
        }
      } catch { /* DB 异常时使用 token 内声明,公开接口继续可访问 */ }
    }
  }
  await next();
}

export async function adminMiddleware(c: Context<AppType>, next: Next) {
  const user = c.get('user');
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin' && user.userId !== 1)) {
    return c.json({ success: false, error: { message: 'Forbidden: admin only', code: 'FORBIDDEN' } }, 403);
  }
  await next();
}

export async function superAdminMiddleware(c: Context<AppType>, next: Next) {
  const user = c.get('user');
  if (!user || user.userId !== 1) {
    return c.json({ success: false, error: { message: 'Forbidden: super admin only', code: 'FORBIDDEN' } }, 403);
  }
  await next();
}

// Check if user has admin-level access (admin role or super admin)
export function isAdmin(user: any): boolean {
  if (!user) return false;
  return user.userId === 1 || user.role === 'admin' || user.role === 'super_admin';
}

// Check if user has a specific permission
function hasPermission(user: any, permission: string): boolean {
  // Super admin (user id=1) always has all permissions
  if (user.userId === 1) return true;
  // Admin/super_admin role has all permissions
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  // Check specific permissions
  const permissions: string[] = user.permissions || [];
  return permissions.includes(permission);
}

// Permission middleware factories
export function permissionMiddleware(permission: string) {
  return async (c: Context<AppType>, next: Next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
    }
    if (!hasPermission(user, permission)) {
      return c.json({ success: false, error: { message: `Forbidden: requires ${permission}`, code: 'FORBIDDEN' } }, 403);
    }
    await next();
  };
}

// Convenience middlewares for each permission type
export const contestAdminMiddleware = permissionMiddleware('contest_admin');
export const problemAdminMiddleware = permissionMiddleware('problem_admin');
export const listAdminMiddleware = permissionMiddleware('list_admin');
export const ticketAdminMiddleware = permissionMiddleware('ticket_admin');
export const uploadAdminMiddleware = permissionMiddleware('upload_admin');
