import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware, superAdminMiddleware, problemAdminMiddleware, contestAdminMiddleware, ticketAdminMiddleware, listAdminMiddleware } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { recordAuditLog } from '../middleware/audit';
import { fetchTestcases, saveTestcases, deleteTestcases } from '../utils/github-testcases';
import { fetchSpjCode, saveSpjCode, deleteSpjCode } from '../utils/github-spj';
import { escapeLikeWildcard } from '../utils/helpers';

const admin = new Hono<AppType>();

// 站内广播限流:每分钟最多 1 次,防止误操作或恶意刷库
const announcementSendLimiter = createRateLimiter('admin_announcement_send', 1, 60_000);

// 恒定时间字符串比较,避免密码/密钥校验的时序侧信道
function timingSafeStringEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

// 检测 SQL 字符串中出现"裸分号"(不在引号或 -- 行注释内),用于拒绝多语句注入
function hasUnsafeSemicolon(sql: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    // 行注释 --
    if (!inSingle && !inDouble && !inBacktick && ch === '-' && sql[i + 1] === '-') {
      // 跳过到行尾
      const nl = sql.indexOf('\n', i);
      if (nl === -1) return false;
      i = nl + 1;
      continue;
    }
    // 块注释 /* */
    if (!inSingle && !inDouble && !inBacktick && ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 2;
      continue;
    }
    if (ch === "'" && !inDouble && !inBacktick) { inSingle = !inSingle; }
    else if (ch === '"' && !inSingle && !inBacktick) { inDouble = !inDouble; }
    else if (ch === '`' && !inSingle && !inDouble) { inBacktick = !inBacktick; }
    else if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      // 后续若还有非空白字符,即为多语句
      const rest = sql.slice(i + 1);
      if (rest.trim().length > 0) return true;
    }
    i++;
  }
  return false;
}

