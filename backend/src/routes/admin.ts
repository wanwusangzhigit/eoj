import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware, superAdminMiddleware, problemAdminMiddleware, contestAdminMiddleware, ticketAdminMiddleware, listAdminMiddleware } from '../middleware/auth';
import { fetchTestcases } from '../utils/github-testcases';

const admin = new Hono<AppType>();

// GET /stats - Admin dashboard stats
admin.get('/stats', authMiddleware, adminMiddleware, async (c) => {
  const [
    userCount, problemCount, submissionCount, todaySubmissions,
    acceptedCount, contestCount, listCount, ticketCount, openTicketCount,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM problems').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM submissions').first(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM submissions WHERE date(created_at) = date('now')").first(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM submissions WHERE status = 'accepted'").first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM contests').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM problem_lists').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM tickets').first(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM tickets WHERE status IN ('open','in_progress')").first(),
  ]);

  // Recent submissions
  const recentSubmissions = await c.env.DB.prepare(`
    SELECT s.id, s.status, s.language, s.created_at, u.username, p.title, p.slug
    FROM submissions s
    JOIN users u ON s.user_id = u.id
    JOIN problems p ON s.problem_id = p.id
    ORDER BY s.created_at DESC
    LIMIT 8
  `).all();

  return c.json({
    success: true,
    data: {
      users: (userCount as any)?.count || 0,
      problems: (problemCount as any)?.count || 0,
      submissions: (submissionCount as any)?.count || 0,
      today_submissions: (todaySubmissions as any)?.count || 0,
      accepted: (acceptedCount as any)?.count || 0,
      contests: (contestCount as any)?.count || 0,
      lists: (listCount as any)?.count || 0,
      tickets: (ticketCount as any)?.count || 0,
      open_tickets: (openTicketCount as any)?.count || 0,
      recent_submissions: recentSubmissions.results,
    },
  });
});

