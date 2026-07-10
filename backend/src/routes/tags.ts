import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const tags = new Hono<AppType>();

// GET /tags/categories — 获取所有标签分类及子标签（公开）
tags.get('/categories', async (c) => {
  const categories = await c.env.DB.prepare(
    'SELECT id, name, slug, icon, sort_order FROM tag_categories ORDER BY sort_order ASC, id ASC'
  ).all();

  const categoryIds = categories.results.map((cat: any) => cat.id);
  let allTags: any[] = [];

  if (categoryIds.length > 0) {
    const placeholders = categoryIds.map(() => '?').join(',');
    allTags = (await c.env.DB.prepare(
      `SELECT id, category_id, name, slug, sort_order FROM tags WHERE category_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`
    ).bind(...categoryIds).all()).results as any[];
  }

  const result = categories.results.map((cat: any) => ({
    ...cat,
    tags: allTags.filter((t: any) => t.category_id === cat.id),
  }));

  return c.json({ success: true, data: { categories: result } });
});

// GET /problems/tags-tree — 获取标签树（带每个标签下的题目数）
tags.get('/problems/tags-tree', async (c) => {
  const categories = await c.env.DB.prepare(
    'SELECT id, name, slug, icon, sort_order FROM tag_categories ORDER BY sort_order ASC, id ASC'
  ).all();

  const categoryIds = categories.results.map((cat: any) => cat.id);
  let allTags: any[] = [];

  if (categoryIds.length > 0) {
    const placeholders = categoryIds.map(() => '?').join(',');
    allTags = (await c.env.DB.prepare(
      `SELECT t.id, t.category_id, t.name, t.slug, t.sort_order, COUNT(pt.problem_id) as problem_count
       FROM tags t
       LEFT JOIN problem_tags pt ON t.id = pt.tag_id
       WHERE t.category_id IN (${placeholders})
       GROUP BY t.id, t.category_id, t.name, t.slug, t.sort_order
       ORDER BY t.sort_order ASC, t.id ASC`
    ).bind(...categoryIds).all()).results as any[];
  }

  const result = categories.results.map((cat: any) => ({
    ...cat,
    tags: allTags.filter((t: any) => t.category_id === cat.id).map((t: any) => ({
      ...t,
      problem_count: t.problem_count || 0,
    })),
  }));

  return c.json({ success: true, data: { categories: result } });
});

