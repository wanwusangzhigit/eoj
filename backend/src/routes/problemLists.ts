import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware, listAdminMiddleware } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { escapeLikeWildcard } from '../utils/helpers';

const problemLists = new Hono<AppType>();

const problemListCreateLimiter = createRateLimiter('problemlist_create', 10, 60_000);

// List public problem lists
problemLists.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search');
  const offset = (page - 1) * pageSize;

  let query = 'SELECT pl.*, u.username FROM problem_lists pl JOIN users u ON pl.user_id = u.id WHERE pl.is_public = 1';
  let countQuery = 'SELECT COUNT(*) as total FROM problem_lists WHERE is_public = 1';
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (search) {
    query += " AND pl.title LIKE ? ESCAPE '\\'";
    countQuery += " AND title LIKE ? ESCAPE '\\'";
    binds.push(`%${escapeLikeWildcard(search)}%`);
    countBinds.push(`%${escapeLikeWildcard(search)}%`);
  }

  query += ' ORDER BY pl.created_at DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  // Add problem count for each list (batch query)
  const lists = results.results as any[];
  const listIds = lists.map((l: any) => l.id);
  const problemCountMap = new Map<number, number>();
  if (listIds.length > 0) {
    const placeholders = listIds.map(() => '?').join(',');
    const countRows = await c.env.DB.prepare(
      `SELECT list_id, COUNT(*) as cnt FROM problem_list_items WHERE list_id IN (${placeholders}) GROUP BY list_id`
    ).bind(...listIds).all();
    for (const row of countRows.results as any[]) {
      problemCountMap.set(row.list_id, row.cnt);
    }
  }
  const listsWithCount = lists.map((list: any) => ({
    ...list,
    problem_count: problemCountMap.get(list.id) || 0,
  }));

  return c.json({
    success: true,
    data: {
      lists: listsWithCount,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// Get problem list detail
problemLists.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));

  const list = await c.env.DB.prepare(
    'SELECT pl.*, u.username FROM problem_lists pl JOIN users u ON pl.user_id = u.id WHERE pl.id = ?'
  ).bind(id).first();

  if (!list) {
    return c.json({ success: false, error: { message: 'Problem list not found', code: 'NOT_FOUND' } }, 404);
  }

  const items = await c.env.DB.prepare(
    `SELECT pli.id, pli.sort_order, pli.note, p.id as problem_id, p.title, p.slug, p.difficulty, p.tags
     FROM problem_list_items pli JOIN problems p ON pli.problem_id = p.id
     WHERE pli.list_id = ? ORDER BY pli.sort_order, pli.id`
  ).bind(id).all();

  // 题单进度追踪:若当前请求带有效 token,标记每题是否已 AC
  const itemList = items.results as any[];
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ') && itemList.length > 0) {
    const { verifyJWT } = await import('../utils/jwt');
    const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET, (c.env as any).JWT_SECRET_PREVIOUS);
    if (payload) {
      const problemIds = itemList.map((it) => it.problem_id);
      const placeholders = problemIds.map(() => '?').join(',');
      const solvedRows = await c.env.DB.prepare(
        `SELECT DISTINCT problem_id FROM submissions
         WHERE user_id = ? AND status = 'accepted' AND problem_id IN (${placeholders})`
      ).bind(payload.userId, ...problemIds).all();
      const solvedIds = new Set((solvedRows.results as any[]).map((r) => r.problem_id));
      for (const it of itemList) {
        it.solved = solvedIds.has(it.problem_id) ? 1 : 0;
      }
    }
  }

  return c.json({ success: true, data: { list, items: itemList } });
});