// GET /problems - List all problems (including private)
admin.get('/problems', authMiddleware, problemAdminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search') || '';
  const offset = (page - 1) * pageSize;

  let countQuery = 'SELECT COUNT(*) as total FROM problems';
  let dataQuery = 'SELECT * FROM problems';
  const binds: any[] = [];

  if (search) {
    countQuery += ' WHERE title LIKE ? OR slug LIKE ?';
    dataQuery += ' WHERE title LIKE ? OR slug LIKE ?';
    binds.push(`%${search}%`, `%${search}%`);
  }

  dataQuery += ' ORDER BY id DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...binds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(dataQuery).bind(...binds, pageSize, offset).all();

  const problemsWithCounts = await Promise.all(
    results.results.map(async (problem: any) => {
      try {
        const testcases = await fetchTestcases(c.env, problem.slug);
        return { ...problem, testcase_count: testcases.length };
      } catch {
        return { ...problem, testcase_count: 0 };
      }
    })
  );

  return c.json({
    success: true,
    data: {
      problems: problemsWithCounts,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /contests - List all contests (admin, including private)
admin.get('/contests', authMiddleware, contestAdminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM contests').first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(
    'SELECT c.*, u.username as creator_name FROM contests c JOIN users u ON c.created_by = u.id ORDER BY c.id DESC LIMIT ? OFFSET ?'
  ).bind(pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      contests: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /tickets - List all tickets (admin)
admin.get('/tickets', authMiddleware, ticketAdminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const status = c.req.query('status');
  const offset = (page - 1) * pageSize;

  let countQuery = 'SELECT COUNT(*) as total FROM tickets';
  let dataQuery = 'SELECT t.*, u.username FROM tickets t JOIN users u ON t.user_id = u.id';
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (status) {
    countQuery += ' WHERE status = ?';
    dataQuery += ' WHERE t.status = ?';
    binds.push(status);
    countBinds.push(status);
  }

  dataQuery += ' ORDER BY t.updated_at DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(dataQuery).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      tickets: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /lists - List all problem lists (admin)
admin.get('/lists', authMiddleware, listAdminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM problem_lists').first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(
    'SELECT pl.*, u.username FROM problem_lists pl JOIN users u ON pl.user_id = u.id ORDER BY pl.id DESC LIMIT ? OFFSET ?'
  ).bind(pageSize, offset).all();

  const listsWithCount = await Promise.all(
    results.results.map(async (list: any) => {
      const count = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM problem_list_items WHERE list_id = ?').bind(list.id).first();
      return { ...list, problem_count: (count as any)?.cnt || 0 };
    })
  );

  return c.json({
    success: true,
    data: {
      lists: listsWithCount,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /sql - Execute SQL query (super admin only)
admin.post('/sql', authMiddleware, superAdminMiddleware, async (c) => {
  const body = await c.req.json();
  const { query, password } = body;

  if (!query || typeof query !== 'string') {
    return c.json({ success: false, error: { message: 'Query is required', code: 'BAD_REQUEST' } }, 400);
  }

  const upperQuery = query.trim().toUpperCase();

  // Block structural changes
  const forbidden = ['DROP ', 'ALTER ', 'CREATE ', 'ATTACH ', 'DETACH '];
  for (const f of forbidden) {
    if (upperQuery.startsWith(f)) {
      return c.json({ success: false, error: { message: `Structural operation not allowed: ${f.trim()}`, code: 'FORBIDDEN' } }, 403);
    }
  }

  // DELETE requires password verification
  if (upperQuery.startsWith('DELETE')) {
    if (!password) {
      return c.json({ success: false, error: { message: 'Password confirmation required for DELETE operations', code: 'PASSWORD_REQUIRED' } }, 403);
    }
    // Verify password by checking against GitHub OAuth (users registered via GitHub don't have passwords)
    // Instead, verify the password matches the CALLBACK_SECRET env var as a master password
    if (password !== c.env.CALLBACK_SECRET) {
      return c.json({ success: false, error: { message: 'Invalid password', code: 'INVALID_PASSWORD' } }, 403);
    }
  }

  try {
    const isRead = upperQuery.startsWith('SELECT') || upperQuery.startsWith('PRAGMA');
    if (isRead) {
      const results = await c.env.DB.prepare(query).all();
      return c.json({ success: true, data: { results: results.results, meta: results.meta } });
    } else {
      const result = await c.env.DB.prepare(query).run();
      return c.json({ success: true, data: { meta: result.meta } });
    }
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message || 'SQL execution failed', code: 'SQL_ERROR' } }, 400);
  }
});

// GET /sql/tables - List all tables (super admin only)
admin.get('/sql/tables', authMiddleware, superAdminMiddleware, async (c) => {
  const results = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY name"
  ).all();
  return c.json({ success: true, data: { tables: results.results.map((r: any) => r.name) } });
});

// GET /sql/table/:name/schema - Get table schema (super admin only)
admin.get('/sql/table/:name/schema', authMiddleware, superAdminMiddleware, async (c) => {
  const tableName = c.req.param('name');
  if (!tableName) {
    return c.json({ success: false, error: { message: 'Table name is required', code: 'BAD_REQUEST' } }, 400);
  }
  // Validate table name to prevent injection
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return c.json({ success: false, error: { message: 'Invalid table name', code: 'BAD_REQUEST' } }, 400);
  }
  const results = await c.env.DB.prepare(`PRAGMA table_info("${tableName}")`).all();
  return c.json({ success: true, data: { schema: results.results } });
});

// GET /sql/table/:name/data - Get table data with pagination (super admin only)
admin.get('/sql/table/:name/data', authMiddleware, superAdminMiddleware, async (c) => {
  const tableName = c.req.param('name');
  if (!tableName) {
    return c.json({ success: false, error: { message: 'Table name is required', code: 'BAD_REQUEST' } }, 400);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return c.json({ success: false, error: { message: 'Invalid table name', code: 'BAD_REQUEST' } }, 400);
  }
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM "${tableName}"`).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(`SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`).bind(pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      rows: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /sql/table/:name/row - Insert a new row (super admin only)
admin.post('/sql/table/:name/row', authMiddleware, superAdminMiddleware, async (c) => {
  const tableName = c.req.param('name');
  if (!tableName) {
    return c.json({ success: false, error: { message: 'Table name is required', code: 'BAD_REQUEST' } }, 400);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return c.json({ success: false, error: { message: 'Invalid table name', code: 'BAD_REQUEST' } }, 400);
  }
  const body = await c.req.json();
  const { data } = body;
  if (!data || typeof data !== 'object') {
    return c.json({ success: false, error: { message: 'Data object is required', code: 'BAD_REQUEST' } }, 400);
  }

  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = columns.map(() => '?').join(', ');
  const colNames = columns.map(c => `"${c}"`).join(', ');

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`
    ).bind(...values).run();
    return c.json({ success: true, data: { meta: result.meta } });
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message || 'Insert failed', code: 'SQL_ERROR' } }, 400);
  }
});

