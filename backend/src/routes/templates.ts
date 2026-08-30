import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';

const templates = new Hono<AppType>();

// GET /templates — 获取当前用户的所有代码模板
templates.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const results = await c.env.DB.prepare(
    'SELECT id, language, name, content, created_at, updated_at FROM code_templates WHERE user_id = ? ORDER BY language, name'
  ).bind(user.userId).all();

  return c.json({ success: true, data: { templates: results.results } });
});

// GET /templates/:language — 获取指定语言的模板
templates.get('/:language', authMiddleware, async (c) => {
  const user = c.get('user');
  const language = c.req.param('language');

  const template = await c.env.DB.prepare(
    'SELECT id, language, name, content, created_at, updated_at FROM code_templates WHERE user_id = ? AND language = ? LIMIT 1'
  ).bind(user.userId, language).first();

  return c.json({ success: true, data: { template: template || null } });
});

// PUT /templates/:language — 保存/更新模板
templates.put('/:language', authMiddleware, async (c) => {
  const user = c.get('user');
  const language = c.req.param('language');
  const body = await c.req.json();
  const { content, name } = body;

  if (!content) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }
  if (content.length > 100000) {
    return c.json({ success: false, error: { message: 'Template too long', code: 'BAD_REQUEST' } }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM code_templates WHERE user_id = ? AND language = ?'
  ).bind(user.userId, language).first();

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE code_templates SET content = ?, name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND language = ?'
    ).bind(content, name || '', user.userId, language).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO code_templates (user_id, language, content, name) VALUES (?, ?, ?, ?)'
    ).bind(user.userId, language, content, name || '').run();
  }

  return c.json({ success: true, data: { message: 'Template saved' } });
});

// DELETE /templates/:language — 删除模板
templates.delete('/:language', authMiddleware, async (c) => {
  const user = c.get('user');
  const language = c.req.param('language');

  await c.env.DB.prepare(
    'DELETE FROM code_templates WHERE user_id = ? AND language = ?'
  ).bind(user.userId, language).run();

  return c.json({ success: true, data: { message: 'Template deleted' } });
});

export default templates;