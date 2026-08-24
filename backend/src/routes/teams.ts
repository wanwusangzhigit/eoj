import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware, isAdmin } from '../middleware/auth';
import { escapeLikeWildcard } from '../utils/helpers';
import { validateSlug } from '../utils/validator';
import { fetchTestcases, saveTestcases, deleteTestcases } from '../utils/github-testcases';
import { fetchSpjCode, saveSpjCode, deleteSpjCode } from '../utils/github-spj';
import { parseContestTimeToMs } from '../utils/contest-time';

const VALID_SPJ_LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c', 'go', 'rust'];

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
    query += " AND (t.name LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')";
    countQuery += " AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')";
    binds.push(`%${escapeLikeWildcard(search)}%`, `%${escapeLikeWildcard(search)}%`);
    countBinds.push(`%${escapeLikeWildcard(search)}%`, `%${escapeLikeWildcard(search)}%`);
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

// GET /teams/:slug 或 /teams/:id — 团队详情(支持 slug 或数字 id)
teams.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const currentUser = c.get('user');

  const isNumeric = /^\d+$/.test(slug);
  const team = await c.env.DB.prepare(
    `SELECT t.*, u.username as owner_name,
       (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count
     FROM teams t JOIN users u ON t.owner_id = u.id WHERE ${isNumeric ? 't.id' : 't.slug'} = ?`
  ).bind(isNumeric ? parseInt(slug) : slug).first();

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
    `SELECT tm.id, tm.user_id, tm.role, tm.joined_at, tm.note, tm.group_id,
            tm.can_edit_problems, tm.can_edit_contests, tm.can_edit_lists,
            g.name as group_name, u.username, u.avatar_url,
       (SELECT COUNT(*) FROM submissions s WHERE s.user_id = tm.user_id AND s.status = 'accepted') as accepted_count
     FROM team_members tm
     LEFT JOIN team_groups g ON g.id = tm.group_id
     JOIN users u ON tm.user_id = u.id
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

// POST /teams/:id/problem-sets — 创建题目集(owner/admin 或题单子权限)
teams.post('/:id/problem-sets', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { title, description, is_public } = body;

  if (!title) {
    return c.json({ success: false, error: { message: 'title is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!await canManageLists(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'Forbidden: requires list management permission', code: 'FORBIDDEN' } }, 403);
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
  const isCreator = (problemSet as any).user_id === user.userId;
  if (!isCreator && !isTeamOwnerOrAdmin(team, user.userId, user) && !(await canManageLists(c.env.DB, id, user.userId))) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM team_problem_sets WHERE id = ?').bind(setId).run();
  return c.json({ success: true, data: { message: 'Problem set deleted' } });
});

// POST /teams/:id/problem-sets/:setId/items — 添加题目到题目集(owner/admin 或题单子权限)
teams.post('/:id/problem-sets/:setId/items', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const setId = parseInt(c.req.param('setId') || '0');
  const body = await c.req.json();
  const { problem_id, note, sort_order } = body;

  if (!problem_id) {
    return c.json({ success: false, error: { message: 'problem_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!await canManageLists(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'Forbidden: requires list management permission', code: 'FORBIDDEN' } }, 403);
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

// DELETE /teams/:id/problem-sets/:setId/items/:itemId — 从题目集移除题目(owner/admin 或题单子权限)
teams.delete('/:id/problem-sets/:setId/items/:itemId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const setId = parseInt(c.req.param('setId') || '0');
  const itemId = parseInt(c.req.param('itemId') || '0');

  if (!await canManageLists(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'Forbidden: requires list management permission', code: 'FORBIDDEN' } }, 403);
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

  // 每条附加按当前时间动态计算的 effective_status(不依赖可能过期的 status 静态字段)
  const contests = (results.results as any[]).map((tc: any) => {
    const nowMs = Date.now();
    const s = parseContestTimeToMs(tc.start_time);
    const e = parseContestTimeToMs(tc.end_time);
    let effective_status = tc.status;
    if (isFinite(s) && isFinite(e)) {
      if (nowMs >= s && nowMs < e) effective_status = 'running';
      else if (nowMs >= e) effective_status = 'finished';
      else effective_status = 'pending';
    }
    return { ...tc, effective_status };
  });

  return c.json({
    success: true,
    data: {
      contests,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /teams/:id/contests — 创建竞赛(owner/admin 或比赛子权限)
teams.post('/:id/contests', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { title, description, start_time, end_time, scoring_type, is_public } = body;

  if (!title || !start_time || !end_time) {
    return c.json({ success: false, error: { message: 'title, start_time, and end_time are required', code: 'BAD_REQUEST' } }, 400);
  }

  // 与官方赛创建接口一致的校验:时间顺序 + 长度限制
  if (new Date(start_time) >= new Date(end_time)) {
    return c.json({ success: false, error: { message: 'start_time must be before end_time', code: 'BAD_REQUEST' } }, 400);
  }
  if (title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (description && description.length > 5000) {
    return c.json({ success: false, error: { message: 'description must be at most 5000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  if (!await isTeamMember(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  if (!await canManageContests(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'Forbidden: requires contest management permission', code: 'FORBIDDEN' } }, 403);
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
    scoring_type === 'oi' ? 'oi' : scoring_type === 'ioi' ? 'ioi' : 'icpc',
    is_public ? 1 : 0, status
  ).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Contest created' } }, 201);
});

// GET /teams/:id/contests/:contestId — 竞赛详情
teams.get('/:id/contests/:contestId', authMiddleware, async (c) => {
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

  const currentUser = c.get('user');
  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  const isManager = team && isTeamOwnerOrAdmin(team, currentUser?.userId, currentUser);
  const userIsMember = currentUser ? await isTeamMember(c.env.DB, id, currentUser.userId) : false;

  // 按当前时间动态计算比赛状态(不依赖可能过期的 status 静态字段)
  const tcNowMs = Date.now();
  const tcStartMs = parseContestTimeToMs((contest as any).start_time);
  const tcEndMs = parseContestTimeToMs((contest as any).end_time);
  let effective_status: 'pending' | 'running' | 'finished' = 'pending';
  if (isFinite(tcStartMs) && isFinite(tcEndMs)) {
    if (tcNowMs >= tcStartMs && tcNowMs < tcEndMs) effective_status = 'running';
    else if (tcNowMs >= tcEndMs) effective_status = 'finished';
  }

  // 比赛前题目不可见:未开始仅主办方可见题目;运行中仅团队成员可见题目
  let problemsVisible = true;
  if (effective_status === 'pending' && !isManager) problemsVisible = false;
  if (effective_status === 'running' && !userIsMember && !isManager) problemsVisible = false;

  const problems = problemsVisible ? await c.env.DB.prepare(
    `SELECT tcp.id, tcp.problem_id, tcp.sort_order, tcp.score,
       p.title, p.slug, p.difficulty
     FROM team_contest_problems tcp
     JOIN problems p ON tcp.problem_id = p.id
     WHERE tcp.team_contest_id = ?
     ORDER BY tcp.sort_order ASC, tcp.id ASC`
  ).bind(contestId).all() : { results: [] };

  const participantCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_contest_participants WHERE team_contest_id = ?'
  ).bind(contestId).first();

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
      problems_visible: problemsVisible ? 1 : 0,
      effective_status,
      server_time: new Date().toISOString(),
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

// GET /teams/:id/contests/:contestId/problems/:problemId — 团队比赛单题详情
// 未开始仅主办方可见;运行中仅团队成员可见(与比赛详情一致)
teams.get('/:id/contests/:contestId/problems/:problemId', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');

  const contest: any = await c.env.DB.prepare(
    'SELECT id, start_time, end_time FROM team_contests WHERE id = ? AND team_id = ?'
  ).bind(contestId, id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const currentUser = c.get('user');
  if (!currentUser) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }
  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  const isManager = team && isTeamOwnerOrAdmin(team, currentUser.userId, currentUser);
  const userIsMember = await isTeamMember(c.env.DB, id, currentUser.userId);

  // 按当前时间动态判定:status 静态字段创建后不会更新,比赛开始后仍可能是 'pending'
  const tcNowMs = Date.now();
  const tcStartMs = parseContestTimeToMs((contest as any).start_time);
  const tcEndMs = parseContestTimeToMs((contest as any).end_time);
  const status = (!isFinite(tcStartMs) || !isFinite(tcEndMs))
    ? (contest as any).status
    : tcNowMs < tcStartMs ? 'pending' : tcNowMs < tcEndMs ? 'running' : 'finished';
  if (status === 'pending' && !isManager) {
    return c.json({ success: false, error: { message: 'Contest has not started yet', code: 'FORBIDDEN' } }, 403);
  }
  if (status === 'running' && !userIsMember && !isManager) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  const problem: any = await c.env.DB.prepare(
    `SELECT tcp.id as contest_problem_id, tcp.sort_order, tcp.score, p.*
     FROM team_contest_problems tcp
     JOIN problems p ON tcp.problem_id = p.id
     WHERE tcp.team_contest_id = ? AND tcp.problem_id = ?`
  ).bind(contestId, problemId).first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found in this contest', code: 'NOT_FOUND' } }, 404);
  }

  // 样例测试数据(与全局题目一致,仅返回 is_sample)
  let sampleTestcases: any[] = [];
  try {
    const all = await fetchTestcases(c.env, problem.slug);
    sampleTestcases = all.filter((tc) => tc.is_sample);
  } catch { /* ignore */ }

  const responseData: any = { problem, sampleTestcases };
  if (problem.judge_type === 'spj' && problem.spj_language) {
    responseData.spj_code = await fetchSpjCode(c.env, problem.slug, problem.spj_language);
  }

  return c.json({ success: true, data: responseData });
});

// GET /teams/:id/contests/:contestId/rankings — 竞赛排行榜
teams.get('/:id/contests/:contestId/rankings', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  const isManager = team && isTeamOwnerOrAdmin(team, user.userId, user);
  const userIsMember = await isTeamMember(c.env.DB, id, user.userId);
  // 与详情接口语义一致:非成员放行但返回空榜(不泄露参赛者数据),避免前端整页报错
  if (!isManager && !userIsMember) {
    return c.json({ success: true, data: { rankings: [], result_hidden: 0 } });
  }

  const contest: any = await c.env.DB.prepare(
    'SELECT id, scoring_type, start_time, end_time FROM team_contests WHERE id = ? AND team_id = ?'
  ).bind(contestId, id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // 按当前时间动态计算比赛状态(不依赖可能过期的 status 静态字段)
  const tcNowMs = Date.now();
  const tcStartMs = parseContestTimeToMs((contest as any).start_time);
  const tcEndMs = parseContestTimeToMs((contest as any).end_time);
  const effectiveStatus = (!isFinite(tcStartMs) || !isFinite(tcEndMs))
    ? (contest as any).status
    : tcNowMs < tcStartMs ? 'pending' : tcNowMs < tcEndMs ? 'running' : 'finished';
  // OI 赛制赛时隐藏评测结果(与官方赛一致,按动态状态判断)
  const oiRunning = (contest as any).scoring_type === 'oi' && effectiveStatus === 'running';

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
           WHERE user_id = ? AND problem_id = ? AND team_contest_id = ? AND status IN ('accepted','wrong_answer','time_limit_exceeded')
           ORDER BY CASE WHEN status = 'accepted' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`
        ).bind(p.user_id, prob.problem_id, contestId).first();

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

  // OI 赛时:隐藏每题得分/状态,保留排名(比赛结束后自动解禁)
  if (oiRunning) {
    for (const r of rankings as any[]) {
      r.total_score = null;
      for (const pr of r.problems) {
        pr.status = 'pending';
        pr.score = null;
        pr.time_used = null;
      }
    }
  }

  rankings.sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0));

  return c.json({
    success: true,
    data: { rankings, result_hidden: oiRunning ? 1 : 0 },
  });
});

