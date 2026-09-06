import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const customPages = new Hono<AppType>();

const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// GET /pages — 公开页面列表(仅启用,供页脚导航)
customPages.get('/', async (c) => {
  const results = await c.env.DB.prepare(
    'SELECT id, slug, title FROM custom_pages WHERE enabled = 1 ORDER BY id ASC'
  ).all();
  return c.json({ success: true, data: { pages: results.results } });
});

// GET /pages/admin — 全部页面(admin)
customPages.get('/admin', authMiddleware, adminMiddleware, async (c) => {
  const results = await c.env.DB.prepare(
    'SELECT id, slug, title, show_in_footer, enabled, created_at, updated_at FROM custom_pages ORDER BY id ASC'
  ).all();
  return c.json({ success: true, data: { pages: results.results } });
});

// GET /pages/:slug — 公开页面内容
customPages.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const page: any = await c.env.DB.prepare(
    'SELECT id, slug, title, content, created_at, updated_at FROM custom_pages WHERE slug = ? AND enabled = 1'
  ).bind(slug).first();
  if (!page) {
    return c.json({ success: false, error: { message: 'Page not found', code: 'NOT_FOUND' } }, 404);
  }
  return c.json({ success: true, data: { page } });
});

// POST /pages — 创建页面(admin)
customPages.post('/', authMiddleware, adminMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const slug = (body.slug || '').trim().toLowerCase();
  const title = (body.title || '').trim();

  if (!slug || !title) {
    return c.json({ success: false, error: { message: 'slug and title are required', code: 'BAD_REQUEST' } }, 400);
  }
  if (!VALID_SLUG.test(slug)) {
    return c.json({ success: false, error: { message: 'slug must be lowercase letters, numbers and hyphens', code: 'BAD_REQUEST' } }, 400);
  }
  if (title.length > 200) {
    return c.json({ success: false, error: { message: 'title too long', code: 'BAD_REQUEST' } }, 400);
  }
  const content = (body.content || '').toString().substring(0, 50000);

  const existing = await c.env.DB.prepare('SELECT id FROM custom_pages WHERE slug = ?').bind(slug).first();
  if (existing) {
    return c.json({ success: false, error: { message: 'slug already exists', code: 'CONFLICT' } }, 409);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO custom_pages (slug, title, content, show_in_footer, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(slug, title, content, body.show_in_footer ? 1 : 0, body.enabled === false ? 0 : 1, user.userId).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Page created' } }, 201);
});

// PUT /pages/:id — 编辑页面(admin)
customPages.put('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id, slug FROM custom_pages WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Page not found', code: 'NOT_FOUND' } }, 404);
  }

  const updates: string[] = [];
  const binds: any[] = [];

  const slug = body.slug !== undefined ? String(body.slug).trim().toLowerCase() : undefined;
  if (slug !== undefined) {
    if (!VALID_SLUG.test(slug)) {
      return c.json({ success: false, error: { message: 'slug must be lowercase letters, numbers and hyphens', code: 'BAD_REQUEST' } }, 400);
    }
    updates.push('slug = ?');
    binds.push(slug);
  }
  if (body.title !== undefined) { updates.push('title = ?'); binds.push(String(body.title).trim()); }
  if (body.content !== undefined) { updates.push('content = ?'); binds.push(String(body.content).substring(0, 50000)); }
  if (body.show_in_footer !== undefined) { updates.push('show_in_footer = ?'); binds.push(body.show_in_footer ? 1 : 0); }
  if (body.enabled !== undefined) { updates.push('enabled = ?'); binds.push(body.enabled ? 1 : 0); }

  if (updates.length === 0) {
    return c.json({ success: false, error: { message: 'No fields to update', code: 'BAD_REQUEST' } }, 400);
  }

  updates.push("updated_at = datetime('now')");
  binds.push(id);
  await c.env.DB.prepare(`UPDATE custom_pages SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true, data: { message: 'Page updated' } });
});

// DELETE /pages/:id — 删除页面(admin)
customPages.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const existing = await c.env.DB.prepare('SELECT id FROM custom_pages WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Page not found', code: 'NOT_FOUND' } }, 404);
  }
  await c.env.DB.prepare('DELETE FROM custom_pages WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Page deleted' } });
});

export default customPages;