// POST /tags/categories — 创建标签分类（需 adminMiddleware）
tags.post('/categories', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json();
  const { name, slug, icon, sort_order } = body;

  if (!name || !slug) {
    return c.json({ success: false, error: { message: 'name and slug are required', code: 'BAD_REQUEST' } }, 400);
  }

  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO tag_categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)'
    )
      .bind(name, slug, icon || null, sort_order || 0)
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Category created' } }, 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: { message: 'Slug already exists', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to create category', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// POST /tags — 创建标签（需 adminMiddleware）
tags.post('/', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json();
  const { category_id, name, slug, sort_order } = body;

  if (!category_id || !name || !slug) {
    return c.json({ success: false, error: { message: 'category_id, name, and slug are required', code: 'BAD_REQUEST' } }, 400);
  }

  const category = await c.env.DB.prepare('SELECT id FROM tag_categories WHERE id = ?')
    .bind(category_id)
    .first();
  if (!category) {
    return c.json({ success: false, error: { message: 'Category not found', code: 'NOT_FOUND' } }, 404);
  }

  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO tags (category_id, name, slug, sort_order) VALUES (?, ?, ?, ?)'
    )
      .bind(category_id, name, slug, sort_order || 0)
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Tag created' } }, 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: { message: 'Slug already exists', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to create tag', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// PUT /tags/categories/:id — 更新标签分类（需 adminMiddleware）
tags.put('/categories/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id FROM tag_categories WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Category not found', code: 'NOT_FOUND' } }, 404);
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.slug !== undefined) { fields.push('slug = ?'); values.push(body.slug); }
  if (body.icon !== undefined) { fields.push('icon = ?'); values.push(body.icon); }
  if (body.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(body.sort_order); }

  if (fields.length === 0) {
    return c.json({ success: false, error: { message: 'No fields to update', code: 'BAD_REQUEST' } }, 400);
  }

  values.push(id);
  await c.env.DB.prepare(`UPDATE tag_categories SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true, data: { message: 'Category updated' } });
});

// PUT /tags/:id — 更新标签（需 adminMiddleware）
tags.put('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id FROM tags WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Tag not found', code: 'NOT_FOUND' } }, 404);
  }

  if (body.category_id !== undefined) {
    const category = await c.env.DB.prepare('SELECT id FROM tag_categories WHERE id = ?')
      .bind(body.category_id)
      .first();
    if (!category) {
      return c.json({ success: false, error: { message: 'Category not found', code: 'NOT_FOUND' } }, 404);
    }
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (body.category_id !== undefined) { fields.push('category_id = ?'); values.push(body.category_id); }
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.slug !== undefined) { fields.push('slug = ?'); values.push(body.slug); }
  if (body.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(body.sort_order); }

  if (fields.length === 0) {
    return c.json({ success: false, error: { message: 'No fields to update', code: 'BAD_REQUEST' } }, 400);
  }

  values.push(id);
  await c.env.DB.prepare(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true, data: { message: 'Tag updated' } });
});

// DELETE /tags/categories/:id — 删除标签分类（需 adminMiddleware）
tags.delete('/categories/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');

  const existing = await c.env.DB.prepare('SELECT id FROM tag_categories WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Category not found', code: 'NOT_FOUND' } }, 404);
  }

  // Delete associated tags and their problem_tags references
  const tagIds = (await c.env.DB.prepare('SELECT id FROM tags WHERE category_id = ?').bind(id).all()).results as any[];
  if (tagIds.length > 0) {
    const placeholders = tagIds.map(() => '?').join(',');
    const ids = tagIds.map((t: any) => t.id);
    await c.env.DB.prepare(`DELETE FROM problem_tags WHERE tag_id IN (${placeholders})`).bind(...ids).run();
    await c.env.DB.prepare(`DELETE FROM tags WHERE category_id = ?`).bind(id).run();
  }

  await c.env.DB.prepare('DELETE FROM tag_categories WHERE id = ?').bind(id).run();

  return c.json({ success: true, data: { message: 'Category deleted' } });
});

// DELETE /tags/:id — 删除标签（需 adminMiddleware）
tags.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');

  const existing = await c.env.DB.prepare('SELECT id FROM tags WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Tag not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare('DELETE FROM problem_tags WHERE tag_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();

  return c.json({ success: true, data: { message: 'Tag deleted' } });
});

// POST /problems/:id/tags — 设置题目标签（需 adminMiddleware，替换式）
tags.post('/problems/:id/tags', authMiddleware, adminMiddleware, async (c) => {
  const problemId = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { tag_ids } = body;

  if (!Array.isArray(tag_ids)) {
    return c.json({ success: false, error: { message: 'tag_ids must be an array', code: 'BAD_REQUEST' } }, 400);
  }

  const problem = await c.env.DB.prepare('SELECT id FROM problems WHERE id = ?')
    .bind(problemId)
    .first();
  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  // Delete existing tags
  await c.env.DB.prepare('DELETE FROM problem_tags WHERE problem_id = ?').bind(problemId).run();

  // Insert new tags
  for (const tagId of tag_ids) {
    await c.env.DB.prepare('INSERT INTO problem_tags (problem_id, tag_id) VALUES (?, ?)')
      .bind(problemId, tagId)
      .run();
  }

  return c.json({ success: true, data: { message: 'Problem tags updated' } });
});

// GET /problems/:id/tags — 获取题目标签（公开）
tags.get('/problems/:id/tags', async (c) => {
  const problemId = parseInt(c.req.param('id') || '0');

  const results = await c.env.DB.prepare(
    `SELECT t.id, t.category_id, t.name, t.slug, t.sort_order, tc.name as category_name
     FROM tags t
     JOIN problem_tags pt ON t.id = pt.tag_id
     LEFT JOIN tag_categories tc ON t.category_id = tc.id
     WHERE pt.problem_id = ?
     ORDER BY t.sort_order ASC, t.id ASC`
  )
    .bind(problemId)
    .all();

  return c.json({ success: true, data: { tags: results.results } });
});

export default tags;
