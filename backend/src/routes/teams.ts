import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware, isAdmin } from '../middleware/auth';

const teams = new Hono<AppType>();

// ─── Helper: check if user is team owner or admin ───
function isTeamOwnerOrAdmin(team: any, userId: number, user: any): boolean {
  return team.owner_id === userId || isAdmin(user);
}

// ─── Helper: check if user is a team member ───
async function isTeamMember(db: D1Database, teamId: number, userId: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?')
    .bind(teamId, userId).first();
  return !!row;
}

// ─── Helper: get user's role in team ───
async function getTeamMemberRole(db: D1Database, teamId: number, userId: number): Promise<string | null> {
  const row: any = await db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
    .bind(teamId, userId).first();
  return row?.role || null;
}

// ============================================================
// 团队列表
// ============================================================

// GET /teams — 公开团队列表
teams.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search');
  const offset = (page - 1) * pageSize;

  let query = `SELECT t.id, t.name, t.slug, t.description, t.avatar_url, t.owner_id, t.join_method, t.created_at,
       u.username as owner_name,
       (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count
     FROM teams t JOIN users u ON t.owner_id = u.id WHERE t.is_public = 1`;
  let countQuery = 'SELECT COUNT(*) as total FROM teams WHERE is_public = 1';
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (search) {
    query += ' AND (t.name LIKE ? OR t.description LIKE ?)';
    countQuery += ' AND (name LIKE ? OR description LIKE ?)';
    binds.push(`%${search}%`, `%${search}%`);
    countBinds.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      teams: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// ============================================================
// 团队详情
// ============================================================

// GET /teams/:slug — 团队详情
teams.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const currentUser = c.get('user');

  const team = await c.env.DB.prepare(
    `SELECT t.*, u.username as owner_name,
       (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count
     FROM teams t JOIN users u ON t.owner_id = u.id WHERE t.slug = ?`
  ).bind(slug).first();

  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  const teamId = (team as any).id;

  // 成员列表
  const members = await c.env.DB.prepare(
    `SELECT tm.id, tm.user_id, tm.role, tm.joined_at, u.username, u.avatar_url,
       (SELECT COUNT(*) FROM submissions s WHERE s.user_id = tm.user_id AND s.status = 'accepted') as accepted_count
     FROM team_members tm JOIN users u ON tm.user_id = u.id
     WHERE tm.team_id = ? ORDER BY
       CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
       tm.joined_at ASC`
  ).bind(teamId).all();

  // 当前用户状态
  let userMembership = null;
  let joinRequest = null;
  if (currentUser) {
    userMembership = await getTeamMemberRole(c.env.DB, teamId, currentUser.userId);

    // 检查是否有待审核的申请
    const pendingReq: any = await c.env.DB.prepare(
      "SELECT id, status FROM team_join_requests WHERE team_id = ? AND user_id = ? AND status = 'pending'"
    ).bind(teamId, currentUser.userId).first();
    if (pendingReq) {
      joinRequest = { id: pendingReq.id, status: pendingReq.status };
    }
  }

  // 公告（取前 5 条置顶 + 最新）
  const announcements = await c.env.DB.prepare(
    `SELECT id, title, is_pinned, created_at
     FROM team_announcements WHERE team_id = ?
     ORDER BY is_pinned DESC, created_at DESC LIMIT 5`
  ).bind(teamId).all();

  // 统计信息
  const problemSetCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_problem_sets WHERE team_id = ?'
  ).bind(teamId).first();
  const contestCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_contests WHERE team_id = ?'
  ).bind(teamId).first();
  const discussionCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_discussions WHERE team_id = ?'
  ).bind(teamId).first();

  return c.json({
    success: true,
    data: {
      team,
      members: members.results,
      announcements: announcements.results,
      user_membership: userMembership,
      join_request: joinRequest,
      stats: {
        problem_set_count: (problemSetCount as any)?.cnt || 0,
        contest_count: (contestCount as any)?.cnt || 0,
        discussion_count: (discussionCount as any)?.cnt || 0,
      },
    },
  });
});

// ============================================================
// 团队 CRUD
// ============================================================

