import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';

const collections = new Hono<AppType>();

// GET /collections — 获取当前用户的所有收藏集合
collections.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const results = await c.env.DB.prepare(
    `SELECT pc.*,
       (SELECT COUNT(*) FROM problem_collection_items pci WHERE pci.collection_id = pc.id) as problem_count
     FROM problem_collections pc
     WHERE pc.user_id = ?
     ORDER BY pc.sort_order ASC, pc.created_at DESC`
  ).bind(user.userId).all();

  return c.json({ success: true, data: { collections: results.results } });
});

// POST /collections — 创建收藏集合
collections.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { name, description, is_public } = body;

  if (!name || name.trim().length === 0) {
    return c.json({ success: false, error: { message: 'name is required', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO problem_collections (user_id, name, description, is_public) VALUES (?, ?, ?, ?)'
  ).bind(user.userId, name.trim(), description || '', is_public ? 1 : 0).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Collection created' } }, 201);
});

// PUT /collections/:id — 编辑收藏集合
collections.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { name, description, is_public, sort_order } = body;

  const col = await c.env.DB.prepare('SELECT id FROM problem_collections WHERE id = ? AND user_id = ?').bind(id, user.userId).first();
  if (!col) {
    return c.json({ success: false, error: { message: 'Collection not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE problem_collections SET name = COALESCE(?, name), description = COALESCE(?, description), is_public = COALESCE(?, is_public), sort_order = COALESCE(?, sort_order), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(name ?? null, description ?? null, is_public !== undefined ? (is_public ? 1 : 0) : null, sort_order ?? null, id).run();

  return c.json({ success: true, data: { message: 'Collection updated' } });
});

// DELETE /collections/:id — 删除收藏集合
collections.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  const col = await c.env.DB.prepare('SELECT id FROM problem_collections WHERE id = ? AND user_id = ?').bind(id, user.userId).first();
  if (!col) {
    return c.json({ success: false, error: { message: 'Collection not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare('DELETE FROM problem_collections WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Collection deleted' } });
});

// GET /collections/:id/items — 获取集合中的题目
collections.get('/:id/items', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const col: any = await c.env.DB.prepare('SELECT id, user_id, is_public FROM problem_collections WHERE id = ?').bind(id).first();

  if (!col) {
    return c.json({ success: false, error: { message: 'Collection not found', code: 'NOT_FOUND' } }, 404);
  }

  const items = await c.env.DB.prepare(
    `SELECT pci.id, pci.problem_id, pci.note, pci.sort_order, pci.created_at,
       p.title, p.slug, p.difficulty, p.tags
     FROM problem_collection_items pci
     JOIN problems p ON pci.problem_id = p.id
     WHERE pci.collection_id = ?
     ORDER BY pci.sort_order ASC, pci.id ASC`
  ).bind(id).all();

  return c.json({ success: true, data: { collection: col, items: items.results } });
});

// POST /collections/:id/items — 添加题目到集合
collections.post('/:id/items', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { problem_id, note } = body;

  if (!problem_id) {
    return c.json({ success: false, error: { message: 'problem_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  const col = await c.env.DB.prepare('SELECT id FROM problem_collections WHERE id = ? AND user_id = ?').bind(id, user.userId).first();
  if (!col) {
    return c.json({ success: false, error: { message: 'Collection not found', code: 'NOT_FOUND' } }, 404);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO problem_collection_items (collection_id, problem_id, note) VALUES (?, ?, ?)'
    ).bind(id, problem_id, note || '').run();
    return c.json({ success: true, data: { message: 'Problem added to collection' } }, 201);
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return c.json({ success: false, error: { message: 'Problem already in this collection', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to add problem', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// DELETE /collections/:id/items/:itemId — 从集合移除题目
collections.delete('/:id/items/:itemId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const itemId = parseInt(c.req.param('itemId') || '0');

  const col = await c.env.DB.prepare('SELECT id FROM problem_collections WHERE id = ? AND user_id = ?').bind(id, user.userId).first();
  if (!col) {
    return c.json({ success: false, error: { message: 'Collection not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare('DELETE FROM problem_collection_items WHERE id = ? AND collection_id = ?').bind(itemId, id).run();
  return c.json({ success: true, data: { message: 'Problem removed from collection' } });
});

export default collections;