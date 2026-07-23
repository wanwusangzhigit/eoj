import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, problemAdminMiddleware, adminMiddleware } from '../middleware/auth';
import { validateSlug } from '../utils/validator';
import { fetchTestcases, saveTestcases, deleteTestcases } from '../utils/github-testcases';
import { fetchSpjCode, saveSpjCode, deleteSpjCode } from '../utils/github-spj';
import { sendNotification, NotificationType } from '../utils/notify';

const VALID_SPJ_LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c', 'go', 'rust'];

const problems = new Hono<AppType>();

// GET /problems/tags - All unique tags from public problems
problems.get('/tags', async (c) => {
  const results = await c.env.DB.prepare(
    "SELECT tags FROM problems WHERE is_public = 1 AND tags IS NOT NULL AND tags != '[]'"
  ).all();

  const tagSet = new Set<string>();
  for (const row of results.results as any[]) {
    try {
      const parsed = JSON.parse(row.tags || '[]');
      if (Array.isArray(parsed)) {
        parsed.forEach((t: string) => t && tagSet.add(t));
      }
    } catch { /* skip invalid JSON */ }
  }
  const tags = Array.from(tagSet).sort();
  return c.json({ success: true, data: { tags } });
});

problems.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search') || '';
  const tag = c.req.query('tag') || '';
  const difficulty = c.req.query('difficulty') || '';
  const offset = (page - 1) * pageSize;

  let countQuery = 'SELECT COUNT(*) as total FROM problems WHERE is_public = 1';
  let dataQuery = `
    SELECT p.id, p.title, p.slug, p.tags, p.difficulty, p.time_limit, p.memory_limit, p.judge_type, p.created_at,
           COUNT(DISTINCT s.id) as submission_count,
           COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.id END) as accepted_count
    FROM problems p
    LEFT JOIN submissions s ON p.id = s.problem_id
    WHERE p.is_public = 1
  `;
  const binds: any[] = [];

  if (search) {
    countQuery += ' AND (title LIKE ? OR slug LIKE ?)';
    dataQuery += ' AND (p.title LIKE ? OR p.slug LIKE ?)';
    binds.push(`%${search}%`, `%${search}%`);
  }

  if (tag) {
    countQuery += ' AND tags LIKE ?';
    dataQuery += ' AND p.tags LIKE ?';
    binds.push(`%"${tag}"%`);
  }

  if (difficulty) {
    countQuery += ' AND difficulty = ?';
    dataQuery += ' AND p.difficulty = ?';
    binds.push(difficulty);
  }

  dataQuery += ' GROUP BY p.id, p.title, p.slug, p.tags, p.difficulty, p.time_limit, p.memory_limit, p.judge_type, p.created_at';
  dataQuery += ' ORDER BY p.id ASC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery)
    .bind(...binds)
    .first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(dataQuery)
    .bind(...binds, pageSize, offset)
    .all();

  const problemsWithStats = results.results.map((problem: any) => ({
    ...problem,
    submission_count: problem.submission_count || 0,
    accepted_count: problem.accepted_count || 0,
    pass_rate: problem.submission_count > 0 ? Math.round((problem.accepted_count / problem.submission_count) * 100) / 100 : 0
  }));

  return c.json({
    success: true,
    data: {
      problems: problemsWithStats,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
});

// ── Literal-path routes BEFORE /:slug to avoid shadowing ──

// GET /problems/recommend — personalized recommendations for logged-in user
problems.get('/recommend', authMiddleware, async (c) => {
  const user = c.get('user');
  const limit = Math.min(20, Math.max(1, parseInt(c.req.query('limit') || '10')));

  // 1. Fetch the user's solved problem ids and rating
  const solvedRows = await c.env.DB.prepare(
    "SELECT DISTINCT problem_id FROM submissions WHERE user_id = ? AND status = 'accepted'"
  ).bind(user.userId).all();
  const solvedIds = new Set((solvedRows.results as any[]).map((r) => r.problem_id));

  // 2. Get the user's tag profile (count of solved problems per tag)
  const tagRows = await c.env.DB.prepare(
    `SELECT p.tags FROM submissions s
     JOIN problems p ON s.problem_id = p.id
     WHERE s.user_id = ? AND s.status = 'accepted'
     AND p.tags IS NOT NULL AND p.tags != '[]'`
  ).bind(user.userId).all();
  const tagCount = new Map<string, number>();
  for (const row of tagRows.results as any[]) {
    try {
      const parsed = JSON.parse(row.tags || '[]');
      if (Array.isArray(parsed)) {
        parsed.forEach((t: string) => {
          if (t) tagCount.set(t, (tagCount.get(t) || 0) + 1);
        });
      }
    } catch { /* skip invalid JSON */ }
  }
  const topTags = Array.from(tagCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  // 3. Get user's current rating (or 0 if unrated)
  const ratingRow = await c.env.DB.prepare(
    'SELECT rating FROM user_ratings WHERE user_id = ?'
  ).bind(user.userId).first();
  const userRating = (ratingRow as any)?.rating || 0;

  // 4. Get the user's attempted-but-not-solved problems (the most natural "next step")
  const attemptedRows = await c.env.DB.prepare(
    "SELECT DISTINCT problem_id FROM submissions WHERE user_id = ? AND status != 'accepted'"
  ).bind(user.userId).all();
  const attemptedIds = new Set((attemptedRows.results as any[]).map((r) => r.problem_id));

  // 5. Query candidate problems: not solved, public, with rating close to user's
  //    Score each candidate: rating closeness, tag overlap, pass_rate signal
  //    Use a generous limit (200) to avoid loading all problems into memory
  const candidates = await c.env.DB.prepare(
    `SELECT id, title, slug, tags, difficulty, rating
     FROM problems
     WHERE is_public = 1
     ORDER BY rating ASC
     LIMIT 200`
  ).all();

  const recommendations: any[] = [];
  for (const p of candidates.results as any[]) {
    if (solvedIds.has(p.id)) continue;

    let score = 0;
    let reason = '';

    // Rating closeness: prefer problems within ±200 of user's rating
    const pRating = p.rating || 0;
    if (userRating > 0 && pRating > 0) {
      const diff = Math.abs(pRating - userRating);
      if (diff <= 100) {
        score += 50;
        reason = '难度适中';
      } else if (diff <= 200) {
        score += 30;
      } else if (diff <= 400) {
        score += 10;
      } else {
        score -= 20; // too far from user's level
      }
    } else if (pRating > 0) {
      // User has no rating, but problem does; give a small bonus to entry-level problems
      if (pRating <= 1200) score += 15;
    }

    // Tag overlap: prefer problems in user's strong tags
    if (topTags.length > 0 && p.tags) {
      try {
        const tags = JSON.parse(p.tags);
        const overlap = tags.filter((t: string) => topTags.includes(t));
        if (overlap.length > 0) {
          score += overlap.length * 15;
          reason = reason || `擅长方向：${overlap.join(', ')}`;
        }
      } catch { /* ignore */ }
    }

    // Difficulty progression: if user has solved many easy, prefer medium; etc.
    if (userRating === 0 && p.difficulty === 'Easy') {
      score += 10; // brand-new users → easy problems
    }

    // Bonus for problems the user has attempted but not solved (clearly on their radar)
    if (attemptedIds.has(p.id)) {
      score += 20;
      reason = reason || '已尝试但未通过';
    }

    // Small randomization to keep recommendations fresh
    score += Math.random() * 5;

    if (score > 0) {
      recommendations.push({
        id: p.id,
        title: p.title,
        slug: p.slug,
        tags: p.tags,
        difficulty: p.difficulty,
        rating: pRating,
        score: Math.round(score * 10) / 10,
        reason: reason || '基于你的做题记录',
      });
    }
  }

  // Sort by score desc, take top N
  recommendations.sort((a, b) => b.score - a.score);
  const top = recommendations.slice(0, limit);

  return c.json({
    success: true,
    data: {
      recommendations: top,
      user_rating: userRating,
      top_tags: topTags,
    },
  });
});

problems.get('/user/solved', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countQuery = `
    SELECT COUNT(DISTINCT p.id) as total 
    FROM problems p 
    JOIN submissions s ON p.id = s.problem_id 
    WHERE s.user_id = ? AND s.status = 'accepted' AND p.is_public = 1
  `;

  const dataQuery = `
    SELECT DISTINCT p.id, p.title, p.slug, p.tags, p.difficulty, p.time_limit, p.memory_limit, p.judge_type, p.created_at,
           COUNT(DISTINCT s_all.id) as submission_count,
           COUNT(DISTINCT CASE WHEN s_all.status = 'accepted' THEN s_all.id END) as accepted_count
    FROM problems p
    JOIN submissions s ON p.id = s.problem_id AND s.user_id = ? AND s.status = 'accepted'
    LEFT JOIN submissions s_all ON p.id = s_all.problem_id
    WHERE p.is_public = 1
    GROUP BY p.id, p.title, p.slug, p.tags, p.difficulty, p.time_limit, p.memory_limit, p.judge_type, p.created_at
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const countResult = await c.env.DB.prepare(countQuery).bind(user.userId).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(dataQuery).bind(user.userId, pageSize, offset).all();

  const problemsWithStats = results.results.map((problem: any) => ({
    ...problem,
    submission_count: problem.submission_count || 0,
    accepted_count: problem.accepted_count || 0,
    pass_rate: problem.submission_count > 0 ? Math.round((problem.accepted_count / problem.submission_count) * 100) / 100 : 0
  }));

  return c.json({
    success: true,
    data: {
      problems: problemsWithStats,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
});

problems.get('/user/favorites', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countQuery = `
    SELECT COUNT(*) as total 
    FROM favorites f 
    JOIN problems p ON f.problem_id = p.id 
    WHERE f.user_id = ? AND p.is_public = 1
  `;

  const dataQuery = `
    SELECT p.id, p.title, p.slug, p.tags, p.difficulty, p.time_limit, p.memory_limit, p.judge_type, p.created_at, f.created_at as favorited_at,
           COUNT(DISTINCT s.id) as submission_count,
           COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.id END) as accepted_count
    FROM favorites f
    JOIN problems p ON f.problem_id = p.id
    LEFT JOIN submissions s ON p.id = s.problem_id
    WHERE f.user_id = ? AND p.is_public = 1
    GROUP BY p.id, p.title, p.slug, p.tags, p.difficulty, p.time_limit, p.memory_limit, p.judge_type, p.created_at, f.created_at
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const countResult = await c.env.DB.prepare(countQuery).bind(user.userId).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(dataQuery).bind(user.userId, pageSize, offset).all();

  const problemsWithStats = results.results.map((problem: any) => ({
    ...problem,
    submission_count: problem.submission_count || 0,
    accepted_count: problem.accepted_count || 0,
    pass_rate: problem.submission_count > 0 ? Math.round((problem.accepted_count / problem.submission_count) * 100) / 100 : 0
  }));

  return c.json({
    success: true,
    data: {
      problems: problemsWithStats,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
});

// ── Parameterized routes ──

problems.get('/:slug', async (c) => {
  const slug = c.req.param('slug');

  const problem = await c.env.DB.prepare(
    'SELECT * FROM problems WHERE slug = ? AND is_public = 1'
  )
    .bind(slug)
    .first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  const statsResult = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as submission_count,
       COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted_count
     FROM submissions
     WHERE problem_id = ?`
  )
    .bind((problem as any).id)
    .first();

  const stats = statsResult as any;
  const submission_count = stats?.submission_count || 0;
  const accepted_count = stats?.accepted_count || 0;
  const pass_rate = submission_count > 0 ? Math.round((accepted_count / submission_count) * 100) / 100 : 0;

  const allTestcases = await fetchTestcases(c.env, slug);
  const sampleTestcases = allTestcases.filter(tc => tc.is_sample);

  const responseData: any = {
    problem,
    stats: {
      submission_count,
      accepted_count,
      pass_rate
    },
    sampleTestcases,
  };

  // Include SPJ code if judge_type is 'spj'
  if ((problem as any).judge_type === 'spj' && (problem as any).spj_language) {
    const spjCode = await fetchSpjCode(c.env, slug, (problem as any).spj_language);
    responseData.spj_code = spjCode;
  }

  return c.json({
    success: true,
    data: responseData,
  });
});

// ── Language distribution for a problem ──
problems.get('/:slug/languages', async (c) => {
  const slug = c.req.param('slug');
  const problem: any = await c.env.DB.prepare('SELECT id FROM problems WHERE slug = ?').bind(slug).first();
  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }
  const results = await c.env.DB.prepare(
    `SELECT language, COUNT(*) as count FROM submissions WHERE problem_id = ? GROUP BY language ORDER BY count DESC`
  ).bind(problem.id).all();
  return c.json({ success: true, data: { languages: results.results } });
});

// ── Related problems endpoint ──
problems.get('/:slug/related', async (c) => {
  const slug = c.req.param('slug');
  const limit = Math.min(10, Math.max(1, parseInt(c.req.query('limit') || '5')));

  const problem: any = await c.env.DB.prepare(
    'SELECT id, tags FROM problems WHERE slug = ? AND is_public = 1'
  ).bind(slug).first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  let tags: string[] = [];
  try { tags = JSON.parse(problem.tags || '[]'); } catch { tags = []; }

  if (tags.length === 0) {
    return c.json({ success: true, data: { problems: [] } });
  }

  // Find problems with overlapping tags, excluding current problem
  const related = await c.env.DB.prepare(
    `SELECT id, title, slug, difficulty, tags,
            (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id AND status = 'accepted') as accepted_count
     FROM problems
     WHERE is_public = 1 AND id != ? AND (
       ${tags.map(() => "tags LIKE ?").join(' OR ')}
     )
     ORDER BY (
       ${tags.map(() => "CASE WHEN tags LIKE ? THEN 1 ELSE 0 END").join(' + ')}
     ) DESC
     LIMIT ?`
  ).bind(problem.id, ...tags.map(t => `%"${t}"%`), ...tags.map(() => 1), limit).all();

  return c.json({ success: true, data: { problems: related.results } });
});

// ── Problem status endpoint (Bug 3 fix) ──

problems.get('/:id/status', authMiddleware, async (c) => {
  const user = c.get('user');
  const problemId = parseInt(c.req.param('id') || '0');

  const solved = await c.env.DB.prepare(
    "SELECT id FROM submissions WHERE user_id = ? AND problem_id = ? AND status = 'accepted' LIMIT 1"
  )
    .bind(user.userId, problemId)
    .first();

  const attempted = solved ? true : !!(await c.env.DB.prepare(
    "SELECT id FROM submissions WHERE user_id = ? AND problem_id = ? LIMIT 1"
  )
    .bind(user.userId, problemId)
    .first());

  return c.json({
    success: true,
    data: {
      solved: !!solved,
      attempted,
    },
  });
});

problems.post('/', authMiddleware, problemAdminMiddleware, async (c) => {
  const body = await c.req.json();
  const { title, slug, description, input_format, output_format, time_limit, memory_limit, tags, difficulty, is_public, testcases, judge_type, spj_language, spj_code } = body;

  if (!title || !slug || !description) {
    return c.json({ success: false, error: { message: 'title, slug, and description are required', code: 'BAD_REQUEST' } }, 400);
  }

  const slugError = validateSlug(slug);
  if (slugError) {
    return c.json({ success: false, error: { message: slugError, code: 'BAD_REQUEST' } }, 400);
  }

  // Validate SPJ fields
  const effectiveJudgeType = judge_type || 'default';
  if (effectiveJudgeType === 'spj') {
    if (!spj_language || !VALID_SPJ_LANGUAGES.includes(spj_language)) {
      return c.json({ success: false, error: { message: `spj_language is required and must be one of: ${VALID_SPJ_LANGUAGES.join(', ')}`, code: 'BAD_REQUEST' } }, 400);
    }
    if (spj_code && spj_code.length > 65535) {
      return c.json({ success: false, error: { message: 'SPJ code must be at most 65535 characters', code: 'BAD_REQUEST' } }, 400);
    }
  }

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO problems (title, slug, description, input_format, output_format, time_limit, memory_limit, tags, difficulty, is_public, judge_type, spj_language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        title,
        slug,
        description,
        input_format || null,
        output_format || null,
        time_limit || 1000,
        memory_limit || 256,
        JSON.stringify(tags || []),
        difficulty || 'Easy',
        is_public !== undefined ? (is_public ? 1 : 0) : 1,
        effectiveJudgeType,
        effectiveJudgeType === 'spj' ? spj_language : null
      )
      .run();

    // Save testcases to GitHub if provided
    if (testcases && Array.isArray(testcases) && testcases.length > 0) {
      await saveTestcases(c.env, slug, testcases);
    }

    // Save SPJ code to GitHub if provided
    if (effectiveJudgeType === 'spj' && spj_code) {
      await saveSpjCode(c.env, slug, spj_language, spj_code);
    }

    return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Problem created' } }, 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: { message: 'Slug already exists', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to create problem', code: 'INTERNAL_ERROR' } }, 500);
  }
});

problems.put('/:id', authMiddleware, problemAdminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id, slug, judge_type, spj_language FROM problems WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  // Validate SPJ fields if provided
  if (body.judge_type === 'spj') {
    const spjLang = body.spj_language || (existing as any).spj_language;
    if (!spjLang || !VALID_SPJ_LANGUAGES.includes(spjLang)) {
      return c.json({ success: false, error: { message: `spj_language is required and must be one of: ${VALID_SPJ_LANGUAGES.join(', ')}`, code: 'BAD_REQUEST' } }, 400);
    }
  }

  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (['title', 'description', 'input_format', 'output_format', 'time_limit', 'memory_limit', 'difficulty'].includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (key === 'is_public') {
      fields.push('is_public = ?');
      values.push(value ? 1 : 0);
    }
    if (key === 'tags') {
      fields.push('tags = ?');
      values.push(JSON.stringify(value));
    }
    if (key === 'judge_type') {
      fields.push('judge_type = ?');
      values.push(value);
    }
    if (key === 'spj_language') {
      fields.push('spj_language = ?');
      values.push(value || null);
    }
  }

  if (fields.length === 0) {
    return c.json({ success: false, error: { message: 'No fields to update', code: 'BAD_REQUEST' } }, 400);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  await c.env.DB.prepare(`UPDATE problems SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true, data: { message: 'Problem updated' } });
});

problems.delete('/:id', authMiddleware, problemAdminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');

  const existing = await c.env.DB.prepare('SELECT id, slug, judge_type, spj_language FROM problems WHERE id = ?')
    .bind(id)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  // Delete testcases from GitHub
  await deleteTestcases(c.env, (existing as any).slug);
  // Delete SPJ code from GitHub if exists
  if ((existing as any).judge_type === 'spj' && (existing as any).spj_language) {
    await deleteSpjCode(c.env, (existing as any).slug, (existing as any).spj_language);
  }
  // Delete related data from D1
  await c.env.DB.prepare('DELETE FROM submissions WHERE problem_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM favorites WHERE problem_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM problems WHERE id = ?').bind(id).run();

  return c.json({ success: true, data: { message: 'Problem deleted' } });
});

