import { Hono, type Context } from 'hono';
import { AppType } from '../../types';
import { safeParseInt } from '../../utils/helpers';
import { authMiddleware, adminMiddleware, superAdminMiddleware } from '../../middleware/auth';
import { recordAuditLog } from '../../middleware/audit';

const permissionGroups = new Hono<AppType>();

const VALID_PERMISSIONS = ['contest_admin', 'problem_admin', 'list_admin', 'ticket_admin', 'upload_admin'];

// 字段上限:防止超长文本写入 D1 / 撑爆后台列表渲染。
const FIELD_LIMITS = { name: 64, description: 500, color: 32 } as const;
const SORT_ORDER_MIN = -9999;
const SORT_ORDER_MAX = 9999;

function parsePermissions(raw: any): string[] | null {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((p: any) => typeof p === 'string' && VALID_PERMISSIONS.includes(p))) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 校验提交字段,返回错误消息或 null。requireName=true 用于创建接口。 */
function validateGroupInput(body: any, requireName: boolean): string | null {
  const name = body?.name;
  if (requireName || name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > FIELD_LIMITS.name) {
      return requireName ? `name is required (1-${FIELD_LIMITS.name} chars)` : 'Invalid name';
    }
  }
  for (const key of ['description', 'color'] as const) {
    const v = body?.[key];
    if (v !== undefined && (typeof v !== 'string' || v.length > FIELD_LIMITS[key])) {
      return `Invalid ${key}`;
    }
  }
  if (body?.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (!Number.isInteger(n) || n < SORT_ORDER_MIN || n > SORT_ORDER_MAX) return 'Invalid sort_order';
  }
  return null;
}

/**
 * 权限组敏感操作的结构化审计。
 * 全局 auditMiddleware 只记录 `METHOD PATH`,无法还原「谁把谁加进哪个组、
 * 改了哪些权限」;这里把变更详情以 JSON 追加到 action 字段。
 */
async function auditGroupChange(c: Context<AppType>, action: string, detail: Record<string, unknown>): Promise<void> {
  const user = c.get('user');
  await recordAuditLog(c, `${action} ${JSON.stringify(detail)}`, user?.userId, user?.username);
}