// PUT /sql/table/:name/row - Update a row (super admin only)
admin.put('/sql/table/:name/row', authMiddleware, superAdminMiddleware, async (c) => {
  const tableName = c.req.param('name');
  if (!tableName) {
    return c.json({ success: false, error: { message: 'Table name is required', code: 'BAD_REQUEST' } }, 400);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return c.json({ success: false, error: { message: 'Invalid table name', code: 'BAD_REQUEST' } }, 400);
  }
  const body = await c.req.json();
  const { data, where } = body;
  if (!data || typeof data !== 'object' || !where || typeof where !== 'object') {
    return c.json({ success: false, error: { message: 'Data and where objects are required', code: 'BAD_REQUEST' } }, 400);
  }

  const setClauses = Object.keys(data).map(k => `"${k}" = ?`).join(', ');
  const whereClauses = Object.keys(where).map(k => `"${k}" = ?`).join(' AND ');
  const values = [...Object.values(data), ...Object.values(where)];

  try {
    const result = await c.env.DB.prepare(
      `UPDATE "${tableName}" SET ${setClauses} WHERE ${whereClauses}`
    ).bind(...values).run();
    return c.json({ success: true, data: { meta: result.meta } });
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message || 'Update failed', code: 'SQL_ERROR' } }, 400);
  }
});

// DELETE /sql/table/:name/row - Delete a row (super admin only, requires password)
admin.delete('/sql/table/:name/row', authMiddleware, superAdminMiddleware, async (c) => {
  const tableName = c.req.param('name');
  if (!tableName) {
    return c.json({ success: false, error: { message: 'Table name is required', code: 'BAD_REQUEST' } }, 400);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return c.json({ success: false, error: { message: 'Invalid table name', code: 'BAD_REQUEST' } }, 400);
  }
  const body = await c.req.json();
  const { where, password } = body;
  if (!where || typeof where !== 'object') {
    return c.json({ success: false, error: { message: 'Where object is required', code: 'BAD_REQUEST' } }, 400);
  }
  if (!password) {
    return c.json({ success: false, error: { message: 'Password confirmation required for DELETE', code: 'PASSWORD_REQUIRED' } }, 403);
  }
  if (password !== c.env.CALLBACK_SECRET) {
    return c.json({ success: false, error: { message: 'Invalid password', code: 'INVALID_PASSWORD' } }, 403);
  }

  const whereClauses = Object.keys(where).map(k => `"${k}" = ?`).join(' AND ');
  const values = Object.values(where);

  try {
    const result = await c.env.DB.prepare(
      `DELETE FROM "${tableName}" WHERE ${whereClauses}`
    ).bind(...values).run();
    return c.json({ success: true, data: { meta: result.meta } });
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message || 'Delete failed', code: 'SQL_ERROR' } }, 400);
  }
});

// --- Plagiarism (代码查重) ---