problems.get('/:id/testcases', authMiddleware, problemAdminMiddleware, async (c) => {
  const problemId = parseInt(c.req.param('id') || '0');

  const existing = await c.env.DB.prepare('SELECT id, slug FROM problems WHERE id = ?')
    .bind(problemId)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  const testcases = await fetchTestcases(c.env, (existing as any).slug);

  return c.json({
    success: true,
    data: {
      testcases,
    },
  });
});

problems.delete('/:id/testcases/:index', authMiddleware, problemAdminMiddleware, async (c) => {
  const problemId = parseInt(c.req.param('id') || '0');
  const index = parseInt(c.req.param('index') || '0');

  const existing = await c.env.DB.prepare('SELECT id, slug FROM problems WHERE id = ?')
    .bind(problemId)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  const testcases = await fetchTestcases(c.env, (existing as any).slug);
  if (index < 0 || index >= testcases.length) {
    return c.json({ success: false, error: { message: 'Testcase index out of range', code: 'NOT_FOUND' } }, 404);
  }

  testcases.splice(index, 1);
  const success = await saveTestcases(c.env, (existing as any).slug, testcases);

  if (!success) {
    return c.json({ success: false, error: { message: 'Failed to delete testcase', code: 'INTERNAL_ERROR' } }, 500);
  }

  return c.json({ success: true, data: { message: 'Testcase deleted' } });
});