// ─── 组列表 ───────────────────────────────────────────
permissionGroups.get('/', authMiddleware, adminMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT g.id, g.name, g.description, g.permissions, g.is_system, g.color, g.sort_order, g.created_at, g.updated_at,
       (SELECT COUNT(*) FROM user_permission_groups ug WHERE ug.group_id = g.id) AS member_count
     FROM permission_groups g
     ORDER BY g.sort_order ASC, g.id ASC`
  ).all();
  const groups = rows.results.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description || '',
    permissions: parsePermissions(r.permissions) || [],
    is_system: r.is_system === 1,
    color: r.color || '',
    sort_order: r.sort_order || 0,
    member_count: r.member_count || 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return c.json({ success: true, data: { groups } });
});

// ─── 组详情 ───────────────────────────────────────────
permissionGroups.get('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = safeParseInt(c.req.param('id'), 0);
  const row: any = await c.env.DB.prepare(
    'SELECT id, name, description, permissions, is_system, color, sort_order, created_at, updated_at FROM permission_groups WHERE id = ?'
  ).bind(id).first();
  if (!row) {
    return c.json({ success: false, error: { message: 'Group not found', code: 'NOT_FOUND' } }, 404);
  }
  return c.json({
    success: true,
    data: {
      ...row,
      permissions: parsePermissions(row.permissions) || [],
      is_system: row.is_system === 1,
    },
  });
});

// ─── 创建自定义组(仅超级管理员) ────────────────────
permissionGroups.post('/', authMiddleware, superAdminMiddleware, async (c) => {
  const body: any = await c.req.json();
  const invalid = validateGroupInput(body, true);
  if (invalid) {
    return c.json({ success: false, error: { message: invalid, code: 'BAD_REQUEST' } }, 400);
  }
  const { name, description, permissions, color, sort_order } = body;
  const perms = parsePermissions(JSON.stringify(permissions || []));
  if (!perms) {
    return c.json({ success: false, error: { message: 'Invalid permissions', code: 'BAD_REQUEST' } }, 400);
  }
  const result = await c.env.DB.prepare(
    'INSERT INTO permission_groups (name, description, permissions, is_system, color, sort_order) VALUES (?, ?, ?, 0, ?, ?)'
  ).bind(name.trim(), description || '', JSON.stringify(perms), color || '', sort_order || 0).run();
  const id = (result as any).meta?.last_row_id;
  await auditGroupChange(c, 'PERMISSION_GROUP_CREATE', { id, name: name.trim(), permissions: perms });
  return c.json({ success: true, data: { id, message: 'Group created' } });
});

// ─── 更新组(仅超级管理员;内置组不可改名/删,但允许改描述/颜色/顺序) ─
permissionGroups.put('/:id', authMiddleware, superAdminMiddleware, async (c) => {
  const id = safeParseInt(c.req.param('id'), 0);
  const body: any = await c.req.json();
  const invalid = validateGroupInput(body, false);
  if (invalid) {
    return c.json({ success: false, error: { message: invalid, code: 'BAD_REQUEST' } }, 400);
  }
  const { name, description, permissions, color, sort_order } = body;

  const existing: any = await c.env.DB.prepare('SELECT * FROM permission_groups WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Group not found', code: 'NOT_FOUND' } }, 404);
  }
  const isSystem = existing.is_system === 1;

  // 内置组禁止改名与改权限(否则会破坏系统约定的语义)
  if (isSystem && name !== undefined && name !== existing.name) {
    return c.json({ success: false, error: { message: 'Cannot rename system group', code: 'FORBIDDEN' } }, 403);
  }
  if (isSystem && permissions !== undefined) {
    return c.json({ success: false, error: { message: 'Cannot modify system group permissions', code: 'FORBIDDEN' } }, 403);
  }

  let permsToStore = existing.permissions;
  let changedPerms: string[] | undefined;
  if (permissions !== undefined) {
    const perms = parsePermissions(JSON.stringify(permissions));
    if (!perms) {
      return c.json({ success: false, error: { message: 'Invalid permissions', code: 'BAD_REQUEST' } }, 400);
    }
    permsToStore = JSON.stringify(perms);
    changedPerms = perms;
  }

  await c.env.DB.prepare(
    'UPDATE permission_groups SET name = ?, description = ?, permissions = ?, color = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(
    (name !== undefined ? String(name) : existing.name),
    (description !== undefined ? String(description) : (existing.description || '')),
    permsToStore,
    (color !== undefined ? String(color) : (existing.color || '')),
    (sort_order !== undefined ? Number(sort_order) : (existing.sort_order || 0)),
    id,
  ).run();

  await auditGroupChange(c, 'PERMISSION_GROUP_UPDATE', {
    id, isSystem,
    ...(name !== undefined ? { name: String(name) } : {}),
    ...(changedPerms !== undefined ? { permissions: changedPerms } : {}),
    ...(description !== undefined ? { description: String(description) } : {}),
    ...(color !== undefined ? { color: String(color) } : {}),
    ...(sort_order !== undefined ? { sort_order: Number(sort_order) } : {}),
  });
  return c.json({ success: true, data: { message: 'Group updated' } });
});

// ─── 删除组(仅超级管理员;内置组不可删) ─────────────
permissionGroups.delete('/:id', authMiddleware, superAdminMiddleware, async (c) => {
  const id = safeParseInt(c.req.param('id'), 0);
  const existing: any = await c.env.DB.prepare('SELECT is_system, name FROM permission_groups WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Group not found', code: 'NOT_FOUND' } }, 404);
  }
  if (existing.is_system === 1) {
    return c.json({ success: false, error: { message: 'Cannot delete system group', code: 'FORBIDDEN' } }, 403);
  }
  await c.env.DB.prepare('DELETE FROM permission_groups WHERE id = ?').bind(id).run();
  await auditGroupChange(c, 'PERMISSION_GROUP_DELETE', { id, name: existing.name });
  return c.json({ success: true, data: { message: 'Group deleted' } });
});

// ─── 组成员列表 ───────────────────────────────────────
permissionGroups.get('/:id/members', authMiddleware, adminMiddleware, async (c) => {
  const id = safeParseInt(c.req.param('id'), 0);
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50')));
  const offset = (page - 1) * pageSize;
  const search = c.req.query('search') || '';

  const exists: any = await c.env.DB.prepare('SELECT id FROM permission_groups WHERE id = ?').bind(id).first();
  if (!exists) {
    return c.json({ success: false, error: { message: 'Group not found', code: 'NOT_FOUND' } }, 404);
  }

  let dataSql = `SELECT u.id, u.username, u.avatar_url, u.role, u.banned, u.created_at, ug.created_at AS joined_at
                 FROM user_permission_groups ug
                 JOIN users u ON u.id = ug.user_id
                 WHERE ug.group_id = ?`;
  let countSql = `SELECT COUNT(*) AS total FROM user_permission_groups ug JOIN users u ON u.id = ug.user_id WHERE ug.group_id = ?`;
  const binds: any[] = [id];
  const countBinds: any[] = [id];
  if (search) {
    dataSql += ' AND u.username LIKE ? ESCAPE "\\"';
    countSql += ' AND u.username LIKE ? ESCAPE "\\"';
    const like = `%${search.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    binds.push(like);
    countBinds.push(like);
  }
  dataSql += ' ORDER BY ug.created_at DESC LIMIT ? OFFSET ?';

  const countRow: any = await c.env.DB.prepare(countSql).bind(...countBinds).first();
  const total = countRow?.total || 0;
  const rows = await c.env.DB.prepare(dataSql).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      members: rows.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// ─── 添加成员到组(仅超级管理员) ────────────────────
permissionGroups.post('/:id/members', authMiddleware, superAdminMiddleware, async (c) => {
  const id = safeParseInt(c.req.param('id'), 0);
  const body: any = await c.req.json();
  const userId = Number(body?.userId);
  // 必须是正整数且不是超级管理员(他已拥有全部权限,无需入组)
  if (!Number.isInteger(userId) || userId <= 0 || userId === 1) {
    return c.json({ success: false, error: { message: 'Invalid userId', code: 'BAD_REQUEST' } }, 400);
  }
  const user: any = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!user) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }
  const group: any = await c.env.DB.prepare('SELECT id FROM permission_groups WHERE id = ?').bind(id).first();
  if (!group) {
    return c.json({ success: false, error: { message: 'Group not found', code: 'NOT_FOUND' } }, 404);
  }
  try {
    await c.env.DB.prepare(
      'INSERT INTO user_permission_groups (user_id, group_id) VALUES (?, ?)'
    ).bind(userId, id).run();
  } catch (e: any) {
    // 唯一约束冲突=已加入,幂等返回成功
    if (String(e?.message || '').toLowerCase().includes('unique')) {
      await auditGroupChange(c, 'PERMISSION_GROUP_MEMBER_ADD', { groupId: id, userId, alreadyMember: true });
      return c.json({ success: true, data: { message: 'Already a member' } });
    }
    throw e;
  }
  await auditGroupChange(c, 'PERMISSION_GROUP_MEMBER_ADD', { groupId: id, userId });
  return c.json({ success: true, data: { message: 'Member added' } });
});

// ─── 从组移除成员(仅超级管理员) ────────────────────
permissionGroups.delete('/:id/members/:userId', authMiddleware, superAdminMiddleware, async (c) => {
  const id = safeParseInt(c.req.param('id'), 0);
  const userId = safeParseInt(c.req.param('userId'), 0);
  await c.env.DB.prepare(
    'DELETE FROM user_permission_groups WHERE group_id = ? AND user_id = ?'
  ).bind(id, userId).run();
  await auditGroupChange(c, 'PERMISSION_GROUP_MEMBER_REMOVE', { groupId: id, userId });
  return c.json({ success: true, data: { message: 'Member removed' } });
});

// ─── 用户-组关系查询/设置挂在 /users 下(见 users.ts) ──

export default permissionGroups;
