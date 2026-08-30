import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const friendLinks = new Hono<AppType>();

// GET /friend-links — 公开启用中的友链列表(按 sort_order)
friendLinks.get('/', async (c) => {
  const results = await c.env.DB.prepare(
    'SELECT id, name, url, description, icon FROM friend_links WHERE enabled = 1 ORDER BY sort_order ASC, id ASC'
  ).all();
  return c.json({ success: true, data: { links: results.results } });
});

// GET /friend-links/admin — 全部友链(含禁用,admin)
friendLinks.get('/admin', authMiddleware, adminMiddleware, async (c) => {
  const results = await c.env.DB.prepare(
    'SELECT id, name, url, description, icon, sort_order, enabled, created_at FROM friend_links ORDER BY sort_order ASC, id ASC'
  ).all();
  return c.json({ success: true, data: { links: results.results } });
});

// POST /friend-links — 新增友链(admin)
friendLinks.post('/', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json();
  const name = (body.name || '').trim();
  const url = (body.url || '').trim();

  if (!name || !url) {
    return c.json({ success: false, error: { message: 'name and url are required', code: 'BAD_REQUEST' } }, 400);
  }
  if (name.length > 100 || url.length > 500) {
    return c.json({ success: false, error: { message: 'name or url too long', code: 'BAD_REQUEST' } }, 400);
  }
  // 仅允许 http(s) 链接,防止 javascript: 等伪协议
  if (!/^https?:\/\//i.test(url)) {
    return c.json({ success: false, error: { message: 'url must start with http(s)://', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO friend_links (name, url, description, icon, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    name,
    url,
    (body.description || '').toString().substring(0, 200),
    (body.icon || '').toString().substring(0, 500),
    parseInt(body.sort_order) || 0,
    body.enabled === false ? 0 : 1
  ).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Friend link created' } }, 201);
});

// PUT /friend-links/:id — 编辑友链(admin)
friendLinks.put('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id FROM friend_links WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Friend link not found', code: 'NOT_FOUND' } }, 404);
  }

  const name = body.name !== undefined ? String(body.name).trim() : undefined;
  const url = body.url !== undefined ? String(body.url).trim() : undefined;
  if (url !== undefined && !/^https?:\/\//i.test(url)) {
    return c.json({ success: false, error: { message: 'url must start with http(s)://', code: 'BAD_REQUEST' } }, 400);
  }

  const updates: string[] = [];
  const binds: any[] = [];
  if (name !== undefined) { updates.push('name = ?'); binds.push(name); }
  if (url !== undefined) { updates.push('url = ?'); binds.push(url); }
  if (body.description !== undefined) { updates.push('description = ?'); binds.push(String(body.description).substring(0, 200)); }
  if (body.icon !== undefined) { updates.push('icon = ?'); binds.push(String(body.icon).substring(0, 500)); }
  if (body.sort_order !== undefined) { updates.push('sort_order = ?'); binds.push(parseInt(body.sort_order) || 0); }
  if (body.enabled !== undefined) { updates.push('enabled = ?'); binds.push(body.enabled ? 1 : 0); }

  if (updates.length === 0) {
    return c.json({ success: false, error: { message: 'No fields to update', code: 'BAD_REQUEST' } }, 400);
  }

  binds.push(id);
  await c.env.DB.prepare(`UPDATE friend_links SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true, data: { message: 'Friend link updated' } });
});

// DELETE /friend-links/:id — 删除友链(admin)
friendLinks.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const existing = await c.env.DB.prepare('SELECT id FROM friend_links WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Friend link not found', code: 'NOT_FOUND' } }, 404);
  }
  await c.env.DB.prepare('DELETE FROM friend_links WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Friend link deleted' } });
});

export default friendLinks;
