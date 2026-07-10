import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const teams = new Hono<AppType>();

// GET /teams — 公开团队列表
teams.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search');
  const offset = (page - 1) * pageSize;

  let query = `SELECT t.id, t.name, t.slug, t.description, t.avatar_url, t.owner_id, t.created_at,
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

// GET /teams/:slug — 团队详情
teams.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const team = await c.env.DB.prepare(
    `SELECT t.*, u.username as owner_name,
       (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count
     FROM teams t JOIN users u ON t.owner_id = u.id WHERE t.slug = ?`
  ).bind(slug).first();

  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  const members = await c.env.DB.prepare(
    `SELECT tm.id, tm.user_id, tm.role, tm.joined_at, u.username, u.avatar_url,
       (SELECT COUNT(*) FROM submissions s WHERE s.user_id = tm.user_id AND s.status = 'accepted') as accepted_count
     FROM team_members tm JOIN users u ON tm.user_id = u.id
     WHERE tm.team_id = ? ORDER BY tm.role DESC, tm.joined_at ASC`
  ).bind((team as any).id).all();

  return c.json({ success: true, data: { team, members: members.results } });
});

// POST /teams — 创建团队
teams.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { name, slug, description, avatar_url, is_public } = body;

  if (!name || !slug) {
    return c.json({ success: false, error: { message: 'name and slug are required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return c.json({ success: false, error: { message: 'slug must be alphanumeric with dashes', code: 'BAD_REQUEST' } }, 400);
  }

  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO teams (name, slug, description, avatar_url, owner_id, is_public) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(name, slug, description || '', avatar_url || '', user.userId, is_public === false ? 0 : 1).run();

    // 创建者自动成为 owner
    await c.env.DB.prepare(
      'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)'
    ).bind(result.meta.last_row_id, user.userId, 'owner').run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Team created' } }, 201);
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return c.json({ success: false, error: { message: 'slug already exists', code: 'CONFLICT' } }, 409);
    }
    throw e;
  }
});

// PUT /teams/:id — 编辑（owner 或 admin）
teams.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();

  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((team as any).owner_id !== user.userId && user.role !== 'admin' && user.role !== 'super_admin' && user.userId !== 1) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const body = await c.req.json();
  const { name, description, avatar_url, is_public } = body;

  await c.env.DB.prepare(
    `UPDATE teams SET name = COALESCE(?, name), description = COALESCE(?, description),
       avatar_url = COALESCE(?, avatar_url), is_public = COALESCE(?, is_public),
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(name ?? null, description ?? null, avatar_url ?? null, is_public ?? null, id).run();

  return c.json({ success: true, data: { message: 'Team updated' } });
});

// DELETE /teams/:id — 删除
teams.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();

  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((team as any).owner_id !== user.userId && user.role !== 'admin' && user.role !== 'super_admin' && user.userId !== 1) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Team deleted' } });
});

// POST /teams/:id/join — 加入公开团队
teams.post('/:id/join', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  const team = await c.env.DB.prepare('SELECT is_public FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!(team as any).is_public) {
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
    throw e;
  }
});

// POST /teams/:id/leave — 离开
teams.post('/:id/leave', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if ((team as any).owner_id === user.userId) {
    return c.json({ success: false, error: { message: 'Owner cannot leave, transfer or delete the team', code: 'BAD_REQUEST' } }, 400);
  }

  await c.env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(id, user.userId).run();
  return c.json({ success: true, data: { message: 'Left team' } });
});

// DELETE /teams/:id/members/:userId — 移除成员（owner 或 admin）
teams.delete('/:id/members/:userId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const targetUserId = parseInt(c.req.param('userId'));

  const team = await c.env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(id).first();
  if (!team) {
    return c.json({ success: false, error: { message: 'Team not found', code: 'NOT_FOUND' } }, 404);
  }
  if ((team as any).owner_id !== user.userId && user.role !== 'admin' && user.role !== 'super_admin' && user.userId !== 1) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }
  if ((team as any).owner_id === targetUserId) {
    return c.json({ success: false, error: { message: 'Cannot remove owner', code: 'BAD_REQUEST' } }, 400);
  }

  await c.env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(id, targetUserId).run();
  return c.json({ success: true, data: { message: 'Member removed' } });
});

// GET /teams/:id/rankings — 团队内排行榜
teams.get('/:id/rankings', async (c) => {
  const id = parseInt(c.req.param('id'));
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

export default teams;