// POST /admin/contests/:id/plagiarism-check — trigger plagiarism detection for a contest
admin.post('/contests/:id/plagiarism-check', authMiddleware, adminMiddleware, async (c) => {
  const contestId = parseInt(c.req.param('id'));

  const contest = await c.env.DB.prepare('SELECT id FROM contests WHERE id = ?').bind(contestId).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // Get all accepted submissions for contest problems, grouped by language
  const submissionsRes = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.problem_id, s.language, s.source_code, u.username, p.title as problem_title
     FROM submissions s
     JOIN users u ON s.user_id = u.id
     JOIN problems p ON s.problem_id = p.id
     JOIN contest_problems cp ON cp.problem_id = s.problem_id
     WHERE cp.contest_id = ? AND s.status = 'accepted'
     ORDER BY s.problem_id, s.language`
  ).bind(contestId).all();

  const submissions = submissionsRes.results as any[];
  if (submissions.length < 2) {
    return c.json({ success: false, error: { message: 'Not enough submissions to compare', code: 'BAD_REQUEST' } }, 400);
  }

  // Group submissions by language for fair comparison
  const byLanguage: Record<string, any[]> = {};
  for (const s of submissions) {
    const lang = (s.language || 'unknown').toLowerCase();
    if (!byLanguage[lang]) byLanguage[lang] = [];
    byLanguage[lang].push(s);
  }

  // Compute fingerprints
  const { fingerprint, similarity } = await import('../utils/plagiarism');
  const fingerprints: Map<number, Set<bigint>> = new Map();
  for (const s of submissions) {
    fingerprints.set(s.id, fingerprint(s.source_code || '', s.language));
  }

  // Delete old reports for this contest
  await c.env.DB.prepare('DELETE FROM plagiarism_reports WHERE contest_id = ?').bind(contestId).run();

  const THRESHOLD = 0.6;
  const reports: any[] = [];

  for (const lang of Object.keys(byLanguage)) {
    const group = byLanguage[lang];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.user_id === b.user_id) continue; // skip same user
        const sim = similarity(fingerprints.get(a.id)!, fingerprints.get(b.id)!);
        if (sim >= THRESHOLD) {
          reports.push({ submission_a: a.id, submission_b: b.id, similarity: sim });
        }
      }
    }
  }

  // Insert reports (batched)
  for (const r of reports) {
    await c.env.DB.prepare(
      'INSERT INTO plagiarism_reports (contest_id, submission_a, submission_b, similarity, method) VALUES (?, ?, ?, ?, ?)'
    ).bind(contestId, r.submission_a, r.submission_b, r.similarity, 'winnowing').run();
  }

  return c.json({
    success: true,
    data: {
      checked: submissions.length,
      reports: reports.length,
      message: `Compared ${submissions.length} submissions, found ${reports.length} suspicious pairs`,
    },
  });
});

// GET /admin/contests/:id/plagiarism-reports — list plagiarism reports for a contest
admin.get('/contests/:id/plagiarism-reports', authMiddleware, adminMiddleware, async (c) => {
  const contestId = parseInt(c.req.param('id'));

  const reports = await c.env.DB.prepare(
    `SELECT pr.id, pr.contest_id, pr.submission_a, pr.submission_b, pr.similarity, pr.method, pr.created_at,
       sa.user_id as user_a_id, ua.username as user_a_name, pa.title as problem_a_title,
       sb.user_id as user_b_id, ub.username as user_b_name, pb.title as problem_b_title
     FROM plagiarism_reports pr
     JOIN submissions sa ON pr.submission_a = sa.id
     JOIN users ua ON sa.user_id = ua.id
     JOIN problems pa ON sa.problem_id = pa.id
     JOIN submissions sb ON pr.submission_b = sb.id
     JOIN users ub ON sb.user_id = ub.id
     JOIN problems pb ON sb.problem_id = pb.id
     WHERE pr.contest_id = ?
     ORDER BY pr.similarity DESC, pr.id DESC`
  ).bind(contestId).all();

  return c.json({ success: true, data: { reports: reports.results } });
});

// GET /admin/plagiarism/:id — single report detail with full source code
admin.get('/plagiarism/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'));

  const report = await c.env.DB.prepare(
    `SELECT pr.id, pr.contest_id, pr.submission_a, pr.submission_b, pr.similarity, pr.method, pr.created_at
     FROM plagiarism_reports pr WHERE pr.id = ?`
  ).bind(id).first();

  if (!report) {
    return c.json({ success: false, error: { message: 'Report not found', code: 'NOT_FOUND' } }, 404);
  }

  const [sa, sb] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.id, s.source_code, s.language, s.created_at, u.username, p.title as problem_title, p.slug
       FROM submissions s JOIN users u ON s.user_id = u.id JOIN problems p ON s.problem_id = p.id
       WHERE s.id = ?`
    ).bind((report as any).submission_a).first(),
    c.env.DB.prepare(
      `SELECT s.id, s.source_code, s.language, s.created_at, u.username, p.title as problem_title, p.slug
       FROM submissions s JOIN users u ON s.user_id = u.id JOIN problems p ON s.problem_id = p.id
       WHERE s.id = ?`
    ).bind((report as any).submission_b).first(),
  ]);

  return c.json({
    success: true,
    data: {
      report,
      submission_a: sa,
      submission_b: sb,
    },
  });
});

// ============================================================
// 文章管理 / Blog management
// ============================================================