// 校验标识符(列名/表名)只允许 [a-zA-Z_][a-zA-Z0-9_]*,防止 SQL 注入
function isValidIdentifier(name: string): boolean {
  return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

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

  // Daily submission trend (last 7 days)
  const dailyTrend = await c.env.DB.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count,
           SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted
    FROM submissions
    WHERE created_at >= date('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all();

  // Language distribution
  const langDist = await c.env.DB.prepare(`
    SELECT language, COUNT(*) as count
    FROM submissions
    GROUP BY language
    ORDER BY count DESC
  `).all();

  // Registration trend (last 14 days)
  const registrationTrend = await c.env.DB.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM users
    WHERE created_at >= date('now', '-14 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all();

  // Weekly AC trend (last 8 weeks)
  const weeklyTrend = await c.env.DB.prepare(`
    SELECT strftime('%Y-%W', created_at) as week, COUNT(*) as count,
           SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted
    FROM submissions
    WHERE created_at >= date('now', '-8 weeks')
    GROUP BY week
    ORDER BY week ASC
  `).all();

  // 活跃用户统计:近 24h / 7 天 / 30 天有提交或登录记录的用户数
  const active24h = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT user_id) as count FROM submissions WHERE created_at >= datetime('now', '-24 hours')"
  ).first();
  const active7d = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT user_id) as count FROM submissions WHERE created_at >= datetime('now', '-7 days')"
  ).first();
  const active30d = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT user_id) as count FROM submissions WHERE created_at >= datetime('now', '-30 days')"
  ).first();

  // 近 14 天活跃用户趋势(每日有提交的去重用户数)
  const activeTrend = await c.env.DB.prepare(`
    SELECT date(created_at) as day, COUNT(DISTINCT user_id) as count
    FROM submissions
    WHERE created_at >= date('now', '-14 days')
    GROUP BY day ORDER BY day ASC
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
      daily_trend: dailyTrend.results,
      language_distribution: langDist.results,
      registration_trend: registrationTrend.results,
      weekly_trend: weeklyTrend.results,
      active_users_24h: (active24h as any)?.count || 0,
      active_users_7d: (active7d as any)?.count || 0,
      active_users_30d: (active30d as any)?.count || 0,
      active_trend: activeTrend.results,
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
    countQuery += " WHERE title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\'";
    dataQuery += " WHERE title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\'";
    binds.push(`%${escapeLikeWildcard(search)}%`, `%${escapeLikeWildcard(search)}%`);
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

// GET /problems/export - Export full problem library as JSON
admin.get('/problems/export', authMiddleware, problemAdminMiddleware, async (c) => {
  const results = await c.env.DB.prepare('SELECT * FROM problems ORDER BY id ASC').all();
  const problems = await Promise.all((results.results as any[]).map(async (problem: any) => {
    let tags: string[] = [];
    try {
      tags = typeof problem.tags === 'string' ? JSON.parse(problem.tags || '[]') : (Array.isArray(problem.tags) ? problem.tags : []);
    } catch {
      tags = [];
    }

    const testcases = await fetchTestcases(c.env, problem.slug).catch(() => []);
    const spjCode = problem.judge_type === 'spj' && problem.spj_language
      ? await fetchSpjCode(c.env, problem.slug, problem.spj_language).catch(() => '')
      : null;

    return {
      ...problem,
      tags,
      testcases,
      spj_code: spjCode,
      spj_language: problem.spj_language,
    };
  }));

  return c.json({ success: true, data: { problems } });
});

// POST /problems/import - Import a problem library from JSON
admin.post('/problems/import', authMiddleware, problemAdminMiddleware, async (c) => {
  const body = await c.req.json();
  const payload = Array.isArray(body) ? body : body?.problems;

  if (!Array.isArray(payload)) {
    return c.json({ success: false, error: { message: 'Expected an array of problems', code: 'BAD_REQUEST' } }, 400);
  }

  // (L10)数量与字段长度上限,避免单次请求触发数百次 GitHub API 调用造成 DoS
  const MAX_IMPORT_COUNT = 100;
  if (payload.length > MAX_IMPORT_COUNT) {
    return c.json({ success: false, error: { message: `Cannot import more than ${MAX_IMPORT_COUNT} problems at once`, code: 'BAD_REQUEST' } }, 400);
  }
  for (const item of payload) {
    if (item && typeof item.title === 'string' && item.title.length > 200) {
      return c.json({ success: false, error: { message: 'Each problem title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
    }
    if (item && typeof item.slug === 'string' && item.slug.length > 200) {
      return c.json({ success: false, error: { message: 'Each problem slug must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
    }
    if (item && typeof item.description === 'string' && item.description.length > 100000) {
      return c.json({ success: false, error: { message: 'Each problem description must be at most 100000 characters', code: 'BAD_REQUEST' } }, 400);
    }
    if (item && Array.isArray(item.testcases) && item.testcases.length > 200) {
      return c.json({ success: false, error: { message: 'Each problem can have at most 200 testcases', code: 'BAD_REQUEST' } }, 400);
    }
  }

  let imported = 0;
  for (const item of payload) {
    const title = item?.title;
    const slug = item?.slug || (typeof title === 'string' ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'problem');
    if (!title || !slug) continue;

    const tags = Array.isArray(item?.tags)
      ? item.tags
      : (typeof item?.tags === 'string' ? item.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []);

    const existing = await c.env.DB.prepare('SELECT id, slug, judge_type, spj_language FROM problems WHERE slug = ?').bind(slug).first();
    const problemId = existing ? (existing as any).id : null;

    if (problemId) {
      await c.env.DB.prepare(`
        UPDATE problems
        SET title = ?, slug = ?, description = ?, input_format = ?, output_format = ?, time_limit = ?, memory_limit = ?, tags = ?, difficulty = ?, is_public = ?, judge_type = ?, spj_language = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        item.title || title,
        slug,
        item.description || '',
        item.input_format || null,
        item.output_format || null,
        item.time_limit || 1000,
        item.memory_limit || 256,
        JSON.stringify(tags),
        item.difficulty || 'Easy',
        item.is_public !== undefined ? (item.is_public ? 1 : 0) : 1,
        item.judge_type || 'default',
        item.judge_type === 'spj' ? (item.spj_language || null) : null,
        problemId,
      ).run();

      await deleteTestcases(c.env, slug);
      if ((existing as any)?.judge_type === 'spj' && (existing as any)?.spj_language) {
        await deleteSpjCode(c.env, slug, (existing as any).spj_language);
      }
    } else {
      const result = await c.env.DB.prepare(`
        INSERT INTO problems (title, slug, description, input_format, output_format, time_limit, memory_limit, tags, difficulty, is_public, judge_type, spj_language)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.title || title,
        slug,
        item.description || '',
        item.input_format || null,
        item.output_format || null,
        item.time_limit || 1000,
        item.memory_limit || 256,
        JSON.stringify(tags),
        item.difficulty || 'Easy',
        item.is_public !== undefined ? (item.is_public ? 1 : 0) : 1,
        item.judge_type || 'default',
        item.judge_type === 'spj' ? (item.spj_language || null) : null,
      ).run();

      // result.meta.last_row_id is available for later use if needed
    }

    if (Array.isArray(item?.testcases) && item.testcases.length > 0) {
      await saveTestcases(c.env, slug, item.testcases);
    }

    if (item?.judge_type === 'spj' && item?.spj_language && item?.spj_code) {
      await saveSpjCode(c.env, slug, item.spj_language, item.spj_code);
    }

    imported += 1;
  }

  return c.json({ success: true, data: { imported, message: `Imported ${imported} problems` } });
});

// GET /contests - List all contests (admin, including private)
admin.get('/contests', authMiddleware, contestAdminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM contests').first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(
    `SELECT c.*, u.username as creator_name,
            (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_id = c.id) as participant_count
     FROM contests c JOIN users u ON c.created_by = u.id ORDER BY c.id DESC LIMIT ? OFFSET ?`
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

  // 强制查询长度上限,避免巨型 SQL 造成 DoS
  if (query.length > 8000) {
    return c.json({ success: false, error: { message: 'Query too long (max 8000 chars)', code: 'BAD_REQUEST' } }, 400);
  }

  // 仅允许以注释/空白开头的语句被剥离后判定,统一大小写并去掉前导空格/分号
  const trimmedQuery = query.replace(/^[\s;]+/, '').trim();
  const upperQuery = trimmedQuery.toUpperCase();

  // 仅允许 SELECT / PRAGMA / INSERT / UPDATE / DELETE;
  // 禁止 DDL/DCL 及其他可能修改结构的语句(覆盖到带有前缀注释的写法)
  const ALLOWED_PREFIXES = ['SELECT', 'PRAGMA', 'INSERT', 'UPDATE', 'DELETE', 'WITH'];
  const FORBIDDEN_KEYWORDS = [
    'DROP ', 'ALTER ', 'CREATE ', 'ATTACH ', 'DETACH ', 'REPLACE INTO sqlite_master',
    'GRANT ', 'REVOKE ', 'PRAGMA journal_mode', 'PRAGMA wal_', 'PRAGMA foreign_keys',
  ];
  const startsWithAllowed = ALLOWED_PREFIXES.some((p) => upperQuery.startsWith(p));
  if (!startsWithAllowed) {
    return c.json({ success: false, error: { message: 'Only SELECT / PRAGMA / INSERT / UPDATE / DELETE statements are allowed', code: 'FORBIDDEN' } }, 403);
  }
  for (const f of FORBIDDEN_KEYWORDS) {
    if (upperQuery.includes(f)) {
      return c.json({ success: false, error: { message: `Disallowed operation: ${f.trim()}`, code: 'FORBIDDEN' } }, 403);
    }
  }

  // 多语句检测:简单字符串扫描,出现不在引号/注释内的分号即拒绝
  if (hasUnsafeSemicolon(trimmedQuery)) {
    return c.json({ success: false, error: { message: 'Multiple statements are not allowed', code: 'FORBIDDEN' } }, 403);
  }

  // DELETE requires password verification
  if (upperQuery.startsWith('DELETE')) {
    if (!password) {
      return c.json({ success: false, error: { message: 'Password confirmation required for DELETE operations', code: 'PASSWORD_REQUIRED' } }, 403);
    }
    // 使用恒定时间比较防止时序侧信道;master 密钥复用 CALLBACK_SECRET(应后续替换为独立密钥)
    if (!timingSafeStringEqual(String(password), String(c.env.CALLBACK_SECRET || ''))) {
      return c.json({ success: false, error: { message: 'Invalid password', code: 'INVALID_PASSWORD' } }, 403);
    }
    // DELETE 必须显式带 WHERE 子句,防止误删全表
    if (!upperQuery.includes('WHERE')) {
      return c.json({ success: false, error: { message: 'DELETE without WHERE clause is not allowed', code: 'FORBIDDEN' } }, 403);
    }
  }

  // UPDATE 也要求 WHERE 子句,避免全表更新
  if (upperQuery.startsWith('UPDATE') && !upperQuery.includes('WHERE')) {
    return c.json({ success: false, error: { message: 'UPDATE without WHERE clause is not allowed', code: 'FORBIDDEN' } }, 403);
  }

  try {
    const isRead = upperQuery.startsWith('SELECT') || upperQuery.startsWith('PRAGMA') || upperQuery.startsWith('WITH');
    if (isRead) {
      const results = await c.env.DB.prepare(trimmedQuery).all();
      return c.json({ success: true, data: { results: results.results, meta: results.meta } });
    } else {
      const result = await c.env.DB.prepare(trimmedQuery).run();
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
  // 校验所有列名为合法标识符,防止通过列名拼接触发 SQL 注入
  for (const col of columns) {
    if (!isValidIdentifier(col)) {
      return c.json({ success: false, error: { message: `Invalid column name: ${col}`, code: 'BAD_REQUEST' } }, 400);
    }
  }
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

  // 校验列名/条件名为合法标识符,防止 SQL 注入
  for (const k of [...Object.keys(data), ...Object.keys(where)]) {
    if (!isValidIdentifier(k)) {
      return c.json({ success: false, error: { message: `Invalid column name: ${k}`, code: 'BAD_REQUEST' } }, 400);
    }
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
  if (!timingSafeStringEqual(String(password), String(c.env.CALLBACK_SECRET || ''))) {
    return c.json({ success: false, error: { message: 'Invalid password', code: 'INVALID_PASSWORD' } }, 403);
  }

  const whereClauses = Object.keys(where).map(k => `"${k}" = ?`).join(' AND ');
  const values = Object.values(where);

  // 校验 WHERE 列名合法性
  for (const k of Object.keys(where)) {
    if (!isValidIdentifier(k)) {
      return c.json({ success: false, error: { message: `Invalid column name: ${k}`, code: 'BAD_REQUEST' } }, 400);
    }
  }

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
  const contestId = parseInt(c.req.param('id') || '0');

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
  const contestId = parseInt(c.req.param('id') || '0');

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
  const id = parseInt(c.req.param('id') || '0');

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
    whereClauses.push("(b.title LIKE ? ESCAPE '\\' OR b.tags LIKE ? ESCAPE '\\')");
    binds.push(`%${escapeLikeWildcard(search)}%`, `%${escapeLikeWildcard(search)}%`);
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
  const id = parseInt(c.req.param('id') || '0');
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
  const id = parseInt(c.req.param('id') || '0');
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
  const id = parseInt(c.req.param('id') || '0');
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
    whereClauses.push("(t.name LIKE ? ESCAPE '\\' OR t.slug LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')");
    binds.push(`%${escapeLikeWildcard(search)}%`, `%${escapeLikeWildcard(search)}%`, `%${escapeLikeWildcard(search)}%`);
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
  const id = parseInt(c.req.param('id') || '0');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM team_members WHERE team_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true, data: { message: 'Team deleted' } });
});

// PUT /admin/teams/:id/visibility — toggle team public/private
admin.put('/teams/:id/visibility', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
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
    where = `WHERE u1.username LIKE ? ESCAPE '\\' OR u2.username LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ? ESCAPE '\\')`;
    binds.push(`%${escapeLikeWildcard(search)}%`, `%${escapeLikeWildcard(search)}%`, `%${escapeLikeWildcard(search)}%`);
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
  const id = parseInt(c.req.param('id') || '0');
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
  const id = parseInt(c.req.param('id') || '0');
  await c.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Message deleted' } });
});

// DELETE /admin/messages/conversations/:id — delete entire conversation
admin.delete('/messages/conversations/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM conversation_participants WHERE conversation_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true, data: { message: 'Conversation deleted' } });
});

// ============================================================
// 站点公告广播 / Site-wide announcement
// ============================================================

// POST /admin/announcement/send — 发送系统公告给所有用户（admin only）
// 整改(M7):
//  - 路由注册必须位于 export default 之前(原代码反模式)
//  - 标题/正文加长度上限防止巨型 payload
//  - 站内广播影响面大,加专属 rate limit(1次/分钟)防误操作与刷库
//  - 写审计日志(包含 title)便于事后追溯
//  - 改用 D1 batch 批量插入,避免数千用户逐条 round-trip
admin.post('/announcement/send', authMiddleware, adminMiddleware, announcementSendLimiter, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { title, content, link } = body;

  if (!title || !content) {
    return c.json({ success: false, error: { message: 'title and content are required', code: 'BAD_REQUEST' } }, 400);
  }
  if (typeof title !== 'string' || title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be a string of at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (typeof content !== 'string' || content.length > 5000) {
    return c.json({ success: false, error: { message: 'content must be a string of at most 5000 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (link !== undefined && link !== null && (typeof link !== 'string' || link.length > 500)) {
    return c.json({ success: false, error: { message: 'link must be a string of at most 500 characters', code: 'BAD_REQUEST' } }, 400);
  }

  const { sendNotification, NotificationType } = await import('../utils/notify');

  // 获取所有用户
  const users = await c.env.DB.prepare('SELECT id FROM users').all();
  const userIds = (users.results as any[]).map((r) => r.id);
  let sent = 0;

  // 串行调用 sendNotification(其内部已封装 INSERT 语句);
  // 不能放进 D1 batch,因为 batch 仅支持 D1PreparedStatement,而 sendNotification 是异步函数。
  // 此处不再使用 for-of 内逐条 await,改为限制最大广播数量,并在失败时继续(单个失败不阻塞整体广播)。
  const MAX_RECIPIENTS = 10000;
  for (const uid of userIds.slice(0, MAX_RECIPIENTS)) {
    try {
      await sendNotification(c.env.DB, uid, NotificationType.SYSTEM, title, content, link || '');
      sent++;
    } catch {
      /* 单条失败不阻塞整体广播 */
    }
  }

  // 写审计日志,记录标题与发送量便于事后追溯
  await recordAuditLog(c, `announcement:send title="${String(title).slice(0, 100)}" recipients=${sent}`, user.userId, user.username);

  return c.json({ success: true, data: { message: `Announcement sent to ${sent} users`, sent } });
});

export default admin;
