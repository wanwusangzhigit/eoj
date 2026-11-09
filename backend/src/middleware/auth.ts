import { Context, Next } from 'hono';
import { AppType } from '../types';
import { getAuthTokenFromRequest } from '../utils/cookie';

export async function authMiddleware(c: Context<AppType>, next: Next) {
  // SSR 时代:优先读 httpOnly cookie(浏览器自动携带),然后回退到 Authorization 头
  // 用于兼容仍持有旧 JWT 的客户端(SPA 老缓存、移动端等)。
  const token = getAuthTokenFromRequest(c);
  if (!token) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }

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
      'SELECT banned, role, permissions, token_invalid_before FROM users WHERE id = ?'
    ).bind(payload.userId).first();
    if (!row) {
      return c.json({ success: false, error: { message: 'Invalid or expired token', code: 'UNAUTHORIZED' } }, 401);
    }
    // 审计 #H-17: JWT 服务端吊销——若 token 签发时间早于 token_invalid_before，则拒绝。
    // 兼容历史 token（无 iat）与未设置 token_invalid_before（默认 0）的场景。
    if (typeof row.token_invalid_before === 'number' && row.token_invalid_before > 0) {
      const tokenIat = (payload as any).iat;
      // 无 iat 的历史 token 视为签发于「很久以前」，与 token_invalid_before 比较按 0 处理；
      // 这里若 token_invalid_before > 0，意味着用户显式触发了吊销，应拒绝无 iat 的旧 token。
      if (!tokenIat || typeof tokenIat !== 'number' || tokenIat < row.token_invalid_before) {
        return c.json({ success: false, error: { message: 'Token has been revoked, please log in again', code: 'TOKEN_REVOKED' } }, 401);
      }
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
    // 合并用户所属权限组的 permissions(并集)
    try {
      const gr = await c.env.DB.prepare(
        `SELECT g.permissions FROM user_permission_groups ug
         JOIN permission_groups g ON g.id = ug.group_id
         WHERE ug.user_id = ?`
      ).bind(payload.userId).all();
      const groupPerms = new Set<string>(dbPermissions);
      for (const r of gr.results as any[]) {
        try {
          const p = r?.permissions ? JSON.parse(r.permissions) : [];
          if (Array.isArray(p)) p.forEach((x: string) => groupPerms.add(x));
        } catch { /* ignore malformed group */ }
      }
      dbPermissions = Array.from(groupPerms);
    } catch { /* 组表不存在/查询失败:退化为仅个人权限,保持兼容 */ }
    payload.permissions = dbPermissions;
    // 按比赛粒度授权列表:挂在 payload 上供后续 handler 使用。
    // 注意:数组里只含本次请求时刻的授权快照——若 handler 内执行增删后需要新值,请自行重查。
    try {
      const cr = await c.env.DB.prepare(
        'SELECT contest_id FROM user_contest_admin WHERE user_id = ? ORDER BY contest_id ASC'
      ).bind(payload.userId).all();
      payload.contest_admin_for = (cr.results as any[]).map((r) => r.contest_id);
    } catch {
      payload.contest_admin_for = [];
    }
  } catch {
    // DB 异常时拒绝请求,防止通过制造 DB 故障绕过封禁
    return c.json({ success: false, error: { message: 'Authentication service unavailable', code: 'AUTH_UNAVAILABLE' } }, 503);
  }

  c.set('user', payload);
  await next();
}

