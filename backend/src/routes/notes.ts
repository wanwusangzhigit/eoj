import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';

const notes = new Hono<AppType>();

// GET /notes — 获取当前用户的所有笔记
notes.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM problem_notes WHERE user_id = ?'
  ).bind(user.userId).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT pn.id, pn.problem_id, pn.content, pn.is_public, pn.created_at, pn.updated_at,
       p.title as problem_title, p.slug as problem_slug
     FROM problem_notes pn
     JOIN problems p ON pn.problem_id = p.id
     WHERE pn.user_id = ?
     ORDER BY pn.updated_at DESC LIMIT ? OFFSET ?`
  ).bind(user.userId, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      notes: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /notes/:problemId — 获取指定题目的笔记
notes.get('/:problemId', authMiddleware, async (c) => {
  const user = c.get('user');
  const problemId = parseInt(c.req.param('problemId') || '0');

  const note = await c.env.DB.prepare(
    'SELECT * FROM problem_notes WHERE user_id = ? AND problem_id = ?'
  ).bind(user.userId, problemId).first();

  return c.json({
    success: true,
    data: { note: note || null },
  });
});

// PUT /notes/:problemId — 保存/更新笔记
notes.put('/:problemId', authMiddleware, async (c) => {
  const user = c.get('user');
  const problemId = parseInt(c.req.param('problemId') || '0');
  const body = await c.req.json();
  const { content, is_public } = body;

  if (content === undefined) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (content.length > 50000) {
    return c.json({ success: false, error: { message: 'Note too long (max 50000 chars)', code: 'BAD_REQUEST' } }, 400);
  }

  // Upsert
  const existing = await c.env.DB.prepare(
    'SELECT id FROM problem_notes WHERE user_id = ? AND problem_id = ?'
  ).bind(user.userId, problemId).first();

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE problem_notes SET content = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND problem_id = ?'
    ).bind(content, is_public ? 1 : 0, user.userId, problemId).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO problem_notes (user_id, problem_id, content, is_public) VALUES (?, ?, ?, ?)'
    ).bind(user.userId, problemId, content, is_public ? 1 : 0).run();
  }

  return c.json({ success: true, data: { message: 'Note saved' } });
});

// DELETE /notes/:problemId — 删除笔记
notes.delete('/:problemId', authMiddleware, async (c) => {
  const user = c.get('user');
  const problemId = parseInt(c.req.param('problemId') || '0');

  await c.env.DB.prepare(
    'DELETE FROM problem_notes WHERE user_id = ? AND problem_id = ?'
  ).bind(user.userId, problemId).run();

  return c.json({ success: true, data: { message: 'Note deleted' } });
});

export default notes;