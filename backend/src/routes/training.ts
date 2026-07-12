import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const training = new Hono<AppType>();

// GET /training — 训练计划列表（分页 + category/difficulty 筛选）
training.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search');
  const category = c.req.query('category');
  const difficulty = c.req.query('difficulty');
  const officialOnly = c.req.query('official') === '1';
  const offset = (page - 1) * pageSize;

  let query = 'SELECT tp.*, u.username FROM training_plans tp JOIN users u ON tp.user_id = u.id WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as total FROM training_plans WHERE 1=1';
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (search) {
    query += ' AND tp.title LIKE ?';
    countQuery += ' AND title LIKE ?';
    binds.push(`%${search}%`);
    countBinds.push(`%${search}%`);
  }
  if (category) {
    query += ' AND tp.category = ?';
    countQuery += ' AND category = ?';
    binds.push(category);
    countBinds.push(category);
  }
  if (difficulty) {
    query += ' AND tp.difficulty = ?';
    countQuery += ' AND difficulty = ?';
    binds.push(difficulty);
    countBinds.push(difficulty);
  }
  if (officialOnly) {
    query += ' AND tp.is_official = 1';
    countQuery += ' AND is_official = 1';
  }

  query += ' ORDER BY tp.is_official DESC, tp.sort_order ASC, tp.id DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  // 附带章节/题目数和当前用户进度（批量查询消除 N+1）
  const user = c.get('user');
  const plans = results.results as any[];
  const planIds = plans.map((p: any) => p.id);

  // 批量查询章节数
  const chapterCountMap = new Map<number, number>();
  if (planIds.length > 0) {
    const placeholders = planIds.map(() => '?').join(',');
    const chapterRows = await c.env.DB.prepare(
      `SELECT plan_id, COUNT(*) as cnt FROM training_chapters WHERE plan_id IN (${placeholders}) GROUP BY plan_id`
    ).bind(...planIds).all();
    for (const row of chapterRows.results as any[]) {
      chapterCountMap.set(row.plan_id, row.cnt);
    }
  }

  // 批量查询题目数
  const problemCountMap = new Map<number, number>();
  if (planIds.length > 0) {
    const placeholders = planIds.map(() => '?').join(',');
    const problemRows = await c.env.DB.prepare(
      `SELECT tc.plan_id, COUNT(*) as cnt FROM training_chapter_problems tcp
       JOIN training_chapters tc ON tcp.chapter_id = tc.id
       WHERE tc.plan_id IN (${placeholders})
       GROUP BY tc.plan_id`
    ).bind(...planIds).all();
    for (const row of problemRows.results as any[]) {
      problemCountMap.set(row.plan_id, row.cnt);
    }
  }

  // 批量查询用户进度
  const progressMap = new Map<number, any>();
  if (user && planIds.length > 0) {
    const placeholders = planIds.map(() => '?').join(',');
    const progressRows = await c.env.DB.prepare(
      `SELECT plan_id, completed, total FROM training_progress WHERE user_id = ? AND plan_id IN (${placeholders})`
    ).bind(user.userId, ...planIds).all();
    for (const row of progressRows.results as any[]) {
      progressMap.set(row.plan_id, row);
    }
  }

  const plansWithExtra = plans.map((plan: any) => ({
    ...plan,
    chapter_count: chapterCountMap.get(plan.id) || 0,
    problem_count: problemCountMap.get(plan.id) || 0,
    progress: progressMap.get(plan.id) || null,
  }));

  return c.json({
    success: true,
    data: {
      plans: plansWithExtra,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /training/:id — 训练计划详情（含章节、题目，已登录则返回是否已解决标识）
training.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const user = c.get('user');

  const plan = await c.env.DB.prepare(
    'SELECT tp.*, u.username FROM training_plans tp JOIN users u ON tp.user_id = u.id WHERE tp.id = ?'
  ).bind(id).first();

  if (!plan) {
    return c.json({ success: false, error: { message: 'Training plan not found', code: 'NOT_FOUND' } }, 404);
  }

  const chapters = await c.env.DB.prepare(
    'SELECT id, plan_id, title, description, sort_order FROM training_chapters WHERE plan_id = ? ORDER BY sort_order ASC, id ASC'
  ).bind(id).all();

  // 拉取每个章节的题目，并附带当前用户是否 AC
  const chaptersWithProblems = await Promise.all(
    chapters.results.map(async (chapter: any) => {
      let problemQuery = `
        SELECT tcp.id as relation_id, tcp.chapter_id, tcp.sort_order, tcp.note,
               p.id as problem_id, p.title, p.slug, p.difficulty, p.rating, p.tags
      `;
      let problemBinds: any[] = [chapter.id];

      if (user) {
        problemQuery += `,
          CASE WHEN EXISTS (
            SELECT 1 FROM submissions s
            WHERE s.problem_id = p.id AND s.user_id = ? AND s.status = 'accepted'
          ) THEN 1 ELSE 0 END as solved,
          CASE WHEN EXISTS (
            SELECT 1 FROM submissions s
            WHERE s.problem_id = p.id AND s.user_id = ?
          ) THEN 1 ELSE 0 END as attempted
        `;
        problemBinds = [user.userId, chapter.id, user.userId];
      } else {
        problemQuery += `, 0 as solved, 0 as attempted`;
      }

      problemQuery += `
        FROM training_chapter_problems tcp
        JOIN problems p ON tcp.problem_id = p.id
        WHERE tcp.chapter_id = ?
        ORDER BY tcp.sort_order ASC, tcp.id ASC
      `;

      const problems = await c.env.DB.prepare(problemQuery).bind(...problemBinds).all();
      return { ...chapter, problems: problems.results };
    })
  );

  return c.json({
    success: true,
    data: {
      plan: { ...plan, chapters: chaptersWithProblems },
    },
  });
});

// POST /training — 创建训练计划
training.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { title, description, cover_image, category, difficulty, is_official, sort_order } = body;

  if (!title || title.length > 200) {
    return c.json({ success: false, error: { message: 'title is required and must be at most 200 chars', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO training_plans (title, description, cover_image, category, difficulty, user_id, is_official, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      title,
      description || '',
      cover_image || '',
      category || 'algorithm',
      difficulty || 'beginner',
      user.userId,
      is_official ? 1 : 0,
      sort_order || 0
    )
    .run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Training plan created' } }, 201);
});

// PUT /training/:id — 编辑训练计划（owner 或 admin）
training.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const plan = await c.env.DB.prepare('SELECT user_id FROM training_plans WHERE id = ?').bind(id).first();

  if (!plan) {
    return c.json({ success: false, error: { message: 'Training plan not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((plan as any).user_id !== user.userId && user.role !== 'admin' && user.role !== 'super_admin' && user.userId !== 1) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const body = await c.req.json();
  const { title, description, cover_image, category, difficulty, is_official, sort_order } = body;

  await c.env.DB.prepare(
    `UPDATE training_plans
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         cover_image = COALESCE(?, cover_image),
         category = COALESCE(?, category),
         difficulty = COALESCE(?, difficulty),
         is_official = COALESCE(?, is_official),
         sort_order = COALESCE(?, sort_order),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(title ?? null, description ?? null, cover_image ?? null, category ?? null, difficulty ?? null, is_official ?? null, sort_order ?? null, id)
    .run();

  return c.json({ success: true, data: { message: 'Training plan updated' } });
});

// DELETE /training/:id — 删除训练计划（owner 或 admin）
training.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const plan = await c.env.DB.prepare('SELECT user_id FROM training_plans WHERE id = ?').bind(id).first();

  if (!plan) {
    return c.json({ success: false, error: { message: 'Training plan not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((plan as any).user_id !== user.userId && user.role !== 'admin' && user.role !== 'super_admin' && user.userId !== 1) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM training_plans WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Training plan deleted' } });
});

// GET /training/:id/progress — 当前用户进度（自动统计实际 AC 数）
training.get('/:id/progress', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  // 计算计划题目总数
  const totalResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM training_chapter_problems tcp
     JOIN training_chapters tc ON tcp.chapter_id = tc.id
     WHERE tc.plan_id = ?`
  ).bind(id).first();
  const total = (totalResult as any)?.total || 0;

  // 计算当前用户已 AC 的题目数
  const completedResult = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT tcp.problem_id) as completed
     FROM training_chapter_problems tcp
     JOIN training_chapters tc ON tcp.chapter_id = tc.id
     JOIN submissions s ON s.problem_id = tcp.problem_id
     WHERE tc.plan_id = ? AND s.user_id = ? AND s.status = 'accepted'`
  ).bind(id, user.userId).first();
  const completed = (completedResult as any)?.completed || 0;

  // upsert training_progress
  await c.env.DB.prepare(
    `INSERT INTO training_progress (user_id, plan_id, completed, total, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, plan_id) DO UPDATE SET
       completed = excluded.completed,
       total = excluded.total,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(user.userId, id, completed, total).run();

  return c.json({
    success: true,
    data: { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) },
  });
});

// POST /training/:id/join — 加入训练（创建 progress 占位）
training.post('/:id/join', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  const plan = await c.env.DB.prepare('SELECT id FROM training_plans WHERE id = ?').bind(id).first();
  if (!plan) {
    return c.json({ success: false, error: { message: 'Training plan not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    `INSERT INTO training_progress (user_id, plan_id, completed, total, updated_at)
     VALUES (?, ?, 0, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, plan_id) DO NOTHING`
  ).bind(user.userId, id).run();

  return c.json({ success: true, data: { message: 'Joined training plan' } });
});

// POST /training/:id/chapters — 新增章节（admin）
training.post('/:id/chapters', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const plan = await c.env.DB.prepare('SELECT id FROM training_plans WHERE id = ?').bind(id).first();
  if (!plan) {
    return c.json({ success: false, error: { message: 'Training plan not found', code: 'NOT_FOUND' } }, 404);
  }

  const body = await c.req.json();
  const { title, description, sort_order } = body;

  if (!title) {
    return c.json({ success: false, error: { message: 'title is required', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO training_chapters (plan_id, title, description, sort_order) VALUES (?, ?, ?, ?)'
  ).bind(id, title, description || '', sort_order || 0).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Chapter created' } }, 201);
});

// PUT /training/chapters/:id — 编辑章节（admin）
training.put('/chapters/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { title, description, sort_order } = body;

  await c.env.DB.prepare(
    `UPDATE training_chapters
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         sort_order = COALESCE(?, sort_order)
     WHERE id = ?`
  ).bind(title ?? null, description ?? null, sort_order ?? null, id).run();

  return c.json({ success: true, data: { message: 'Chapter updated' } });
});

// DELETE /training/chapters/:id — 删除章节（admin）
training.delete('/chapters/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  await c.env.DB.prepare('DELETE FROM training_chapters WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Chapter deleted' } });
});

// POST /training/chapters/:id/problems — 添加章节题目（admin）
training.post('/chapters/:id/problems', authMiddleware, adminMiddleware, async (c) => {
  const chapterId = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { problem_id, note, sort_order } = body;

  if (!problem_id) {
    return c.json({ success: false, error: { message: 'problem_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO training_chapter_problems (chapter_id, problem_id, note, sort_order) VALUES (?, ?, ?, ?)'
    ).bind(chapterId, problem_id, note || '', sort_order || 0).run();
    return c.json({ success: true, data: { message: 'Problem added to chapter' } }, 201);
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return c.json({ success: false, error: { message: 'Problem already in this chapter', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to add problem', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// DELETE /training/chapters/:id/problems/:problemId — 从章节移除题目（admin）
training.delete('/chapters/:id/problems/:problemId', authMiddleware, adminMiddleware, async (c) => {
  const chapterId = parseInt(c.req.param('id') || '0');
  const problemId = parseInt(c.req.param('problemId') || '0');
  await c.env.DB.prepare(
    'DELETE FROM training_chapter_problems WHERE chapter_id = ? AND problem_id = ?'
  ).bind(chapterId, problemId).run();
  return c.json({ success: true, data: { message: 'Problem removed from chapter' } });
});

export default training;
