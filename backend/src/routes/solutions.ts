import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { sendNotification, NotificationType } from '../utils/notify';

const solutions = new Hono<AppType>();

// Helper: get current user from optional auth (用于审核状态过滤)
async function getCurrentUser(c: any): Promise<{ userId: number; role: string } | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const { verifyJWT } = await import('../utils/jwt');
    const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET);
    return payload as any;
  } catch {
    return null;
  }
}

// List solutions for a problem
solutions.get('/', async (c) => {
  const problemId = parseInt(c.req.query('problem_id') || '0');
  if (!problemId) {
    return c.json({ success: false, error: { message: 'problem_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const sort = c.req.query('sort') || 'newest';
  const offset = (page - 1) * pageSize;
  const currentUser = await getCurrentUser(c);
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.userId === 1;

  // 普通用户只能看 approved + 自己的 pending/rejected；管理员看全部
  let whereClause = 's.problem_id = ?';
  const binds: any[] = [problemId];
  if (!isAdmin) {
    if (currentUser) {
      whereClause += " AND (s.review_status = 'approved' OR s.user_id = ?)";
      binds.push(currentUser.userId);
    } else {
      whereClause += " AND s.review_status = 'approved'";
    }
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM solutions s WHERE ${whereClause}`
  ).bind(...binds).first();
  const total = (countResult as any)?.total || 0;

  const orderBy = sort === 'popular' ? 's.vote_count DESC, s.created_at DESC' : 's.created_at DESC';

  const results = await c.env.DB.prepare(
    `SELECT s.id, s.problem_id, s.user_id, s.title, s.language, s.vote_count, s.view_count, s.review_status, s.created_at, s.updated_at, u.username
     FROM solutions s
     JOIN users u ON s.user_id = u.id
     WHERE ${whereClause}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      solutions: results.results,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
});

// Get solution detail
solutions.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id') || '0');

  const solution = await c.env.DB.prepare(
    `SELECT s.*, u.username
     FROM solutions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = ?`
  ).bind(id).first();

  if (!solution) {
    return c.json({ success: false, error: { message: 'Solution not found', code: 'NOT_FOUND' } }, 404);
  }

  // Increment view_count
  await c.env.DB.prepare(
    'UPDATE solutions SET view_count = view_count + 1 WHERE id = ?'
  ).bind(id).run();

  // Check if current user has voted (if logged in)
  let is_voted = false;
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const { verifyJWT } = await import('../utils/jwt');
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      if (payload) {
        const vote = await c.env.DB.prepare(
          'SELECT id FROM solution_votes WHERE solution_id = ? AND user_id = ?'
        ).bind(id, (payload as any).userId).first();
        is_voted = !!vote;
      }
    } catch {
      // Ignore token errors for public access
    }
  }

  return c.json({
    success: true,
    data: {
      solution: {
        ...solution,
        view_count: (solution as any).view_count + 1,
      },
      is_voted,
    },
  });
});

// Create solution
solutions.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { problem_id, title, content, language } = body;

  if (!title) {
    return c.json({ success: false, error: { message: 'title is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!content) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!problem_id) {
    return c.json({ success: false, error: { message: 'problem_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  // Verify problem exists
  const problem = await c.env.DB.prepare(
    'SELECT id FROM problems WHERE id = ?'
  ).bind(problem_id).first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  const result = await c.env.DB.prepare(
    "INSERT INTO solutions (problem_id, user_id, title, content, language, review_status) VALUES (?, ?, ?, ?, ?, 'pending')"
  ).bind(problem_id, user.userId, title, content, language || '').run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Solution created, awaiting review' } }, 201);
});

// === 题解审核管理接口（admin） ===

// GET /solutions/admin/review — 待审核列表
solutions.get('/admin/review', authMiddleware, adminMiddleware, async (c) => {
  const status = c.req.query('status') || 'pending';
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM solutions WHERE review_status = ?'
  ).bind(status).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT s.id, s.problem_id, s.user_id, s.title, s.language, s.review_status, s.reject_reason, s.created_at, s.reviewed_at,
       u.username, p.title as problem_title, p.slug as problem_slug
     FROM solutions s
     JOIN users u ON s.user_id = u.id
     JOIN problems p ON s.problem_id = p.id
     WHERE s.review_status = ?
     ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  ).bind(status, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      solutions: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /solutions/admin/:id/approve — 通过审核
solutions.post('/admin/:id/approve', authMiddleware, adminMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  const solution = await c.env.DB.prepare('SELECT user_id, title FROM solutions WHERE id = ?').bind(id).first();
  if (!solution) {
    return c.json({ success: false, error: { message: 'Solution not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE solutions SET review_status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, reject_reason = '' WHERE id = ?`
  ).bind(user.userId, id).run();

  // 通知作者
  await sendNotification(
    c.env.DB,
    (solution as any).user_id,
    NotificationType.SOLUTION_REVIEW,
    '题解审核通过',
    `你的题解《${(solution as any).title}》已通过审核`,
    `/solutions/${id}`
  );

  return c.json({ success: true, data: { message: 'Solution approved' } });
});

// POST /solutions/admin/:id/reject — 驳回
solutions.post('/admin/:id/reject', authMiddleware, adminMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { reason } = body;

  const solution = await c.env.DB.prepare('SELECT user_id, title FROM solutions WHERE id = ?').bind(id).first();
  if (!solution) {
    return c.json({ success: false, error: { message: 'Solution not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE solutions SET review_status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, reject_reason = ? WHERE id = ?`
  ).bind(user.userId, reason || '', id).run();

  await sendNotification(
    c.env.DB,
    (solution as any).user_id,
    NotificationType.SOLUTION_REVIEW,
    '题解审核未通过',
    `你的题解《${(solution as any).title}》未通过审核：${reason || '无说明'}`,
    `/solutions/${id}`
  );

  return c.json({ success: true, data: { message: 'Solution rejected' } });
});

// Update solution
solutions.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT id, user_id FROM solutions WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return c.json({ success: false, error: { message: 'Solution not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((existing as any).user_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Forbidden: only author can edit', code: 'FORBIDDEN' } }, 403);
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (body.title !== undefined) {
    fields.push('title = ?');
    values.push(body.title);
  }
  if (body.content !== undefined) {
    fields.push('content = ?');
    values.push(body.content);
  }
  if (body.language !== undefined) {
    fields.push('language = ?');
    values.push(body.language);
  }

  if (fields.length === 0) {
    return c.json({ success: false, error: { message: 'No fields to update', code: 'BAD_REQUEST' } }, 400);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  await c.env.DB.prepare(
    `UPDATE solutions SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return c.json({ success: true, data: { message: 'Solution updated' } });
});

// Delete solution
solutions.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  const existing = await c.env.DB.prepare(
    'SELECT id, user_id FROM solutions WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return c.json({ success: false, error: { message: 'Solution not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((existing as any).user_id !== user.userId && user.role !== 'admin') {
    return c.json({ success: false, error: { message: 'Forbidden: only author or admin can delete', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM solution_votes WHERE solution_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM solutions WHERE id = ?').bind(id).run();

  return c.json({ success: true, data: { message: 'Solution deleted' } });
});

// Toggle vote on solution
solutions.post('/:id/vote', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  const solution = await c.env.DB.prepare(
    'SELECT id, vote_count FROM solutions WHERE id = ?'
  ).bind(id).first();

  if (!solution) {
    return c.json({ success: false, error: { message: 'Solution not found', code: 'NOT_FOUND' } }, 404);
  }

  const existingVote = await c.env.DB.prepare(
    'SELECT id FROM solution_votes WHERE solution_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();

  let is_voted: boolean;
  let vote_count: number;

  if (existingVote) {
    // Remove vote
    await c.env.DB.prepare(
      'DELETE FROM solution_votes WHERE solution_id = ? AND user_id = ?'
    ).bind(id, user.userId).run();
    await c.env.DB.prepare(
      'UPDATE solutions SET vote_count = vote_count - 1 WHERE id = ?'
    ).bind(id).run();
    is_voted = false;
    vote_count = (solution as any).vote_count - 1;
  } else {
    // Add vote
    await c.env.DB.prepare(
      'INSERT INTO solution_votes (solution_id, user_id) VALUES (?, ?)'
    ).bind(id, user.userId).run();
    await c.env.DB.prepare(
      'UPDATE solutions SET vote_count = vote_count + 1 WHERE id = ?'
    ).bind(id).run();
    is_voted = true;
    vote_count = (solution as any).vote_count + 1;
  }

  return c.json({
    success: true,
    data: {
      vote_count,
      is_voted,
    },
  });
});

export default solutions;