// Create problem list
problemLists.post('/', authMiddleware, problemListCreateLimiter, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { title, description, is_public, problems } = body;

  if (!title) {
    return c.json({ success: false, error: { message: 'title is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }

  if (description && description.length > 5000) {
    return c.json({ success: false, error: { message: 'description must be at most 5000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO problem_lists (title, description, user_id, is_public) VALUES (?, ?, ?, ?)'
  ).bind(title, description || '', user.userId, is_public ?? 1).run();

  const listId = result.meta.last_row_id;

  // Add problems
  if (problems && Array.isArray(problems)) {
    for (let i = 0; i < problems.length; i++) {
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO problem_list_items (list_id, problem_id, sort_order, note) VALUES (?, ?, ?, ?)'
      ).bind(listId, problems[i].problem_id, i, problems[i].note || '').run();
    }
  }

  return c.json({ success: true, data: { id: listId, message: 'Problem list created' } }, 201);
});

// POST /lists/:id/clone — 克隆题单到自己的题单(可克隆公开或自己的题单)
problemLists.post('/:id/clone', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const source: any = await c.env.DB.prepare('SELECT * FROM problem_lists WHERE id = ?').bind(id).first();
  if (!source) {
    return c.json({ success: false, error: { message: 'Problem list not found', code: 'NOT_FOUND' } }, 404);
  }

  // 仅允许克隆公开题单或自己的题单
  const isOwner = source.user_id === user.userId;
  const hasListAdmin = (user.permissions || []).includes('list_admin') || user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;
  if (source.is_public !== 1 && !isOwner && !hasListAdmin) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const newTitle = `${source.title}（副本）`;
  const result = await c.env.DB.prepare(
    'INSERT INTO problem_lists (title, description, user_id, is_public) VALUES (?, ?, ?, ?)'
  ).bind(newTitle, source.description || '', user.userId, 1).run();
  const newId = result.meta.last_row_id;

  // 复制题目项
  const items = await c.env.DB.prepare(
    'SELECT problem_id, sort_order, note FROM problem_list_items WHERE list_id = ? ORDER BY sort_order'
  ).bind(id).all();
  if (items.results.length > 0) {
    const stmts = (items.results as any[]).map((it) =>
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO problem_list_items (list_id, problem_id, sort_order, note) VALUES (?, ?, ?, ?)'
      ).bind(newId, it.problem_id, it.sort_order, it.note || '')
    );
    await c.env.DB.batch(stmts);
  }

  return c.json({ success: true, data: { id: newId, title: newTitle, message: 'Problem list cloned' } }, 201);
});

// Update problem list
problemLists.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);
  const body = await c.req.json();
  const { title, description, is_public, problems } = body;

  const list = await c.env.DB.prepare('SELECT * FROM problem_lists WHERE id = ?').bind(id).first();
  if (!list) {
    return c.json({ success: false, error: { message: 'Problem list not found', code: 'NOT_FOUND' } }, 404);
  }

  // Only creator or admin or list_admin can update
  const isOwner = (list as any).user_id === user.userId;
  const hasListAdmin = (user.permissions || []).includes('list_admin') || user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;
  if (!isOwner && !hasListAdmin) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const updates: string[] = [];
  const binds: any[] = [];

  if (title !== undefined) { updates.push('title = ?'); binds.push(title); }
  if (description !== undefined) { updates.push('description = ?'); binds.push(description); }
  if (is_public !== undefined) { updates.push('is_public = ?'); binds.push(is_public); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    binds.push(id);
    await c.env.DB.prepare(`UPDATE problem_lists SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  }

  // Replace problems if provided
  if (problems && Array.isArray(problems)) {
    await c.env.DB.prepare('DELETE FROM problem_list_items WHERE list_id = ?').bind(id).run();
    for (let i = 0; i < problems.length; i++) {
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO problem_list_items (list_id, problem_id, sort_order, note) VALUES (?, ?, ?, ?)'
      ).bind(id, problems[i].problem_id, i, problems[i].note || '').run();
    }
  }

  return c.json({ success: true, data: { message: 'Problem list updated' } });
});

// Delete problem list
problemLists.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const list = await c.env.DB.prepare('SELECT * FROM problem_lists WHERE id = ?').bind(id).first();
  if (!list) {
    return c.json({ success: false, error: { message: 'Problem list not found', code: 'NOT_FOUND' } }, 404);
  }

  const isOwner = (list as any).user_id === user.userId;
  const hasListAdmin = (user.permissions || []).includes('list_admin') || user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;
  if (!isOwner && !hasListAdmin) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM problem_lists WHERE id = ?').bind(id).run();

  return c.json({ success: true, data: { message: 'Problem list deleted' } });
});

export default problemLists;
