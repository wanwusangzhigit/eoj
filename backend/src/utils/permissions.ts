/**
 * 权限计算的唯一入口。
 *
 * 用户的最终权限 = users.permissions（个人）∪ 所属权限组的 permissions。
 * 后端鉴权中间件、/auth/me、SSR 全局数据都必须使用同一个计算结果：
 * 早期三处各自实现时，/auth/me 与 SSR 只返回个人权限，导致「通过权限组
 * 获得授权的 role='user' 用户后端接口可用、前端后台却被整体拦在门外」。
 */

/** 把 DB 中的 permissions 字段（JSON 字符串）或已有数组解析成字符串数组。 */
function parsePermissionArray(raw: unknown, fallback: string[] = []): string[] {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw) return fallback;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  if (!Array.isArray(parsed)) return fallback;
  return parsed.filter((p): p is string => typeof p === 'string');
}

/**
 * 计算用户最终权限：个人权限 ∪ 所属权限组权限。
 *
 * - personalPermissions 可传 users.permissions 的原始值（JSON 字符串）或数组；
 *   解析失败时用 fallback（通常是 JWT 内声明），保持旧行为兼容。
 * - 组表不存在 / 查询失败时退化为仅个人权限，不阻断请求。
 */
export async function getEffectivePermissions(
  db: D1Database,
  userId: number,
  personalPermissions: unknown,
  fallback: string[] = [],
): Promise<string[]> {
  const perms = new Set<string>(parsePermissionArray(personalPermissions, fallback));
  try {
    const rows = await db.prepare(
      `SELECT g.permissions FROM user_permission_groups ug
       JOIN permission_groups g ON g.id = ug.group_id
       WHERE ug.user_id = ?`,
    ).bind(userId).all();
    for (const row of rows.results as Array<{ permissions?: string | null }>) {
      for (const p of parsePermissionArray(row?.permissions)) perms.add(p);
    }
  } catch {
    // 组表不存在/查询失败:退化为仅个人权限,保持兼容
  }
  return Array.from(perms);
}