problems.post('/:id/testcases', authMiddleware, problemAdminMiddleware, async (c) => {
  const problemId = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id, slug, judge_type FROM problems WHERE id = ?')
    .bind(problemId)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  const slug = (existing as any).slug;
  const isSpj = (existing as any).judge_type === 'spj';
  const newTestcases = Array.isArray(body) ? body : [body];

  // Filter out invalid testcases - for SPJ problems, expected_output is optional
  const validTestcases = newTestcases.filter(tc =>
    tc.input && (isSpj || tc.expected_output)
  );
  if (validTestcases.length === 0) {
    return c.json({ success: false, error: { message: 'No valid testcases provided', code: 'BAD_REQUEST' } }, 400);
  }

  // Get existing testcases and append new ones
  const existingTestcases = await fetchTestcases(c.env, slug);
  const allTestcases = [
    ...existingTestcases,
    ...validTestcases.map(tc => ({
      input: tc.input,
      expected_output: tc.expected_output || '',
      is_sample: tc.is_sample || false,
      score: tc.score || 10,
    })),
  ];

  const success = await saveTestcases(c.env, slug, allTestcases);

  if (!success) {
    return c.json({ success: false, error: { message: 'Failed to save testcases', code: 'INTERNAL_ERROR' } }, 500);
  }

  return c.json({ success: true, data: { message: 'Testcases added', count: validTestcases.length } }, 201);
});

