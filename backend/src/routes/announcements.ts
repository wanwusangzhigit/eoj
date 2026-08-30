import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { escapeLikeWildcard } from '../utils/helpers';

const announcements = new Hono<AppType>();

// GET /announcements — 公开公告列表(仅 published,置顶优先)
announcements.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = (c.req.query('search') || '').trim();
  const offset = (page - 1) * pageSize;

  let where = "WHERE a.status = 'published'";
  const binds: any[] = [];
  const countBinds: any[] = [];
  if (search) {
    where += " AND (a.title LIKE ? ESCAPE '\\' OR a.content LIKE ? ESCAPE '\\')";
    const like = `%${escapeLikeWildcard(search)}%`;
    binds.push(like, like);
    countBinds.push(like, like);
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM site_announcements a ${where}`
  ).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at,
            u.username as author
     FROM site_announcements a LEFT JOIN users u ON a.created_by = u.id
     ${where}
     ORDER BY a.is_pinned DESC, a.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      announcements: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /announcements/:id — 单条公告
announcements.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const row = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at,
            u.username as author
     FROM site_announcements a LEFT JOIN users u ON a.created_by = u.id
     WHERE a.id = ? AND a.status = 'published'`
  ).bind(id).first();
  if (!row) {
    return c.json({ success: false, error: { message: 'Announcement not found', code: 'NOT_FOUND' } }, 404);
  }
  return c.json({ success: true, data: { announcement: row } });
});

// POST /announcements — 发布公告(admin)
announcements.post('/', authMiddleware, adminMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const title = (body.title || '').trim();
  const content = (body.content || '').trim();
  const isPinned = body.is_pinned ? 1 : 0;

  if (!title) {
    return c.json({ success: false, error: { message: 'Title is required', code: 'BAD_REQUEST' } }, 400);
  }
  if (title.length > 200) {
    return c.json({ success: false, error: { message: 'Title too long (max 200)', code: 'BAD_REQUEST' } }, 400);
  }
  if (content.length > 20000) {
    return c.json({ success: false, error: { message: 'Content too long (max 20000)', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO site_announcements (title, content, is_pinned, status, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(title, content, isPinned, 'published', user.userId).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Announcement published' } }, 201);
});

// PUT /announcements/:id — 编辑公告(admin)
announcements.put('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id FROM site_announcements WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Announcement not found', code: 'NOT_FOUND' } }, 404);
  }

  const title = body.title !== undefined ? String(body.title).trim() : undefined;
  const content = body.content !== undefined ? String(body.content).trim() : undefined;
  const isPinned = body.is_pinned !== undefined ? (body.is_pinned ? 1 : 0) : undefined;
  const status = body.status !== undefined ? String(body.status) : undefined;

  if (title !== undefined && title.length === 0) {
    return c.json({ success: false, error: { message: 'Title is required', code: 'BAD_REQUEST' } }, 400);
  }

  const updates: string[] = [];
  const binds: any[] = [];
  if (title !== undefined) { updates.push('title = ?'); binds.push(title); }
  if (content !== undefined) { updates.push('content = ?'); binds.push(content); }
  if (isPinned !== undefined) { updates.push('is_pinned = ?'); binds.push(isPinned); }
  if (status !== undefined && ['published', 'draft'].includes(status)) { updates.push('status = ?'); binds.push(status); }

  if (updates.length === 0) {
    return c.json({ success: false, error: { message: 'No fields to update', code: 'BAD_REQUEST' } }, 400);
  }

  updates.push("updated_at = datetime('now')");
  binds.push(id);
  await c.env.DB.prepare(`UPDATE site_announcements SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();

  return c.json({ success: true, data: { message: 'Announcement updated' } });
});

// DELETE /announcements/:id — 删除公告(admin)
announcements.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const existing = await c.env.DB.prepare('SELECT id FROM site_announcements WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Announcement not found', code: 'NOT_FOUND' } }, 404);
  }
  await c.env.DB.prepare('DELETE FROM site_announcements WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Announcement deleted' } });
});

// GET /announcements/admin/list — 全部公告(含草稿,admin)
announcements.get('/admin/list', authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM site_announcements').first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.is_pinned, a.status, a.created_at, a.updated_at,
            u.username as author
     FROM site_announcements a LEFT JOIN users u ON a.created_by = u.id
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      announcements: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

export default announcements;