// GET /admin/blogs — list all blogs (incl. drafts, all authors)
admin.get('/blogs', authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search') || '';
  const status = c.req.query('status') || '';
  const offset = (page - 1) * pageSize;

  let whereClauses: string[] = [];
  const binds: any[] = [];
  if (search) {
    whereClauses.push('(b.title LIKE ? OR b.tags LIKE ?)');
    binds.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    whereClauses.push('b.status = ?');
    binds.push(status);
  }
  const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM blogs b ${where}`
  ).bind(...binds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT b.id, b.title, b.tags, b.status, b.view_count, b.like_count, b.comment_count, b.created_at, b.updated_at,
       u.id as user_id, u.username, u.avatar_url
     FROM blogs b JOIN users u ON b.user_id = u.id
     ${where}
     ORDER BY b.id DESC LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      blogs: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /admin/blogs/:id — admin view single blog (no view increment)
admin.get('/blogs/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'));
  const blog = await c.env.DB.prepare(
    `SELECT b.*, u.username, u.avatar_url
     FROM blogs b JOIN users u ON b.user_id = u.id WHERE b.id = ?`
  ).bind(id).first();
  if (!blog) {
    return c.json({ success: false, error: { message: 'Blog not found', code: 'NOT_FOUND' } }, 404);
  }
  return c.json({ success: true, data: { blog } });
});

// PUT /admin/blogs/:id/status — update blog status (admin force)
admin.put('/blogs/:id/status', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'));
  const { status } = await c.req.json();
  const allowed = ['published', 'draft', 'archived', 'deleted'];
  if (!allowed.includes(status)) {
    return c.json({ success: false, error: { message: 'Invalid status', code: 'BAD_REQUEST' } }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE blogs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(status, id).run();
  return c.json({ success: true, data: { message: 'Blog status updated' } });
});

// DELETE /admin/blogs/:id — admin force delete
admin.delete('/blogs/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'));
  // cascade delete related rows
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM blog_likes WHERE blog_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM blog_comments WHERE blog_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM blogs WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true, data: { message: 'Blog deleted' } });
});

// ============================================================
// 团队管理 / Team management
// ============================================================

// GET /admin/teams — list all teams (incl. private)
admin.get('/teams', authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search') || '';
  const offset = (page - 1) * pageSize;

  let whereClauses: string[] = [];
  const binds: any[] = [];
  if (search) {
    whereClauses.push('(t.name LIKE ? OR t.slug LIKE ? OR t.description LIKE ?)');
    binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM teams t ${where}`
  ).bind(...binds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.slug, t.description, t.avatar_url, t.is_public, t.created_at,
       u.id as owner_id, u.username as owner_name,
       (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count
     FROM teams t JOIN users u ON t.owner_id = u.id
     ${where}
     ORDER BY t.id DESC LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      teams: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// DELETE /admin/teams/:id — admin force delete a team
admin.delete('/teams/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM team_members WHERE team_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true, data: { message: 'Team deleted' } });
});

// PUT /admin/teams/:id/visibility — toggle team public/private
admin.put('/teams/:id/visibility', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'));
  const { is_public } = await c.req.json();
  await c.env.DB.prepare('UPDATE teams SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(is_public ? 1 : 0, id).run();
  return c.json({ success: true, data: { message: 'Team visibility updated' } });
});

// ============================================================
// 私聊管理 / Message moderation
// ============================================================

// GET /admin/messages/conversations — list all conversations
admin.get('/messages/conversations', authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search') || '';
  const offset = (page - 1) * pageSize;

  // List conversations with both participants + last message preview
  let where = '';
  const binds: any[] = [];
  if (search) {
    where = `WHERE u1.username LIKE ? OR u2.username LIKE ?
      OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ?)`;
    binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM conversations c
     LEFT JOIN conversation_participants cp1 ON cp1.conversation_id = c.id
     LEFT JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id != cp1.user_id
     LEFT JOIN users u1 ON u1.id = cp1.user_id
     LEFT JOIN users u2 ON u2.id = cp2.user_id
     ${where}`
  ).bind(...binds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT c.id, c.created_at, c.updated_at,
       u1.id as user_a_id, u1.username as user_a_name, u1.avatar_url as user_a_avatar,
       u2.id as user_b_id, u2.username as user_b_name, u2.avatar_url as user_b_avatar,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count,
       (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
       (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at
     FROM conversations c
     LEFT JOIN conversation_participants cp1 ON cp1.conversation_id = c.id
     LEFT JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id != cp1.user_id
     LEFT JOIN users u1 ON u1.id = cp1.user_id
     LEFT JOIN users u2 ON u2.id = cp2.user_id
     ${where}
     GROUP BY c.id
     ORDER BY c.updated_at DESC NULLS LAST
     LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      conversations: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /admin/messages/conversations/:id — view messages in a conversation
admin.get('/messages/conversations/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'));
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?'
  ).bind(id).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at, u.username as sender_name, u.avatar_url as sender_avatar
     FROM messages m JOIN users u ON m.sender_id = u.id
     WHERE m.conversation_id = ?
     ORDER BY m.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(id, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      messages: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// DELETE /admin/messages/:id — delete a single message
admin.delete('/messages/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Message deleted' } });
});

// DELETE /admin/messages/conversations/:id — delete entire conversation
admin.delete('/messages/conversations/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM conversation_participants WHERE conversation_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true, data: { message: 'Conversation deleted' } });
});

export default admin;