// ── SPJ endpoints ──

problems.get('/:id/spj', authMiddleware, problemAdminMiddleware, async (c) => {
  const problemId = parseInt(c.req.param('id') || '0');

  const existing = await c.env.DB.prepare('SELECT id, slug, judge_type, spj_language FROM problems WHERE id = ?')
    .bind(problemId)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((existing as any).judge_type !== 'spj') {
    return c.json({ success: false, error: { message: 'Problem is not a special judge problem', code: 'BAD_REQUEST' } }, 400);
  }

  const spjCode = await fetchSpjCode(c.env, (existing as any).slug, (existing as any).spj_language);

  return c.json({
    success: true,
    data: {
      language: (existing as any).spj_language,
      code: spjCode,
    },
  });
});

problems.put('/:id/spj', authMiddleware, problemAdminMiddleware, async (c) => {
  const problemId = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { language, code } = body;

  const existing = await c.env.DB.prepare('SELECT id, slug, judge_type, spj_language FROM problems WHERE id = ?')
    .bind(problemId)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  if (!language || !VALID_SPJ_LANGUAGES.includes(language)) {
    return c.json({ success: false, error: { message: `language is required and must be one of: ${VALID_SPJ_LANGUAGES.join(', ')}`, code: 'BAD_REQUEST' } }, 400);
  }

  if (!code || typeof code !== 'string') {
    return c.json({ success: false, error: { message: 'code is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (code.length > 65535) {
    return c.json({ success: false, error: { message: 'SPJ code must be at most 65535 characters', code: 'BAD_REQUEST' } }, 400);
  }

  // If language changed, delete old SPJ file first
  if ((existing as any).spj_language && (existing as any).spj_language !== language) {
    await deleteSpjCode(c.env, (existing as any).slug, (existing as any).spj_language);
  }

  // Save new SPJ code
  const success = await saveSpjCode(c.env, (existing as any).slug, language, code);
  if (!success) {
    return c.json({ success: false, error: { message: 'Failed to save SPJ code', code: 'INTERNAL_ERROR' } }, 500);
  }

  // Update spj_language and judge_type in database
  await c.env.DB.prepare(
    'UPDATE problems SET judge_type = ?, spj_language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  )
    .bind('spj', language, problemId)
    .run();

  return c.json({ success: true, data: { message: 'SPJ code saved' } });
});

problems.delete('/:id/spj', authMiddleware, problemAdminMiddleware, async (c) => {
  const problemId = parseInt(c.req.param('id') || '0');

  const existing = await c.env.DB.prepare('SELECT id, slug, judge_type, spj_language FROM problems WHERE id = ?')
    .bind(problemId)
    .first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((existing as any).spj_language) {
    await deleteSpjCode(c.env, (existing as any).slug, (existing as any).spj_language);
  }

  // Reset judge_type to default
  await c.env.DB.prepare(
    'UPDATE problems SET judge_type = ?, spj_language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  )
    .bind('default', null, problemId)
    .run();

  return c.json({ success: true, data: { message: 'SPJ code deleted' } });
});

problems.get('/:id/favorite', authMiddleware, async (c) => {
  const user = c.get('user');
  const problemId = parseInt(c.req.param('id') || '0');

  const favorite = await c.env.DB.prepare(
    'SELECT id FROM favorites WHERE user_id = ? AND problem_id = ?'
  )
    .bind(user.userId, problemId)
    .first();

  return c.json({
    success: true,
    data: {
      is_favorited: !!favorite
    }
  });
});

problems.post('/:id/favorite', authMiddleware, async (c) => {
  const user = c.get('user');
  const problemId = parseInt(c.req.param('id') || '0');

  const problem = await c.env.DB.prepare(
    'SELECT id FROM problems WHERE id = ? AND is_public = 1'
  )
    .bind(problemId)
    .first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO favorites (user_id, problem_id) VALUES (?, ?)'
    )
      .bind(user.userId, problemId)
      .run();

    return c.json({ success: true, data: { message: 'Favorite added' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: { message: 'Already favorited', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to add favorite', code: 'INTERNAL_ERROR' } }, 500);
  }
});

problems.delete('/:id/favorite', authMiddleware, async (c) => {
  const user = c.get('user');
  const problemId = parseInt(c.req.param('id') || '0');

  await c.env.DB.prepare(
    'DELETE FROM favorites WHERE user_id = ? AND problem_id = ?'
  )
    .bind(user.userId, problemId)
    .run();

  return c.json({ success: true, data: { message: 'Favorite removed' } });
});

// === 题目举报/纠错 ===

// POST /problems/:id/reports — 提交举报
problems.post('/:id/reports', authMiddleware, async (c) => {
  const user = c.get('user');
  const problemId = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { type, description } = body;

  if (!type || !description) {
    return c.json({ success: false, error: { message: 'type and description are required', code: 'BAD_REQUEST' } }, 400);
  }

  const validTypes = ['typo', 'wrong_answer', 'ambiguous', 'missing_data', 'other'];
  if (!validTypes.includes(type)) {
    return c.json({ success: false, error: { message: 'Invalid type', code: 'BAD_REQUEST' } }, 400);
  }

  const problem = await c.env.DB.prepare('SELECT id, title FROM problems WHERE id = ?').bind(problemId).first();
  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO problem_reports (problem_id, user_id, type, description) VALUES (?, ?, ?, ?)'
  ).bind(problemId, user.userId, type, description).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Report submitted' } }, 201);
});

// GET /problems/admin/reports — 举报列表（admin）
problems.get('/admin/reports', authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const status = c.req.query('status');
  const offset = (page - 1) * pageSize;

  let where = '1=1';
  const binds: any[] = [];
  if (status) {
    where += ' AND pr.status = ?';
    binds.push(status);
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM problem_reports pr WHERE ${where}`
  ).bind(...binds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT pr.id, pr.problem_id, pr.user_id, pr.type, pr.description, pr.status, pr.admin_reply, pr.created_at, pr.updated_at,
       u.username as reporter_name, p.title as problem_title, p.slug as problem_slug
     FROM problem_reports pr
     JOIN users u ON pr.user_id = u.id
     JOIN problems p ON pr.problem_id = p.id
     WHERE ${where}
     ORDER BY pr.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      reports: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// PUT /problems/admin/reports/:id — 处理举报（admin）
problems.put('/admin/reports/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { status, admin_reply } = body;

  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
    return c.json({ success: false, error: { message: 'Invalid status', code: 'BAD_REQUEST' } }, 400);
  }

  const report = await c.env.DB.prepare('SELECT user_id, problem_id FROM problem_reports WHERE id = ?').bind(id).first();
  if (!report) {
    return c.json({ success: false, error: { message: 'Report not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE problem_reports SET status = ?, admin_reply = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(status, admin_reply || '', id).run();

  // 通知举报者
  await sendNotification(
    c.env.DB,
    (report as any).user_id,
    NotificationType.REPORT,
    '举报处理更新',
    `你的举报 #${id} 已被处理：${status}`,
    `/problems/${(report as any).problem_id}`
  );

  return c.json({ success: true, data: { message: 'Report updated' } });
});

export default problems;