// POST /teams — 创建团队
teams.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { name, slug, description, avatar_url, is_public, join_method } = body;

  if (!name || !slug) {
    return c.json({ success: false, error: { message: 'name and slug are required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return c.json({ success: false, error: { message: 'slug must be alphanumeric with dashes', code: 'BAD_REQUEST' } }, 400);
  }

  const validJoinMethods = ['free', 'approval', 'invite'];
  const effectiveJoinMethod = validJoinMethods.includes(join_method) ? join_method : 'free';

  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO teams (name, slug, description, avatar_url, owner_id, is_public, join_method) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(name, slug, description || '', avatar_url || '', user.userId, is_public === false ? 0 : 1, effectiveJoinMethod).run();

    // 创建者自动成为 owner
    await c.env.DB.prepare(
      'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)'
    ).bind(result.meta.last_row_id, user.userId, 'owner').run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Team created' } }, 201);
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return c.json({ success: false, error: { message: 'slug already exists', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to create team', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// PUT /teams/:id — 编辑（owner 或 admin）
teams.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();

  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const body = await c.req.json();
  const { name, description, avatar_url, is_public, join_method } = body;

  const validJoinMethods = ['free', 'approval', 'invite'];
  const effectiveJoinMethod = validJoinMethods.includes(join_method) ? join_method : null;

  await c.env.DB.prepare(
    `UPDATE teams SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       avatar_url = COALESCE(?, avatar_url),
       is_public = COALESCE(?, is_public),
       join_method = COALESCE(?, join_method),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(name ?? null, description ?? null, avatar_url ?? null, is_public ?? null, effectiveJoinMethod, id).run();

  return c.json({ success: true, data: { message: 'Team updated' } });
});

// DELETE /teams/:id — 删除
teams.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();

  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  // 级联删除所有相关数据（外键 CASCADE 会处理子表，但先手动清理）
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM team_join_requests WHERE team_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM team_announcements WHERE team_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM team_discussion_replies WHERE discussion_id IN (SELECT id FROM team_discussions WHERE team_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM team_discussions WHERE team_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM team_problem_set_items WHERE problem_set_id IN (SELECT id FROM team_problem_sets WHERE team_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM team_problem_sets WHERE team_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM team_contest_participants WHERE team_contest_id IN (SELECT id FROM team_contests WHERE team_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM team_contest_problems WHERE team_contest_id IN (SELECT id FROM team_contests WHERE team_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM team_contests WHERE team_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM team_members WHERE team_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true, data: { message: 'Team deleted' } });
});

// ============================================================
// 成员管理
// ============================================================

// GET /teams/:id/members — 获取成员列表
teams.get('/:id/members', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const team = await c.env.DB.prepare('SELECT id, owner_id, is_public FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  const members = await c.env.DB.prepare(
    `SELECT tm.id, tm.user_id, tm.role, tm.joined_at, u.username, u.avatar_url,
       (SELECT COUNT(*) FROM submissions s WHERE s.user_id = tm.user_id AND s.status = 'accepted') as accepted_count
     FROM team_members tm JOIN users u ON tm.user_id = u.id
     WHERE tm.team_id = ? ORDER BY
       CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
       tm.joined_at ASC`
  ).bind(id).all();

  return c.json({ success: true, data: { members: members.results } });
});

// PUT /teams/:id/role — 修改成员角色（owner/admin）
teams.put('/:id/role', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { user_id, role } = body;

  if (!user_id || !['admin', 'member'].includes(role)) {
    return c.json({ success: false, error: { message: 'Invalid user_id or role', code: 'BAD_REQUEST' } }, 400);
  }

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  // 只有 owner 可以修改为 admin 或修改 admin 的角色
  const targetRole = await getTeamMemberRole(c.env.DB, id, user_id);
  if (targetRole === 'admin' && (team as any).owner_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Only owner can modify admin roles', code: 'FORBIDDEN' } }, 403);
  }

  // 不能修改 owner 的角色
  if ((team as any).owner_id === user_id) {
    return c.json({ success: false, error: { message: 'Cannot modify owner role', code: 'BAD_REQUEST' } }, 400);
  }

  await c.env.DB.prepare(
    'UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?'
  ).bind(role, id, user_id).run();

  return c.json({ success: true, data: { message: 'Role updated' } });
});

// DELETE /teams/:id/members/:userId — 移除成员
teams.delete('/:id/members/:userId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const targetUserId = parseInt(c.req.param('userId') || '0');

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }
  if ((team as any).owner_id === targetUserId) {
    return c.json({ success: false, error: { message: 'Cannot remove owner', code: 'BAD_REQUEST' } }, 400);
  }

  // 不能移除 admin（只有 owner 可以）
  const targetRole = await getTeamMemberRole(c.env.DB, id, targetUserId);
  if (targetRole === 'admin' && (team as any).owner_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Only owner can remove admins', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(id, targetUserId).run();
  return c.json({ success: true, data: { message: 'Member removed' } });
});

// POST /teams/:id/transfer — 转让团队所有权
teams.post('/:id/transfer', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { user_id } = body;

  if (!user_id) {
    return c.json({ success: false, error: { message: 'user_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if ((team as any).owner_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Only owner can transfer team', code: 'FORBIDDEN' } }, 403);
  }

  const targetRole = await getTeamMemberRole(c.env.DB, id, user_id);
  if (!targetRole) {
    return c.json({ success: false, error: { message: 'Target user is not a team member', code: 'BAD_REQUEST' } }, 400);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').bind('member', id, user.userId),
    c.env.DB.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').bind('owner', id, user_id),
    c.env.DB.prepare('UPDATE teams SET owner_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user_id, id),
  ]);

  return c.json({ success: true, data: { message: 'Team transferred' } });
});

// ============================================================
// 加入/离开团队
// ============================================================

// POST /teams/:id/join — 加入团队
teams.post('/:id/join', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const message = body?.message || '';

  const team: any = await c.env.DB.prepare('SELECT id, is_public, join_method FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  // 已经是成员
  const existingRole = await getTeamMemberRole(c.env.DB, id, user.userId);
  if (existingRole) {
    return c.json({ success: false, error: { message: 'Already a member', code: 'CONFLICT' } }, 409);
  }

  if (team.join_method === 'free') {
    if (!team.is_public) {
      return c.json({ success: false, error: { message: 'Team is private', code: 'FORBIDDEN' } }, 403);
    }
    try {
      await c.env.DB.prepare(
        'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)'
      ).bind(id, user.userId, 'member').run();
      return c.json({ success: true, data: { message: 'Joined team' } }, 201);
    } catch (e: any) {
      if (String(e).includes('UNIQUE')) {
        return c.json({ success: false, error: { message: 'Already a member', code: 'CONFLICT' } }, 409);
      }
      return c.json({ success: false, error: { message: 'Failed to join team', code: 'INTERNAL_ERROR' } }, 500);
    }
  } else if (team.join_method === 'approval') {
    try {
      await c.env.DB.prepare(
        'INSERT INTO team_join_requests (team_id, user_id, message) VALUES (?, ?, ?)'
      ).bind(id, user.userId, message).run();
      return c.json({ success: true, data: { message: 'Join request submitted' } }, 201);
    } catch (e: any) {
      if (String(e).includes('UNIQUE')) {
        return c.json({ success: false, error: { message: 'Already applied, please wait for approval', code: 'CONFLICT' } }, 409);
      }
      return c.json({ success: false, error: { message: 'Failed to submit join request', code: 'INTERNAL_ERROR' } }, 500);
    }
  } else {
    return c.json({ success: false, error: { message: 'This team is invite-only', code: 'FORBIDDEN' } }, 403);
  }
});

// POST /teams/:id/leave — 离开
teams.post('/:id/leave', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if ((team as any).owner_id === user.userId) {
    return c.json({ success: false, error: { message: 'Owner cannot leave, transfer or delete the team', code: 'BAD_REQUEST' } }, 400);
  }

  await c.env.DB.prepare('DELETE FROM team_join_requests WHERE team_id = ? AND user_id = ?').bind(id, user.userId).run();
  await c.env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(id, user.userId).run();
  return c.json({ success: true, data: { message: 'Left team' } });
});

// ============================================================
// 加入申请管理
// ============================================================

// GET /teams/:id/join-requests — 查看申请列表
teams.get('/:id/join-requests', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const status = c.req.query('status') || 'pending';
  const offset = (page - 1) * pageSize;

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM team_join_requests WHERE team_id = ? AND status = ?'
  ).bind(id, status).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT jr.id, jr.user_id, jr.message, jr.status, jr.created_at,
       u.username, u.avatar_url
     FROM team_join_requests jr JOIN users u ON jr.user_id = u.id
     WHERE jr.team_id = ? AND jr.status = ?
     ORDER BY jr.created_at ASC LIMIT ? OFFSET ?`
  ).bind(id, status, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      requests: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// PUT /teams/:id/join-requests/:requestId — 审核申请
teams.put('/:id/join-requests/:requestId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const requestId = parseInt(c.req.param('requestId') || '0');
  const body = await c.req.json();
  const { status } = body;

  if (!['approved', 'rejected'].includes(status)) {
    return c.json({ success: false, error: { message: 'Status must be approved or rejected', code: 'BAD_REQUEST' } }, 400);
  }

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const request: any = await c.env.DB.prepare(
    'SELECT id, user_id, status FROM team_join_requests WHERE id = ? AND team_id = ?'
  ).bind(requestId, id).first();

  if (!request) {
    return c.json({ success: false, error: { message: 'Join request not found', code: 'NOT_FOUND' } }, 404);
  }
  if (request.status !== 'pending') {
    return c.json({ success: false, error: { message: 'Request already processed', code: 'CONFLICT' } }, 409);
  }

  await c.env.DB.prepare(
    'UPDATE team_join_requests SET status = ?, handled_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(status, user.userId, requestId).run();

  if (status === 'approved') {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)'
    ).bind(id, request.user_id, 'member').run();
  }

  return c.json({ success: true, data: { message: status === 'approved' ? 'Request approved' : 'Request rejected' } });
});

// ============================================================
// 团队排行
// ============================================================

// GET /teams/:id/rankings — 团队内排行榜
teams.get('/:id/rankings', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const rankings = await c.env.DB.prepare(
    `SELECT tm.user_id, u.username, u.avatar_url,
       COUNT(DISTINCT s.problem_id) as solved_count,
       COUNT(s.id) as submission_count
     FROM team_members tm
     JOIN users u ON tm.user_id = u.id
     LEFT JOIN submissions s ON s.user_id = tm.user_id AND s.status = 'accepted'
     WHERE tm.team_id = ?
     GROUP BY tm.user_id, u.username, u.avatar_url
     ORDER BY solved_count DESC, submission_count ASC`
  ).bind(id).all();

  return c.json({ success: true, data: { rankings: rankings.results } });
});

// ============================================================
// 团队公告
// ============================================================

// GET /teams/:id/announcements — 公告列表
teams.get('/:id/announcements', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const team: any = await c.env.DB.prepare('SELECT id, is_public FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  const currentUser = c.get('user');
  const userIsMember = currentUser ? await isTeamMember(c.env.DB, id, currentUser.userId) : false;
  if (!team.is_public && !userIsMember) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM team_announcements WHERE team_id = ?'
  ).bind(id).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at,
       u.username, u.avatar_url
     FROM team_announcements a JOIN users u ON a.user_id = u.id
     WHERE a.team_id = ?
     ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT ? OFFSET ?`
  ).bind(id, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      announcements: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /teams/:id/announcements — 创建公告
teams.post('/:id/announcements', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { title, content, is_pinned } = body;

  if (!title || !content) {
    return c.json({ success: false, error: { message: 'title and content are required', code: 'BAD_REQUEST' } }, 400);
  }

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO team_announcements (team_id, user_id, title, content, is_pinned) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, user.userId, title, content, is_pinned ? 1 : 0).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Announcement created' } }, 201);
});

// PUT /teams/:id/announcements/:announcementId — 编辑公告
teams.put('/:id/announcements/:announcementId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const announcementId = parseInt(c.req.param('announcementId') || '0');
  const body = await c.req.json();
  const { title, content, is_pinned } = body;

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const announcement = await c.env.DB.prepare(
    'SELECT id FROM team_announcements WHERE id = ? AND team_id = ?'
  ).bind(announcementId, id).first();
  if (!announcement) {
    return c.json({ success: false, error: { message: 'Announcement not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE team_announcements SET
       title = COALESCE(?, title), content = COALESCE(?, content),
       is_pinned = COALESCE(?, is_pinned), updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND team_id = ?`
  ).bind(title ?? null, content ?? null, is_pinned !== undefined ? (is_pinned ? 1 : 0) : null, announcementId, id).run();

  return c.json({ success: true, data: { message: 'Announcement updated' } });
});

// DELETE /teams/:id/announcements/:announcementId — 删除公告
teams.delete('/:id/announcements/:announcementId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const announcementId = parseInt(c.req.param('announcementId') || '0');

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM team_announcements WHERE id = ? AND team_id = ?').bind(announcementId, id).run();
  return c.json({ success: true, data: { message: 'Announcement deleted' } });
});

// ============================================================
// 团队讨论区
// ============================================================

// GET /teams/:id/discussions — 讨论列表
teams.get('/:id/discussions', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const sort = c.req.query('sort') || 'newest';
  const offset = (page - 1) * pageSize;

  const team: any = await c.env.DB.prepare('SELECT id, is_public FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  const currentUser = c.get('user');
  const userIsMember = currentUser ? await isTeamMember(c.env.DB, id, currentUser.userId) : false;
  if (!team.is_public && !userIsMember) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM team_discussions WHERE team_id = ?'
  ).bind(id).first();
  const total = (countResult as any)?.total || 0;

  const orderClause = sort === 'active'
    ? 'ORDER BY d.is_pinned DESC, d.reply_count DESC, d.created_at DESC LIMIT ? OFFSET ?'
    : 'ORDER BY d.is_pinned DESC, d.created_at DESC LIMIT ? OFFSET ?';

  const results = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.is_pinned, d.reply_count, d.view_count, d.created_at,
       u.username, u.avatar_url,
       (SELECT content FROM team_discussion_replies WHERE discussion_id = d.id ORDER BY created_at DESC LIMIT 1) as last_reply
     FROM team_discussions d JOIN users u ON d.user_id = u.id
     WHERE d.team_id = ?
     ${orderClause}`
  ).bind(id, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      discussions: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /teams/:id/discussions — 创建讨论
teams.post('/:id/discussions', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { title, content } = body;

  if (!title || !content) {
    return c.json({ success: false, error: { message: 'title and content are required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!await isTeamMember(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO team_discussions (team_id, user_id, title, content) VALUES (?, ?, ?, ?)'
  ).bind(id, user.userId, title, content).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Discussion created' } }, 201);
});

// GET /teams/:id/discussions/:discussionId — 讨论详情
teams.get('/:id/discussions/:discussionId', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const discussionId = parseInt(c.req.param('discussionId') || '0');

  const discussion: any = await c.env.DB.prepare(
    `SELECT d.*, u.username, u.avatar_url
     FROM team_discussions d JOIN users u ON d.user_id = u.id
     WHERE d.id = ? AND d.team_id = ?`
  ).bind(discussionId, id).first();

  if (!discussion) {
    return c.json({ success: false, error: { message: 'Discussion not found', code: 'NOT_FOUND' } }, 404);
  }

  // 增加浏览量
  await c.env.DB.prepare(
    'UPDATE team_discussions SET view_count = view_count + 1 WHERE id = ?'
  ).bind(discussionId).run();

  const replies = await c.env.DB.prepare(
    `SELECT r.id, r.content, r.created_at, r.updated_at,
       u.username, u.avatar_url
     FROM team_discussion_replies r JOIN users u ON r.user_id = u.id
     WHERE r.discussion_id = ?
     ORDER BY r.created_at ASC`
  ).bind(discussionId).all();

  return c.json({
    success: true,
    data: {
      discussion: { ...discussion, view_count: (discussion.view_count || 0) + 1 },
      replies: replies.results,
    },
  });
});

// POST /teams/:id/discussions/:discussionId/replies — 回复讨论
teams.post('/:id/discussions/:discussionId/replies', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const discussionId = parseInt(c.req.param('discussionId') || '0');
  const body = await c.req.json();
  const { content } = body;

  if (!content) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!await isTeamMember(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  const discussion = await c.env.DB.prepare(
    'SELECT id FROM team_discussions WHERE id = ? AND team_id = ?'
  ).bind(discussionId, id).first();
  if (!discussion) {
    return c.json({ success: false, error: { message: 'Discussion not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    'INSERT INTO team_discussion_replies (discussion_id, user_id, content) VALUES (?, ?, ?)'
  ).bind(discussionId, user.userId, content).run();

  await c.env.DB.prepare(
    'UPDATE team_discussions SET reply_count = reply_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(discussionId).run();

  return c.json({ success: true, data: { message: 'Reply added' } }, 201);
});

// DELETE /teams/:id/discussions/:discussionId — 删除讨论
teams.delete('/:id/discussions/:discussionId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const discussionId = parseInt(c.req.param('discussionId') || '0');

  const discussion: any = await c.env.DB.prepare(
    'SELECT user_id FROM team_discussions WHERE id = ? AND team_id = ?'
  ).bind(discussionId, id).first();
  if (!discussion) {
    return c.json({ success: false, error: { message: 'Discussion not found', code: 'NOT_FOUND' } }, 404);
  }

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (discussion.user_id !== user.userId && !isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM team_discussion_replies WHERE discussion_id = ?').bind(discussionId),
    c.env.DB.prepare('DELETE FROM team_discussions WHERE id = ?').bind(discussionId),
  ]);

  return c.json({ success: true, data: { message: 'Discussion deleted' } });
});

// ============================================================
// 团队题目集
// ============================================================

// GET /teams/:id/problem-sets — 题目集列表
teams.get('/:id/problem-sets', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const team: any = await c.env.DB.prepare('SELECT id, is_public FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  const currentUser = c.get('user');
  const userIsMember = currentUser ? await isTeamMember(c.env.DB, id, currentUser.userId) : false;

  let whereClause = 'WHERE ps.team_id = ?';
  const binds: any[] = [id];
  if (!userIsMember) {
    whereClause += ' AND ps.is_public = 1';
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM team_problem_sets ps ${whereClause}`
  ).bind(...binds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT ps.id, ps.title, ps.description, ps.is_public, ps.created_at,
       u.username,
       (SELECT COUNT(*) FROM team_problem_set_items psi WHERE psi.problem_set_id = ps.id) as problem_count
     FROM team_problem_sets ps JOIN users u ON ps.user_id = u.id
     ${whereClause}
     ORDER BY ps.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      problem_sets: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /teams/:id/problem-sets — 创建题目集
teams.post('/:id/problem-sets', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { title, description, is_public } = body;

  if (!title) {
    return c.json({ success: false, error: { message: 'title is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!await isTeamMember(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO team_problem_sets (team_id, user_id, title, description, is_public) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, user.userId, title, description || '', is_public !== false ? 1 : 0).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Problem set created' } }, 201);
});

// GET /teams/:id/problem-sets/:setId — 题目集详情
teams.get('/:id/problem-sets/:setId', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const setId = parseInt(c.req.param('setId') || '0');

  const problemSet: any = await c.env.DB.prepare(
    `SELECT ps.*, u.username
     FROM team_problem_sets ps JOIN users u ON ps.user_id = u.id
     WHERE ps.id = ? AND ps.team_id = ?`
  ).bind(setId, id).first();

  if (!problemSet) {
    return c.json({ success: false, error: { message: 'Problem set not found', code: 'NOT_FOUND' } }, 404);
  }

  const currentUser = c.get('user');
  const userIsMember = currentUser ? await isTeamMember(c.env.DB, id, currentUser.userId) : false;
  if (!problemSet.is_public && !userIsMember) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const items = await c.env.DB.prepare(
    `SELECT psi.id, psi.problem_id, psi.sort_order, psi.note,
       p.title, p.slug, p.difficulty, p.rating, p.tags
     FROM team_problem_set_items psi
     JOIN problems p ON psi.problem_id = p.id
     WHERE psi.problem_set_id = ?
     ORDER BY psi.sort_order ASC, psi.id ASC`
  ).bind(setId).all();

  // 当前用户解决状态
  let solvedIds: Set<number> = new Set();
  if (currentUser) {
    const problemIds = items.results.map((r: any) => r.problem_id);
    if (problemIds.length > 0) {
      const placeholders = problemIds.map(() => '?').join(',');
      const solved = await c.env.DB.prepare(
        `SELECT DISTINCT problem_id FROM submissions
         WHERE user_id = ? AND status = 'accepted' AND problem_id IN (${placeholders})`
      ).bind(currentUser.userId, ...problemIds).all();
      for (const r of solved.results as any[]) {
        solvedIds.add(r.problem_id);
      }
    }
  }

  const itemsWithStatus = items.results.map((item: any) => ({
    ...item,
    solved: solvedIds.has(item.problem_id),
  }));

  return c.json({
    success: true,
    data: {
      problem_set: problemSet,
      problems: itemsWithStatus,
    },
  });
});

// DELETE /teams/:id/problem-sets/:setId — 删除题目集
teams.delete('/:id/problem-sets/:setId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const setId = parseInt(c.req.param('setId') || '0');

  const problemSet = await c.env.DB.prepare(
    'SELECT user_id FROM team_problem_sets WHERE id = ? AND team_id = ?'
  ).bind(setId, id).first();
  if (!problemSet) {
    return c.json({ success: false, error: { message: 'Problem set not found', code: 'NOT_FOUND' } }, 404);
  }

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if ((problemSet as any).user_id !== user.userId && !isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM team_problem_sets WHERE id = ?').bind(setId).run();
  return c.json({ success: true, data: { message: 'Problem set deleted' } });
});

// POST /teams/:id/problem-sets/:setId/items — 添加题目到题目集
teams.post('/:id/problem-sets/:setId/items', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const setId = parseInt(c.req.param('setId') || '0');
  const body = await c.req.json();
  const { problem_id, note, sort_order } = body;

  if (!problem_id) {
    return c.json({ success: false, error: { message: 'problem_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!await isTeamMember(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO team_problem_set_items (problem_set_id, problem_id, note, sort_order) VALUES (?, ?, ?, ?)'
    ).bind(setId, problem_id, note || '', sort_order || 0).run();
    return c.json({ success: true, data: { message: 'Problem added to set' } }, 201);
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return c.json({ success: false, error: { message: 'Problem already in this set', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to add problem', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// DELETE /teams/:id/problem-sets/:setId/items/:itemId — 从题目集移除题目
teams.delete('/:id/problem-sets/:setId/items/:itemId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const setId = parseInt(c.req.param('setId') || '0');
  const itemId = parseInt(c.req.param('itemId') || '0');

  if (!await isTeamMember(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare(
    'DELETE FROM team_problem_set_items WHERE id = ? AND problem_set_id = ?'
  ).bind(itemId, setId).run();

  return c.json({ success: true, data: { message: 'Problem removed from set' } });
});

// ============================================================
// 团队竞赛
// ============================================================

// GET /teams/:id/contests — 竞赛列表
teams.get('/:id/contests', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const status = c.req.query('status');
  const offset = (page - 1) * pageSize;

  const team: any = await c.env.DB.prepare('SELECT id, is_public FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  let whereClause = 'WHERE tc.team_id = ?';
  const binds: any[] = [id];

  const currentUser = c.get('user');
  const userIsMember = currentUser ? await isTeamMember(c.env.DB, id, currentUser.userId) : false;
  if (!userIsMember) {
    whereClause += ' AND tc.is_public = 1';
  }

  if (status) {
    whereClause += ' AND tc.status = ?';
    binds.push(status);
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM team_contests tc ${whereClause}`
  ).bind(...binds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT tc.id, tc.title, tc.start_time, tc.end_time, tc.scoring_type, tc.status, tc.created_at,
       u.username,
       (SELECT COUNT(*) FROM team_contest_participants tcp WHERE tcp.team_contest_id = tc.id) as participant_count
     FROM team_contests tc JOIN users u ON tc.user_id = u.id
     ${whereClause}
     ORDER BY tc.start_time DESC LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      contests: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /teams/:id/contests — 创建竞赛
teams.post('/:id/contests', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { title, description, start_time, end_time, scoring_type, is_public } = body;

  if (!title || !start_time || !end_time) {
    return c.json({ success: false, error: { message: 'title, start_time, and end_time are required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!await isTeamMember(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden: only owner/admin can create contests', code: 'FORBIDDEN' } }, 403);
  }

  const now = new Date().toISOString();
  let status = 'pending';
  if (new Date(start_time) <= new Date(now) && new Date(end_time) > new Date(now)) {
    status = 'running';
  } else if (new Date(end_time) <= new Date(now)) {
    status = 'finished';
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO team_contests (team_id, user_id, title, description, start_time, end_time, scoring_type, is_public, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, user.userId, title, description || '', start_time, end_time,
    scoring_type === 'ioi' ? 'ioi' : 'acm',
    is_public ? 1 : 0, status
  ).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Contest created' } }, 201);
});

// GET /teams/:id/contests/:contestId — 竞赛详情
teams.get('/:id/contests/:contestId', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');

  const contest: any = await c.env.DB.prepare(
    `SELECT tc.*, u.username
     FROM team_contests tc JOIN users u ON tc.user_id = u.id
     WHERE tc.id = ? AND tc.team_id = ?`
  ).bind(contestId, id).first();

  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const problems = await c.env.DB.prepare(
    `SELECT tcp.id, tcp.problem_id, tcp.sort_order, tcp.score,
       p.title, p.slug, p.difficulty
     FROM team_contest_problems tcp
     JOIN problems p ON tcp.problem_id = p.id
     WHERE tcp.team_contest_id = ?
     ORDER BY tcp.sort_order ASC, tcp.id ASC`
  ).bind(contestId).all();

  const participantCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_contest_participants WHERE team_contest_id = ?'
  ).bind(contestId).first();

  const currentUser = c.get('user');
  let isRegistered = false;
  if (currentUser) {
    const reg = await c.env.DB.prepare(
      'SELECT 1 FROM team_contest_participants WHERE team_contest_id = ? AND user_id = ?'
    ).bind(contestId, currentUser.userId).first();
    isRegistered = !!reg;
  }

  return c.json({
    success: true,
    data: {
      contest,
      problems: problems.results,
      participant_count: (participantCount as any)?.cnt || 0,
      is_registered: isRegistered,
    },
  });
});

// POST /teams/:id/contests/:contestId/register — 注册参赛
teams.post('/:id/contests/:contestId/register', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');

  const contest = await c.env.DB.prepare(
    'SELECT id, status, start_time, end_time FROM team_contests WHERE id = ? AND team_id = ?'
  ).bind(contestId, id).first();

  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  if (!await isTeamMember(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO team_contest_participants (team_contest_id, user_id) VALUES (?, ?)'
    ).bind(contestId, user.userId).run();
    return c.json({ success: true, data: { message: 'Registered for contest' } }, 201);
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return c.json({ success: false, error: { message: 'Already registered', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to register', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// GET /teams/:id/contests/:contestId/rankings — 竞赛排行榜
teams.get('/:id/contests/:contestId/rankings', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');

  const contest: any = await c.env.DB.prepare(
    'SELECT id, scoring_type FROM team_contests WHERE id = ? AND team_id = ?'
  ).bind(contestId, id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const participants = await c.env.DB.prepare(
    `SELECT tcp.user_id, u.username, u.avatar_url
     FROM team_contest_participants tcp JOIN users u ON tcp.user_id = u.id
     WHERE tcp.team_contest_id = ?`
  ).bind(contestId).all();

  const problems = await c.env.DB.prepare(
    'SELECT id, problem_id, sort_order, score FROM team_contest_problems WHERE team_contest_id = ? ORDER BY sort_order ASC'
  ).bind(contestId).all();

  const rankings = await Promise.all(
    (participants.results as any[]).map(async (p) => {
      let totalScore = 0;
      const problemResults: any[] = [];

      for (const prob of problems.results as any[]) {
        const best: any = await c.env.DB.prepare(
          `SELECT status, score, time_used, created_at FROM submissions
           WHERE user_id = ? AND problem_id = ? AND status IN ('accepted','wrong_answer','time_limit_exceeded')
           ORDER BY CASE WHEN status = 'accepted' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`
        ).bind(p.user_id, prob.problem_id).first();

        if (best) {
          const probScore = best.status === 'accepted' ? (prob.score || 100) : 0;
          totalScore += probScore;
          problemResults.push({
            problem_id: prob.problem_id,
            status: best.status,
            score: probScore,
            time_used: best.time_used,
          });
        } else {
          problemResults.push({
            problem_id: prob.problem_id,
            status: 'pending',
            score: 0,
          });
        }
      }

      return {
        user_id: p.user_id,
        username: p.username,
        avatar_url: p.avatar_url,
        total_score: totalScore,
        problems: problemResults,
      };
    })
  );

  rankings.sort((a, b) => b.total_score - a.total_score);

  return c.json({
    success: true,
    data: { rankings },
  });
});

// POST /teams/:id/contests/:contestId/problems — 添加题目到竞赛
teams.post('/:id/contests/:contestId/problems', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');
  const body = await c.req.json();
  const { problem_id, sort_order, score } = body;

  if (!problem_id) {
    return c.json({ success: false, error: { message: 'problem_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO team_contest_problems (team_contest_id, problem_id, sort_order, score) VALUES (?, ?, ?, ?)'
    ).bind(contestId, problem_id, sort_order || 0, score || 100).run();
    return c.json({ success: true, data: { message: 'Problem added to contest' } }, 201);
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return c.json({ success: false, error: { message: 'Problem already in this contest', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to add problem', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// DELETE /teams/:id/contests/:contestId/problems/:problemId — 从竞赛移除题目
teams.delete('/:id/contests/:contestId/problems/:problemId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare(
    'DELETE FROM team_contest_problems WHERE team_contest_id = ? AND problem_id = ?'
  ).bind(contestId, problemId).run();

  return c.json({ success: true, data: { message: 'Problem removed from contest' } });
});

export default teams;