// POST /teams/:id/contests/:contestId/problems — 添加题目到竞赛(owner/admin 或比赛子权限)
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
  if (!isTeamOwnerOrAdmin(team, user.userId, user) && !(await canManageContests(c.env.DB, id, user.userId))) {
    return c.json({ success: false, error: { message: 'Forbidden: requires contest management permission', code: 'FORBIDDEN' } }, 403);
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
  if (!isTeamOwnerOrAdmin(team, user.userId, user) && !(await canManageContests(c.env.DB, id, user.userId))) {
    return c.json({ success: false, error: { message: 'Forbidden: requires contest management permission', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare(
    'DELETE FROM team_contest_problems WHERE team_contest_id = ? AND problem_id = ?'
  ).bind(contestId, problemId).run();

  return c.json({ success: true, data: { message: 'Problem removed from contest' } });
});

// ============================================================
// 团队比赛公告
// ============================================================

// GET /teams/:id/contests/:contestId/announcements — 公告列表(团队成员可见)
teams.get('/:id/contests/:contestId/announcements', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');

  const contest: any = await c.env.DB.prepare(
    'SELECT id FROM team_contests WHERE id = ? AND team_id = ?'
  ).bind(contestId, id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const currentUser = c.get('user');
  const userIsMember = currentUser ? await isTeamMember(c.env.DB, id, currentUser.userId) : false;
  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!userIsMember && !isTeamOwnerOrAdmin(team, currentUser?.userId, currentUser)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const results = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at,
            u.id as user_id, u.username
     FROM team_contest_announcements a JOIN users u ON a.user_id = u.id
     WHERE a.team_contest_id = ?
     ORDER BY a.is_pinned DESC, a.created_at DESC`
  ).bind(contestId).all();

  return c.json({ success: true, data: { announcements: results.results } });
});

// POST /teams/:id/contests/:contestId/announcements — 发布公告(owner/admin 或比赛子权限)
teams.post('/:id/contests/:contestId/announcements', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');
  const body = await c.req.json();
  const { title, content, is_pinned } = body;

  if (!title || !content) {
    return c.json({ success: false, error: { message: 'title and content are required', code: 'BAD_REQUEST' } }, 400);
  }

  const contest: any = await c.env.DB.prepare(
    'SELECT id FROM team_contests WHERE id = ? AND team_id = ?'
  ).bind(contestId, id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!isTeamOwnerOrAdmin(team, user.userId, user) && !(await canManageContests(c.env.DB, id, user.userId))) {
    return c.json({ success: false, error: { message: 'Forbidden: requires contest management permission', code: 'FORBIDDEN' } }, 403);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO team_contest_announcements (team_contest_id, user_id, title, content, is_pinned) VALUES (?, ?, ?, ?, ?)'
  ).bind(contestId, user.userId, title, content, is_pinned ? 1 : 0).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Announcement published' } }, 201);
});

// DELETE /teams/:id/contests/:contestId/announcements/:announcementId — 删除公告(owner/admin 或比赛子权限)
teams.delete('/:id/contests/:contestId/announcements/:announcementId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');
  const announcementId = parseInt(c.req.param('announcementId') || '0');

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user) && !(await canManageContests(c.env.DB, id, user.userId))) {
    return c.json({ success: false, error: { message: 'Forbidden: requires contest management permission', code: 'FORBIDDEN' } }, 403);
  }

  const announcement: any = await c.env.DB.prepare(
    'SELECT id FROM team_contest_announcements WHERE id = ? AND team_contest_id = ?'
  ).bind(announcementId, contestId).first();
  if (!announcement) {
    return c.json({ success: false, error: { message: 'Announcement not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare('DELETE FROM team_contest_announcements WHERE id = ? AND team_contest_id = ?')
    .bind(announcementId, contestId).run();

  return c.json({ success: true, data: { message: 'Announcement deleted' } });
});

// ============================================================
// 团队比赛私密答疑
// ============================================================

// GET /teams/:id/contests/:contestId/clarifications — 答疑列表
// 选手只能看到自己的提问;主办方/管理员可看到全部
teams.get('/:id/contests/:contestId/clarifications', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');

  const contest: any = await c.env.DB.prepare(
    'SELECT id FROM team_contests WHERE id = ? AND team_id = ?'
  ).bind(contestId, id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  const isManager = team && isTeamOwnerOrAdmin(team, user.userId, user);
  const userIsMember = await isTeamMember(c.env.DB, id, user.userId);
  if (!userIsMember && !isManager) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  let query = `SELECT cl.id, cl.team_contest_id, cl.user_id, cl.question, cl.answer, cl.status,
                      cl.created_at, cl.answered_at, u.username
               FROM team_contest_clarifications cl JOIN users u ON cl.user_id = u.id
               WHERE cl.team_contest_id = ?`;
  const binds: any[] = [contestId];
  if (!isManager) {
    query += ' AND cl.user_id = ?';
    binds.push(user.userId);
  }
  query += ' ORDER BY cl.created_at DESC';

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  return c.json({ success: true, data: { clarifications: results.results } });
});

// POST /teams/:id/contests/:contestId/clarifications — 成员提交提问(仅团队成员)
teams.post('/:id/contests/:contestId/clarifications', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');
  const body = await c.req.json();
  const { question } = body;

  if (!question || !question.trim()) {
    return c.json({ success: false, error: { message: 'question is required', code: 'BAD_REQUEST' } }, 400);
  }
  if (question.length > 2000) {
    return c.json({ success: false, error: { message: 'question must be at most 2000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  const contest: any = await c.env.DB.prepare(
    'SELECT id, start_time, end_time FROM team_contests WHERE id = ? AND team_id = ?'
  ).bind(contestId, id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }
  // 按当前时间动态判定:status 静态字段创建后不会更新,比赛开始后仍可能是 'pending'
  const tcNowMs = Date.now();
  const tcStartMs = parseContestTimeToMs((contest as any).start_time);
  if (isFinite(tcStartMs) && tcNowMs < tcStartMs) {
    return c.json({ success: false, error: { message: 'Contest has not started yet', code: 'FORBIDDEN' } }, 403);
  }

  if (!await isTeamMember(c.env.DB, id, user.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO team_contest_clarifications (team_contest_id, user_id, question) VALUES (?, ?, ?)'
  ).bind(contestId, user.userId, question.trim()).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Question submitted' } }, 201);
});

// PUT /teams/:id/contests/:contestId/clarifications/:clarificationId — 主办方回答
teams.put('/:id/contests/:contestId/clarifications/:clarificationId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const contestId = parseInt(c.req.param('contestId') || '0');
  const clarificationId = parseInt(c.req.param('clarificationId') || '0');
  const body = await c.req.json();

  if (!body.answer || !body.answer.trim()) {
    return c.json({ success: false, error: { message: 'answer is required', code: 'BAD_REQUEST' } }, 400);
  }

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user) && !(await canManageContests(c.env.DB, id, user.userId))) {
    return c.json({ success: false, error: { message: 'Forbidden: requires contest management permission', code: 'FORBIDDEN' } }, 403);
  }

  const clarification: any = await c.env.DB.prepare(
    'SELECT id FROM team_contest_clarifications WHERE id = ? AND team_contest_id = ?'
  ).bind(clarificationId, contestId).first();
  if (!clarification) {
    return c.json({ success: false, error: { message: 'Clarification not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE team_contest_clarifications SET answer = ?, answered_by = ?, status = 'answered', answered_at = CURRENT_TIMESTAMP
     WHERE id = ? AND team_contest_id = ?`
  ).bind(body.answer.trim(), user.userId, clarificationId, contestId).run();

  return c.json({ success: true, data: { message: 'Answer submitted' } });
});

// ============================================================
// 团队私有题目
// ============================================================

// 判断成员是否有指定资源的团队管理权限(owner/admin 或对应子权限位)
async function canManageTeamResource(db: D1Database, teamId: number, userId: number, permColumn: string): Promise<boolean> {
  const team: any = await db.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(teamId).first();
  if (team && (team.owner_id === userId || isAdmin({ userId } as any))) return true;
  const row: any = await db.prepare(
    `SELECT ${permColumn} FROM team_members WHERE team_id = ? AND user_id = ?`
  ).bind(teamId, userId).first();
  return !!(row && row[permColumn] === 1);
}

function canManageProblems(db: D1Database, teamId: number, userId: number): Promise<boolean> {
  return canManageTeamResource(db, teamId, userId, 'can_edit_problems');
}

function canManageContests(db: D1Database, teamId: number, userId: number): Promise<boolean> {
  return canManageTeamResource(db, teamId, userId, 'can_edit_contests');
}

function canManageLists(db: D1Database, teamId: number, userId: number): Promise<boolean> {
  return canManageTeamResource(db, teamId, userId, 'can_edit_lists');
}

// GET /teams/:id/problems — 私有题目列表(仅成员可见)
teams.get('/:id/problems', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search');
  const offset = (page - 1) * pageSize;

  const currentUser = c.get('user');
  if (!currentUser) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }
  if (!await isTeamMember(c.env.DB, id, currentUser.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  let whereClause = 'WHERE tp.team_id = ?';
  const binds: any[] = [id];
  if (search) {
    whereClause += " AND (p.title LIKE ? ESCAPE '\\' OR p.slug LIKE ? ESCAPE '\\')";
    binds.push(`%${escapeLikeWildcard(search)}%`, `%${escapeLikeWildcard(search)}%`);
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM team_problems tp JOIN problems p ON tp.problem_id = p.id ${whereClause}`
  ).bind(...binds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.slug, p.difficulty, p.tags, p.time_limit, p.memory_limit,
            p.judge_type, p.created_at, tp.added_by, u.username as added_by_name
     FROM team_problems tp
     JOIN problems p ON tp.problem_id = p.id
     JOIN users u ON tp.added_by = u.id
     ${whereClause}
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      problems: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /teams/:id/problems — 创建私有题目(is_public=0 + team_problems 关联,测试数据存 GitHub)
teams.post('/:id/problems', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { title, slug, description, input_format, output_format, time_limit, memory_limit, tags, difficulty, testcases, judge_type, spj_language, spj_code } = body;

  if (!title || !slug || !description) {
    return c.json({ success: false, error: { message: 'title, slug, and description are required', code: 'BAD_REQUEST' } }, 400);
  }

  const slugError = validateSlug(slug);
  if (slugError) {
    return c.json({ success: false, error: { message: slugError, code: 'BAD_REQUEST' } }, 400);
  }

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user) && !(await canManageProblems(c.env.DB, id, user.userId))) {
    return c.json({ success: false, error: { message: 'Forbidden: requires problem management permission', code: 'FORBIDDEN' } }, 403);
  }

  const effectiveJudgeType = judge_type || 'default';
  if (effectiveJudgeType === 'spj') {
    if (!spj_language || !VALID_SPJ_LANGUAGES.includes(spj_language)) {
      return c.json({ success: false, error: { message: `spj_language is required and must be one of: ${VALID_SPJ_LANGUAGES.join(', ')}`, code: 'BAD_REQUEST' } }, 400);
    }
  }

  // 站点配置的团队限制校验:最大题目数 / 最大时间 / 最大内存
  const config = await getTeamLimitConfig(c.env.DB);
  if (effectiveJudgeType === 'spj' && !config.allow_spj) {
    return c.json({
      success: false,
      error: { message: 'SPJ is disabled for team problems', code: 'FORBIDDEN' },
    }, 403);
  }
  const countResult: any = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM team_problems WHERE team_id = ?'
  ).bind(id).first();
  if ((countResult?.cnt || 0) >= config.max_problems) {
    return c.json({
      success: false,
      error: { message: `Team problem count exceeds limit: max ${config.max_problems}`, code: 'BAD_REQUEST' },
    }, 400);
  }
  const effTimeLimit = time_limit || 1000;
  const effMemoryLimit = memory_limit || 256;
  if (effTimeLimit > config.max_time_limit) {
    return c.json({
      success: false,
      error: { message: `time_limit exceeds limit: max ${config.max_time_limit}ms`, code: 'BAD_REQUEST' },
    }, 400);
  }
  if (effMemoryLimit > config.max_memory_limit) {
    return c.json({
      success: false,
      error: { message: `memory_limit exceeds limit: max ${config.max_memory_limit}MB`, code: 'BAD_REQUEST' },
    }, 400);
  }

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO problems (title, slug, description, input_format, output_format, time_limit, memory_limit, tags, difficulty, is_public, judge_type, spj_language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(
      title, slug, description, input_format || null, output_format || null,
      effTimeLimit, effMemoryLimit, JSON.stringify(tags || []),
      difficulty || 'Easy', effectiveJudgeType, effectiveJudgeType === 'spj' ? spj_language : null
    ).run();

    const problemId = result.meta.last_row_id;

    await c.env.DB.prepare(
      'INSERT INTO team_problems (team_id, problem_id, added_by) VALUES (?, ?, ?)'
    ).bind(id, problemId, user.userId).run();

    // 测试数据与 SPJ 代码仍存 GitHub(复用全局评测管线)
    if (testcases && Array.isArray(testcases) && testcases.length > 0) {
      await saveTestcases(c.env, slug, testcases);
    }
    if (effectiveJudgeType === 'spj' && spj_code) {
      await saveSpjCode(c.env, slug, spj_language, spj_code);
    }

    return c.json({ success: true, data: { id: problemId, message: 'Problem created' } }, 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: { message: 'Slug already exists', code: 'CONFLICT' } }, 409);
    }
    console.error('Team problem create error:', e);
    return c.json({ success: false, error: { message: 'Failed to create problem', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// GET /teams/:id/problems/:problemId — 私有题目详情(仅成员可见,含样例)
teams.get('/:id/problems/:problemId', authMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');

  const currentUser = c.get('user');
  if (!currentUser) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }
  if (!await isTeamMember(c.env.DB, id, currentUser.userId)) {
    return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
  }

  const problem: any = await c.env.DB.prepare(
    `SELECT p.*, tp.added_by, u.username as added_by_name
     FROM team_problems tp
     JOIN problems p ON tp.problem_id = p.id
     JOIN users u ON tp.added_by = u.id
     WHERE tp.team_id = ? AND tp.problem_id = ?`
  ).bind(id, problemId).first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found in this team', code: 'NOT_FOUND' } }, 404);
  }

  const allTestcases = await fetchTestcases(c.env, problem.slug);
  const sampleTestcases = allTestcases.filter((tc) => tc.is_sample);

  const responseData: any = {
    problem,
    sampleTestcases,
  };
  if (problem.judge_type === 'spj' && problem.spj_language) {
    responseData.spj_code = await fetchSpjCode(c.env, problem.slug, problem.spj_language);
  }

  return c.json({ success: true, data: responseData });
});

// PUT /teams/:id/problems/:problemId — 编辑私有题目(owner/admin 或题目子权限)
teams.put('/:id/problems/:problemId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');
  const body = await c.req.json();

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user) && !(await canManageProblems(c.env.DB, id, user.userId))) {
    return c.json({ success: false, error: { message: 'Forbidden: requires problem management permission', code: 'FORBIDDEN' } }, 403);
  }

  const existing: any = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.judge_type, p.spj_language FROM team_problems tp
     JOIN problems p ON tp.problem_id = p.id
     WHERE tp.team_id = ? AND tp.problem_id = ?`
  ).bind(id, problemId).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found in this team', code: 'NOT_FOUND' } }, 404);
  }

  if (body.judge_type === 'spj') {
    const spjLang = body.spj_language || existing.spj_language;
    if (!spjLang || !VALID_SPJ_LANGUAGES.includes(spjLang)) {
      return c.json({ success: false, error: { message: `spj_language is required and must be one of: ${VALID_SPJ_LANGUAGES.join(', ')}`, code: 'BAD_REQUEST' } }, 400);
    }
    const config = await getTeamLimitConfig(c.env.DB);
    if (!config.allow_spj) {
      return c.json({
        success: false,
        error: { message: 'SPJ is disabled for team problems', code: 'FORBIDDEN' },
      }, 403);
    }
  }

  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (['title', 'description', 'input_format', 'output_format', 'time_limit', 'memory_limit', 'difficulty'].includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (key === 'tags') {
      fields.push('tags = ?');
      values.push(JSON.stringify(value));
    }
    if (key === 'judge_type') {
      fields.push('judge_type = ?');
      values.push(value);
    }
    if (key === 'spj_language') {
      fields.push('spj_language = ?');
      values.push(value || null);
    }
  }
  if (fields.length === 0) {
    return c.json({ success: false, error: { message: 'No fields to update', code: 'BAD_REQUEST' } }, 400);
  }

  // 站点配置的团队限制校验:最大时间 / 最大内存(仅在修改这两个字段时校验)
  if (body.time_limit !== undefined || body.memory_limit !== undefined) {
    const config = await getTeamLimitConfig(c.env.DB);
    if (body.time_limit !== undefined && Number(body.time_limit) > config.max_time_limit) {
      return c.json({
        success: false,
        error: { message: `time_limit exceeds limit: max ${config.max_time_limit}ms`, code: 'BAD_REQUEST' },
      }, 400);
    }
    if (body.memory_limit !== undefined && Number(body.memory_limit) > config.max_memory_limit) {
      return c.json({
        success: false,
        error: { message: `memory_limit exceeds limit: max ${config.max_memory_limit}MB`, code: 'BAD_REQUEST' },
      }, 400);
    }
  }

  fields.push("updated_at = datetime('now')");
  values.push(problemId);
  await c.env.DB.prepare(`UPDATE problems SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

  // 可选更新测试数据
  if (body.testcases && Array.isArray(body.testcases)) {
    await saveTestcases(c.env, existing.slug, body.testcases);
  }
  if (body.spj_code && body.judge_type === 'spj') {
    await saveSpjCode(c.env, existing.slug, body.spj_language || existing.spj_language, body.spj_code);
  }

  return c.json({ success: true, data: { message: 'Problem updated' } });
});

// DELETE /teams/:id/problems/:problemId — 删除私有题目(owner/admin 或题目子权限)
teams.delete('/:id/problems/:problemId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user) && !(await canManageProblems(c.env.DB, id, user.userId))) {
    return c.json({ success: false, error: { message: 'Forbidden: requires problem management permission', code: 'FORBIDDEN' } }, 403);
  }

  const existing: any = await c.env.DB.prepare(
    `SELECT p.slug, p.judge_type, p.spj_language FROM team_problems tp
     JOIN problems p ON tp.problem_id = p.id
     WHERE tp.team_id = ? AND tp.problem_id = ?`
  ).bind(id, problemId).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found in this team', code: 'NOT_FOUND' } }, 404);
  }

  // 清理 GitHub 测试数据/SPJ,再删除关联与题目
  await deleteTestcases(c.env, existing.slug);
  if (existing.judge_type === 'spj' && existing.spj_language) {
    await deleteSpjCode(c.env, existing.slug, existing.spj_language);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM team_problems WHERE team_id = ? AND problem_id = ?').bind(id, problemId),
    c.env.DB.prepare('DELETE FROM submissions WHERE problem_id = ?').bind(problemId),
    c.env.DB.prepare('DELETE FROM favorites WHERE problem_id = ?').bind(problemId),
    c.env.DB.prepare('DELETE FROM problems WHERE id = ?').bind(problemId),
  ]);

  return c.json({ success: true, data: { message: 'Problem deleted' } });
});

// ============================================================
// 团队私有题目测试数据(存 GitHub,与主题库一致)
// ============================================================

// 读取站点配置中的团队限制项,缺省用宽松默认值
async function getTeamLimitConfig(db: D1Database): Promise<{
  max_problems: number; max_time_limit: number; max_memory_limit: number;
  max_testcase_size: number; max_testcase_count: number;
  max_total_testcase_size: number; allow_spj: boolean;
}> {
  const defaults = {
    max_problems: 200, max_time_limit: 10000, max_memory_limit: 1024,
    max_testcase_size: 1024 * 1024, max_testcase_count: 100, // 1MB / 100 个
    max_total_testcase_size: 5 * 1024 * 1024, // 每题测试数据总量 5MB
  };
  const rows = await db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('team_max_problems','team_max_time_limit','team_max_memory_limit','team_max_testcase_size','team_max_testcase_count','team_max_total_testcase_size','team_allow_spj')"
  ).all();
  const map: Record<string, string> = {};
  for (const r of rows.results as any[]) map[r.key] = r.value;
  return {
    max_problems: parseInt(map.team_max_problems) || defaults.max_problems,
    max_time_limit: parseInt(map.team_max_time_limit) || defaults.max_time_limit,
    max_memory_limit: parseInt(map.team_max_memory_limit) || defaults.max_memory_limit,
    max_testcase_size: parseInt(map.team_max_testcase_size) || defaults.max_testcase_size,
    max_testcase_count: parseInt(map.team_max_testcase_count) || defaults.max_testcase_count,
    max_total_testcase_size: parseInt(map.team_max_total_testcase_size) || defaults.max_total_testcase_size,
    allow_spj: map.team_allow_spj !== 'false' && map.team_allow_spj !== '0',
  };
}

// 校验团队成员对私有题目的管理权限(owner/admin 或题目子权限)
async function canManageTeamProblem(db: D1Database, teamId: number, problemId: number, userId: number, user: any): Promise<boolean> {
  const team: any = await db.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return false;
  if (isTeamOwnerOrAdmin(team, userId, user)) return true;
  const row: any = await db.prepare(
    'SELECT can_edit_problems FROM team_members WHERE team_id = ? AND user_id = ?'
  ).bind(teamId, userId).first();
  return !!(row && row.can_edit_problems === 1);
}

// GET /teams/:id/problems/:problemId/testcases — 读取全部测试数据(团队题目管理权限)
teams.get('/:id/problems/:problemId/testcases', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');

  const existing: any = await c.env.DB.prepare(
    `SELECT p.slug FROM team_problems tp JOIN problems p ON tp.problem_id = p.id
     WHERE tp.team_id = ? AND tp.problem_id = ?`
  ).bind(id, problemId).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found in this team', code: 'NOT_FOUND' } }, 404);
  }
  if (!await canManageTeamProblem(c.env.DB, id, problemId, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden: requires problem management permission', code: 'FORBIDDEN' } }, 403);
  }

  const testcases = await fetchTestcases(c.env, existing.slug);
  return c.json({ success: true, data: { testcases } });
});

// POST /teams/:id/problems/:problemId/testcases — 追加测试数据(校验大小/数量上限)
teams.post('/:id/problems/:problemId/testcases', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');
  const body = await c.req.json();

  const existing: any = await c.env.DB.prepare(
    `SELECT p.slug, p.judge_type FROM team_problems tp JOIN problems p ON tp.problem_id = p.id
     WHERE tp.team_id = ? AND tp.problem_id = ?`
  ).bind(id, problemId).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found in this team', code: 'NOT_FOUND' } }, 404);
  }
  if (!await canManageTeamProblem(c.env.DB, id, problemId, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden: requires problem management permission', code: 'FORBIDDEN' } }, 403);
  }

  const config = await getTeamLimitConfig(c.env.DB);
  const isSpj = existing.judge_type === 'spj';
  const newTestcases = Array.isArray(body) ? body : [body];

  const validTestcases = newTestcases.filter((tc: any) =>
    tc.input && (isSpj || tc.expected_output)
  );
  if (validTestcases.length === 0) {
    return c.json({ success: false, error: { message: 'No valid testcases provided', code: 'BAD_REQUEST' } }, 400);
  }

  // 大小上限:单个测试点 input+expected_output 的字节数
  for (const tc of validTestcases) {
    const size = new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length;
    if (size > config.max_testcase_size) {
      return c.json({
        success: false,
        error: { message: `Testcase too large: max ${config.max_testcase_size} bytes`, code: 'BAD_REQUEST' },
      }, 400);
    }
  }

  // 数量上限:现有 + 新增
  const existingTestcases = await fetchTestcases(c.env, existing.slug);
  if (existingTestcases.length + validTestcases.length > config.max_testcase_count) {
    return c.json({
      success: false,
      error: { message: `Testcase count exceeds limit: max ${config.max_testcase_count}`, code: 'BAD_REQUEST' },
    }, 400);
  }

  // 单题测试数据总量上限:现有总量 + 新增总量
  const existingTotalSize = existingTestcases.reduce(
    (sum: number, tc: any) => sum + new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length,
    0
  );
  const newTotalSize = validTestcases.reduce(
    (sum: number, tc: any) => sum + new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length,
    0
  );
  if (existingTotalSize + newTotalSize > config.max_total_testcase_size) {
    return c.json({
      success: false,
      error: { message: `Total testcase size exceeds limit: max ${config.max_total_testcase_size} bytes`, code: 'BAD_REQUEST' },
    }, 400);
  }

  const allTestcases = [
    ...existingTestcases,
    ...validTestcases.map((tc: any) => ({
      input: tc.input,
      expected_output: tc.expected_output || '',
      is_sample: tc.is_sample || false,
      score: tc.score || 10,
    })),
  ];

  const success = await saveTestcases(c.env, existing.slug, allTestcases);
  if (!success) {
    return c.json({ success: false, error: { message: 'Failed to save testcases', code: 'INTERNAL_ERROR' } }, 500);
  }

  return c.json({ success: true, data: { message: 'Testcases added', count: validTestcases.length } }, 201);
});

// PUT /teams/:id/problems/:problemId/testcases — 全量替换测试数据(用于排序/整体编辑)
teams.put('/:id/problems/:problemId/testcases', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');
  const body = await c.req.json();

  const existing: any = await c.env.DB.prepare(
    `SELECT p.slug, p.judge_type FROM team_problems tp JOIN problems p ON tp.problem_id = p.id
     WHERE tp.team_id = ? AND tp.problem_id = ?`
  ).bind(id, problemId).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found in this team', code: 'NOT_FOUND' } }, 404);
  }
  if (!await canManageTeamProblem(c.env.DB, id, problemId, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden: requires problem management permission', code: 'FORBIDDEN' } }, 403);
  }

  const config = await getTeamLimitConfig(c.env.DB);
  const isSpj = existing.judge_type === 'spj';
  const newTestcases = Array.isArray(body) ? body : [body];

  const validTestcases = newTestcases.filter((tc: any) =>
    tc.input && (isSpj || tc.expected_output)
  );

  // 大小上限:单个测试点
  const byteLen = (s: string) => new TextEncoder().encode(s).length;
  for (const tc of validTestcases) {
    const size = byteLen(String(tc.input || '')) + byteLen(String(tc.expected_output || ''));
    if (size > config.max_testcase_size) {
      return c.json({
        success: false,
        error: { message: `Testcase too large: max ${config.max_testcase_size} bytes`, code: 'BAD_REQUEST' },
      }, 400);
    }
  }

  // 数量上限
  if (validTestcases.length > config.max_testcase_count) {
    return c.json({
      success: false,
      error: { message: `Testcase count exceeds limit: max ${config.max_testcase_count}`, code: 'BAD_REQUEST' },
    }, 400);
  }

  // 总量上限
  const totalSize = validTestcases.reduce(
    (sum: number, tc: any) => sum + byteLen(String(tc.input || '')) + byteLen(String(tc.expected_output || '')),
    0
  );
  if (totalSize > config.max_total_testcase_size) {
    return c.json({
      success: false,
      error: { message: `Total testcase size exceeds limit: max ${config.max_total_testcase_size} bytes`, code: 'BAD_REQUEST' },
    }, 400);
  }

  const normalized = validTestcases.map((tc: any) => ({
    input: tc.input,
    expected_output: tc.expected_output || '',
    is_sample: tc.is_sample || false,
    score: tc.score || 10,
  }));

  const success = await saveTestcases(c.env, existing.slug, normalized);
  if (!success) {
    return c.json({ success: false, error: { message: 'Failed to save testcases', code: 'INTERNAL_ERROR' } }, 500);
  }

  return c.json({ success: true, data: { message: 'Testcases replaced', count: normalized.length } });
});

// DELETE /teams/:id/problems/:problemId/testcases/:index — 删除单个测试点
teams.delete('/:id/problems/:problemId/testcases/:index', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');
  const index = parseInt(c.req.param('index') || '0');

  const existing: any = await c.env.DB.prepare(
    `SELECT p.slug FROM team_problems tp JOIN problems p ON tp.problem_id = p.id
     WHERE tp.team_id = ? AND tp.problem_id = ?`
  ).bind(id, problemId).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found in this team', code: 'NOT_FOUND' } }, 404);
  }
  if (!await canManageTeamProblem(c.env.DB, id, problemId, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden: requires problem management permission', code: 'FORBIDDEN' } }, 403);
  }

  const testcases = await fetchTestcases(c.env, existing.slug);
  if (index < 0 || index >= testcases.length) {
    return c.json({ success: false, error: { message: 'Testcase index out of range', code: 'NOT_FOUND' } }, 404);
  }
  testcases.splice(index, 1);
  const success = await saveTestcases(c.env, existing.slug, testcases);
  if (!success) {
    return c.json({ success: false, error: { message: 'Failed to delete testcase', code: 'INTERNAL_ERROR' } }, 500);
  }

  return c.json({ success: true, data: { message: 'Testcase deleted' } });
});

// ============================================================
// 成员备注、分组、子权限
// ============================================================

// PUT /teams/:id/members/:userId/note — 设置成员备注(如真实姓名,owner/admin)
teams.put('/:id/members/:userId/note', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const targetUserId = parseInt(c.req.param('userId') || '0');
  const body = await c.req.json();
  const { note } = body;

  if (typeof note !== 'string') {
    return c.json({ success: false, error: { message: 'note is required', code: 'BAD_REQUEST' } }, 400);
  }

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const member = await c.env.DB.prepare(
    'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?'
  ).bind(id, targetUserId).first();
  if (!member) {
    return c.json({ success: false, error: { message: 'Member not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare('UPDATE team_members SET note = ? WHERE team_id = ? AND user_id = ?')
    .bind(note, id, targetUserId).run();

  return c.json({ success: true, data: { message: 'Note updated' } });
});

// GET /teams/:id/groups — 分组列表
teams.get('/:id/groups', async (c) => {
  const id = parseInt(c.req.param('id') || '0');

  const team: any = await c.env.DB.prepare('SELECT id, is_public FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  const currentUser = c.get('user');
  const userIsMember = currentUser ? await isTeamMember(c.env.DB, id, currentUser.userId) : false;
  if (!team.is_public && !userIsMember) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const results = await c.env.DB.prepare(
    `SELECT g.id, g.name, g.sort_order, g.created_at,
       (SELECT COUNT(*) FROM team_members tm WHERE tm.group_id = g.id) as member_count
     FROM team_groups g WHERE g.team_id = ? ORDER BY g.sort_order ASC, g.id ASC`
  ).bind(id).all();

  return c.json({ success: true, data: { groups: results.results } });
});

// POST /teams/:id/groups — 创建分组(owner/admin)
teams.post('/:id/groups', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { name, sort_order } = body;

  if (!name || !name.trim()) {
    return c.json({ success: false, error: { message: 'name is required', code: 'BAD_REQUEST' } }, 400);
  }

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO team_groups (team_id, name, sort_order) VALUES (?, ?, ?)'
  ).bind(id, name.trim(), sort_order || 0).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Group created' } }, 201);
});

// PUT /teams/:id/groups/:groupId — 编辑分组(owner/admin)
teams.put('/:id/groups/:groupId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const groupId = parseInt(c.req.param('groupId') || '0');
  const body = await c.req.json();

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const group: any = await c.env.DB.prepare(
    'SELECT id FROM team_groups WHERE id = ? AND team_id = ?'
  ).bind(groupId, id).first();
  if (!group) {
    return c.json({ success: false, error: { message: 'Group not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE team_groups SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ? AND team_id = ?'
  ).bind(body.name ?? null, body.sort_order ?? null, groupId, id).run();

  return c.json({ success: true, data: { message: 'Group updated' } });
});

// DELETE /teams/:id/groups/:groupId — 删除分组(owner/admin;成员自动解除分组)
teams.delete('/:id/groups/:groupId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const groupId = parseInt(c.req.param('groupId') || '0');

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const group: any = await c.env.DB.prepare(
    'SELECT id FROM team_groups WHERE id = ? AND team_id = ?'
  ).bind(groupId, id).first();
  if (!group) {
    return c.json({ success: false, error: { message: 'Group not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE team_members SET group_id = NULL WHERE team_id = ? AND group_id = ?').bind(id, groupId),
    c.env.DB.prepare('DELETE FROM team_groups WHERE id = ? AND team_id = ?').bind(groupId, id),
  ]);

  return c.json({ success: true, data: { message: 'Group deleted' } });
});

// PUT /teams/:id/members/:userId/group — 设置成员分组(owner/admin)
teams.put('/:id/members/:userId/group', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const targetUserId = parseInt(c.req.param('userId') || '0');
  const body = await c.req.json();
  const { group_id } = body;

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const member = await c.env.DB.prepare(
    'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?'
  ).bind(id, targetUserId).first();
  if (!member) {
    return c.json({ success: false, error: { message: 'Member not found', code: 'NOT_FOUND' } }, 404);
  }

  if (group_id) {
    const group: any = await c.env.DB.prepare(
      'SELECT id FROM team_groups WHERE id = ? AND team_id = ?'
    ).bind(group_id, id).first();
    if (!group) {
      return c.json({ success: false, error: { message: 'Group not found', code: 'NOT_FOUND' } }, 404);
    }
  }

  await c.env.DB.prepare('UPDATE team_members SET group_id = ? WHERE team_id = ? AND user_id = ?')
    .bind(group_id || null, id, targetUserId).run();

  return c.json({ success: true, data: { message: 'Group assigned' } });
});

// PUT /teams/:id/members/:userId/permissions — 授予/收回子权限(owner/admin)
// 子权限: can_edit_problems(题目管理) / can_edit_contests(比赛管理) / can_edit_lists(题单管理)
teams.put('/:id/members/:userId/permissions', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const targetUserId = parseInt(c.req.param('userId') || '0');
  const body = await c.req.json();
  const { can_edit_problems, can_edit_contests, can_edit_lists } = body;

  const team: any = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isTeamOwnerOrAdmin(team, user.userId, user)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const member = await c.env.DB.prepare(
    'SELECT id, role FROM team_members WHERE team_id = ? AND user_id = ?'
  ).bind(id, targetUserId).first();
  if (!member) {
    return c.json({ success: false, error: { message: 'Member not found', code: 'NOT_FOUND' } }, 404);
  }
  if ((member as any).role === 'owner') {
    return c.json({ success: false, error: { message: 'Cannot modify owner permissions', code: 'BAD_REQUEST' } }, 400);
  }

  const updates: string[] = [];
  const binds: any[] = [];
  if (can_edit_problems !== undefined) { updates.push('can_edit_problems = ?'); binds.push(can_edit_problems ? 1 : 0); }
  if (can_edit_contests !== undefined) { updates.push('can_edit_contests = ?'); binds.push(can_edit_contests ? 1 : 0); }
  if (can_edit_lists !== undefined) { updates.push('can_edit_lists = ?'); binds.push(can_edit_lists ? 1 : 0); }
  if (updates.length === 0) {
    return c.json({ success: false, error: { message: 'No permission fields provided', code: 'BAD_REQUEST' } }, 400);
  }
  binds.push(id, targetUserId);
  await c.env.DB.prepare(
    `UPDATE team_members SET ${updates.join(', ')} WHERE team_id = ? AND user_id = ?`
  ).bind(...binds).run();

  return c.json({ success: true, data: { message: 'Permissions updated' } });
});

export default teams;