// 可选鉴权:有有效 token 则解析用户并写入 c.get('user'),无 token 或 token 无效则放行(不 401)。
// 用于公开接口中需要区分「已登录用户」与「游客」的场景(如比赛详情返回 is_registered)。
export async function optionalAuthMiddleware(c: Context<AppType>, next: Next) {
  const token = getAuthTokenFromRequest(c);
  if (token) {
    const { verifyJWT } = await import('../utils/jwt');
    const payload = await verifyJWT(token, c.env.JWT_SECRET, (c.env as any).JWT_SECRET_PREVIOUS);
    if (payload) {
      // 同步数据库中的最新状态(role/permissions/banned),保证可选鉴权场景下的权限一致
      try {
        const row: any = await c.env.DB.prepare(
          'SELECT banned, role, permissions, token_invalid_before FROM users WHERE id = ?'
        ).bind(payload.userId).first();
        if (row && row.banned === 1) {
          // 已封禁账号在可选鉴权下视为未登录,避免污染公开接口
        } else if (row) {
          // 审计 #H-17: 可选鉴权下同样校验 JWT 服务端吊销，否则改密后旧 token 仍可读公开接口。
          if (typeof row.token_invalid_before === 'number' && row.token_invalid_before > 0) {
            const tokenIat = (payload as any).iat;
            if (!tokenIat || typeof tokenIat !== 'number' || tokenIat < row.token_invalid_before) {
              // 已被吊销的 token 视为未登录，不写入 c.get('user')
              return next();
            }
          }
          payload.role = row.role || payload.role;
          let dbPermissions: string[] = payload.permissions || [];
          try {
            const parsed = row.permissions ? JSON.parse(row.permissions) : [];
            if (Array.isArray(parsed)) dbPermissions = parsed;
          } catch { /* ignore */ }
          // 合并用户所属权限组的 permissions(并集)
          try {
            const gr = await c.env.DB.prepare(
              `SELECT g.permissions FROM user_permission_groups ug
               JOIN permission_groups g ON g.id = ug.group_id
               WHERE ug.user_id = ?`
            ).bind(payload.userId).all();
            const groupPerms = new Set<string>(dbPermissions);
            for (const r of gr.results as any[]) {
              try {
                const p = r?.permissions ? JSON.parse(r.permissions) : [];
                if (Array.isArray(p)) p.forEach((x: string) => groupPerms.add(x));
              } catch { /* ignore */ }
            }
            dbPermissions = Array.from(groupPerms);
          } catch { /* ignore */ }
          payload.permissions = dbPermissions;
          // 按比赛粒度授权(可选鉴权下也填充,前端 SSR/CSR 可统一使用)
          try {
            const cr = await c.env.DB.prepare(
              'SELECT contest_id FROM user_contest_admin WHERE user_id = ? ORDER BY contest_id ASC'
            ).bind(payload.userId).all();
            payload.contest_admin_for = (cr.results as any[]).map((r) => r.contest_id);
          } catch {
            payload.contest_admin_for = [];
          }
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

// 按比赛粒度的 admin 中间件工厂。
//
// 与 contestAdminMiddleware(全局 contest_admin)的差异:
// 放行条件 = 全局 contest_admin OR 在 user_contest_admin 表中针对当前 :id 比赛有授权。
//
// 用法:
//   contests.put('/:id', authMiddleware, perContestAdminMiddleware(), async (c) => { ... })
// 路径参数 :id 必须存在(否则拒绝)。
//
// 设计意图:让"比赛组织者"无需拥有跨比赛的全部 contest_admin 也能管理自己被指派的比赛,
// 但克隆/删除/终评等敏感操作仍保留全局 contest_admin 要求(在路由层显式使用 contestAdminMiddleware)。
export function perContestAdminMiddleware() {
  return async (c: Context<AppType>, next: Next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
    }
    // 超级管理员 / admin / super_admin 角色直接放行
    if (user.userId === 1 || user.role === 'admin' || user.role === 'super_admin') {
      return next();
    }
    // 全局 contest_admin 权限放行
    const perms: string[] = user.permissions || [];
    if (perms.includes('contest_admin')) {
      return next();
    }
    // 按 contest_id 检查授权
    const contestId = parseInt(c.req.param('id') || '0', 10);
    if (!contestId || Number.isNaN(contestId)) {
      return c.json({ success: false, error: { message: 'Invalid contest id', code: 'BAD_REQUEST' } }, 400);
    }
    try {
      const grant = await c.env.DB.prepare(
        'SELECT 1 FROM user_contest_admin WHERE user_id = ? AND contest_id = ?'
      ).bind(user.userId, contestId).first();
      if (grant) {
        return next();
      }
    } catch {
      // 表缺失或 DB 异常时 fail-closed
    }
    return c.json({
      success: false,
      error: { message: 'Forbidden: requires contest_admin or per-contest admin grant', code: 'FORBIDDEN' },
    }, 403);
  };
}

// 工具函数:判断用户是否拥有某场比赛的 admin 权限(全局 contest_admin 或按比赛授权)。
// 用于在路由 handler 内分支显示/查询逻辑(不充当中间件)。
// 与 contest-time.ts 的 isContestAdmin(user) 互补——后者只看角色与全局 permission,
// 不查 DB;本函数会查 user_contest_admin 表,因此必须传 env。
export async function isContestOrganizer(
  env: AppType['Bindings'],
  user: { userId: number; role: string; permissions?: string[] } | null,
  contestId: number,
): Promise<boolean> {
  if (!user) return false;
  if (user.userId === 1 || user.role === 'admin' || user.role === 'super_admin') return true;
  if ((user.permissions || []).includes('contest_admin')) return true;
  try {
    const grant = await env.DB.prepare(
      'SELECT 1 FROM user_contest_admin WHERE user_id = ? AND contest_id = ?'
    ).bind(user.userId, contestId).first();
    return !!grant;
  } catch {
    return false;
  }
}
