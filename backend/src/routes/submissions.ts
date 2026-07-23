import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimit';
import { getLanguageExt } from '../utils/helpers';
import { validateSourceCode, validateLanguage } from '../utils/validator';
import { captchaMiddleware } from '../middleware/captcha';

const submissions = new Hono<AppType>();

submissions.post('/', authMiddleware, captchaMiddleware('submit'), rateLimitMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { problem_id, language, source_code } = body;

  if (!problem_id || !language || !source_code) {
    return c.json({ success: false, error: { message: 'problem_id, language, and source_code are required', code: 'BAD_REQUEST' } }, 400);
  }

  const langError = validateLanguage(language);
  if (langError) {
    return c.json({ success: false, error: { message: langError, code: 'BAD_REQUEST' } }, 400);
  }

  const codeError = validateSourceCode(source_code);
  if (codeError) {
    return c.json({ success: false, error: { message: codeError, code: 'BAD_REQUEST' } }, 400);
  }

  const problem = await c.env.DB.prepare('SELECT id, time_limit, memory_limit FROM problems WHERE id = ? AND is_public = 1')
    .bind(problem_id)
    .first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO submissions (user_id, problem_id, language, source_code, status)
     VALUES (?, ?, ?, ?, 'pending')`
  )
    .bind(user.userId, problem_id, language, source_code)
    .run();

  const submissionId = result.meta.last_row_id;
  const ext = getLanguageExt(language);
  const filePath = `submissions/${submissionId}.${ext}`;

  try {
    const githubContent = btoa(unescape(encodeURIComponent(source_code)));

    const githubResponse = await fetch(
      `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
          'User-Agent': 'OJ-System',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Submit #${submissionId} for problem ${problem_id}`,
          content: githubContent,
        }),
      }
    );

    if (!githubResponse.ok) {
      const errData = await githubResponse.json();
      console.error('GitHub API error:', errData);
      await c.env.DB.prepare("UPDATE submissions SET status = 'system_error' WHERE id = ?")
        .bind(submissionId)
        .run();
      return c.json({ success: false, error: { message: 'Failed to push code to judge repository', code: 'INTERNAL_ERROR' } }, 500);
    }

    const githubData = (await githubResponse.json()) as { content: { sha: string } };
    await c.env.DB.prepare('UPDATE submissions SET github_sha = ? WHERE id = ?')
      .bind(githubData.content.sha, submissionId)
      .run();
  } catch (e) {
    console.error('GitHub push error:', e);
    await c.env.DB.prepare("UPDATE submissions SET status = 'system_error' WHERE id = ?")
      .bind(submissionId)
      .run();
    return c.json({ success: false, error: { message: 'Failed to push code to judge repository', code: 'INTERNAL_ERROR' } }, 500);
  }

  return c.json({ success: true, data: { submission_id: submissionId, status: 'pending' } }, 201);
});

submissions.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const problemId = c.req.query('problem_id');
  const status = c.req.query('status');
  const userId = c.req.query('user_id');
  const language = c.req.query('language');
  const offset = (page - 1) * pageSize;

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  let query = 'SELECT s.id, s.user_id, s.problem_id, s.language, s.status, s.score, s.time_used, s.memory_used, s.created_at, p.title as problem_title, p.slug as problem_slug, u.username FROM submissions s JOIN problems p ON s.problem_id = p.id JOIN users u ON s.user_id = u.id WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as total FROM submissions WHERE 1=1';
  const binds: any[] = [];
  const countBinds: any[] = [];

  // Non-admin users can only see their own submissions
  if (!isAdmin) {
    query += ' AND s.user_id = ?';
    countQuery += ' AND user_id = ?';
    binds.push(user.userId);
    countBinds.push(user.userId);
  } else if (userId) {
    // Admin can filter by user_id
    query += ' AND s.user_id = ?';
    countQuery += ' AND user_id = ?';
    binds.push(parseInt(userId));
    countBinds.push(parseInt(userId));
  }

  if (problemId) {
    query += ' AND s.problem_id = ?';
    countQuery += ' AND problem_id = ?';
    binds.push(parseInt(problemId));
    countBinds.push(parseInt(problemId));
  }

  if (status) {
    query += ' AND s.status = ?';
    countQuery += ' AND status = ?';
    binds.push(status);
    countBinds.push(status);
  }

  if (language) {
    query += ' AND s.language = ?';
    countQuery += ' AND language = ?';
    binds.push(language);
    countBinds.push(language);
  }

  query += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      submissions: results.results,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
});

submissions.get('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  let query = `SELECT s.*, p.title as problem_title, p.slug as problem_slug, u.username
     FROM submissions s JOIN problems p ON s.problem_id = p.id JOIN users u ON s.user_id = u.id
     WHERE s.id = ?`;
  const binds: any[] = [id];

  // Non-admin users can only see their own submissions
  if (!isAdmin) {
    query += ' AND s.user_id = ?';
    binds.push(user.userId);
  }

  const submission = await c.env.DB.prepare(query).bind(...binds).first();

  if (!submission) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }

  return c.json({ success: true, data: { submission } });
});

// Get submission testcases detail (requires login)
submissions.get('/:id/testcases', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  // Verify the submission belongs to the user (or user is admin)
  const submission = await c.env.DB.prepare('SELECT id, user_id FROM submissions WHERE id = ?')
    .bind(id)
    .first();

  if (!submission) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }

  if (!isAdmin && (submission as any).user_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const results = await c.env.DB.prepare(
    'SELECT id, testcase_id, status, time_used, memory_used, score, detail, sort_order FROM submission_testcases WHERE submission_id = ? ORDER BY sort_order ASC'
  )
    .bind(id)
    .all();

  return c.json({ success: true, data: { testcases: results.results } });
});

// Get submission judge logs (requires login)
submissions.get('/:id/logs', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  // Verify the submission belongs to the user (or user is admin)
  const submission = await c.env.DB.prepare('SELECT id, user_id FROM submissions WHERE id = ?')
    .bind(id)
    .first();

  if (!submission) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }

  if (!isAdmin && (submission as any).user_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const results = await c.env.DB.prepare(
    'SELECT id, log_type, message, created_at FROM judge_logs WHERE submission_id = ? ORDER BY created_at ASC'
  )
    .bind(id)
    .all();

  return c.json({ success: true, data: { logs: results.results } });
});

// Compare two submissions (side-by-side)
submissions.get('/compare/:id1/:id2', authMiddleware, async (c) => {
  const user = c.get('user');
  const id1 = parseInt(c.req.param('id1') || '0');
  const id2 = parseInt(c.req.param('id2') || '0');
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  const [s1, s2] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.id, s.user_id, s.problem_id, s.language, s.source_code, s.status, s.score, s.created_at,
              u.username, p.title as problem_title
       FROM submissions s JOIN users u ON s.user_id = u.id JOIN problems p ON s.problem_id = p.id
       WHERE s.id = ?`
    ).bind(id1).first(),
    c.env.DB.prepare(
      `SELECT s.id, s.user_id, s.problem_id, s.language, s.source_code, s.status, s.score, s.created_at,
              u.username, p.title as problem_title
       FROM submissions s JOIN users u ON s.user_id = u.id JOIN problems p ON s.problem_id = p.id
       WHERE s.id = ?`
    ).bind(id2).first(),
  ]);

  if (!s1 || !s2) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }

  // Check permissions
  if (!isAdmin && ((s1 as any).user_id !== user.userId || (s2 as any).user_id !== user.userId)) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  return c.json({ success: true, data: { submission_a: s1, submission_b: s2 } });
});

// Rejudge endpoint (admin only)
submissions.post('/:id/rejudge', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');

  const submission: any = await c.env.DB.prepare(
    'SELECT id, user_id, problem_id, language, source_code FROM submissions WHERE id = ?'
  ).bind(id).first();

  if (!submission) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }

  // Reset submission status to pending
  await c.env.DB.prepare(
    "UPDATE submissions SET status = 'pending', score = NULL, time_used = NULL, memory_used = NULL, judge_message = NULL WHERE id = ?"
  ).bind(id).run();

  // Re-push source code to GitHub to trigger judging
  const ext = getLanguageExt(submission.language);
  const filePath = `submissions/${id}.${ext}`;

  try {
    const githubContent = btoa(unescape(encodeURIComponent(submission.source_code)));

    // Delete existing file first (rejudge overwrites)
    const existingFile: any = await c.env.DB.prepare('SELECT github_sha FROM submissions WHERE id = ?').bind(id).first();
    const deleteBody: any = { message: `Rejudge #${id}`, sha: existingFile?.github_sha };

    if (existingFile?.github_sha) {
      await fetch(
        `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${filePath}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
            'User-Agent': 'OJ-System',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(deleteBody),
        }
      );
    }

    const githubResponse = await fetch(
      `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
          'User-Agent': 'OJ-System',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Rejudge #${id} for problem ${submission.problem_id}`,
          content: githubContent,
        }),
      }
    );

    if (!githubResponse.ok) {
      await c.env.DB.prepare("UPDATE submissions SET status = 'system_error' WHERE id = ?").bind(id).run();
      return c.json({ success: false, error: { message: 'Failed to push code to judge repository', code: 'INTERNAL_ERROR' } }, 500);
    }

    const githubData = (await githubResponse.json()) as { content: { sha: string } };
    await c.env.DB.prepare('UPDATE submissions SET github_sha = ? WHERE id = ?')
      .bind(githubData.content.sha, id)
      .run();
  } catch (e) {
    console.error('Rejudge GitHub push error:', e);
    await c.env.DB.prepare("UPDATE submissions SET status = 'system_error' WHERE id = ?").bind(id).run();
    return c.json({ success: false, error: { message: 'Failed to push code to judge repository', code: 'INTERNAL_ERROR' } }, 500);
  }

  return c.json({ success: true, data: { submission_id: id, status: 'pending', message: 'Rejudge triggered' } });
});

// GET /submissions/export — 导出当前用户的提交记录（CSV格式）
submissions.get('/export', authMiddleware, async (c) => {
  const user = c.get('user');
  const format = c.req.query('format') || 'csv';

  const results = await c.env.DB.prepare(
    `SELECT s.id, s.problem_id, s.language, s.status, s.score, s.time_used, s.memory_used, s.created_at,
            p.title as problem_title, p.slug as problem_slug
     FROM submissions s
     JOIN problems p ON s.problem_id = p.id
     WHERE s.user_id = ?
     ORDER BY s.created_at DESC`
  ).bind(user.userId).all();

  const rows = results.results as any[];

  if (format === 'json') {
    return c.json({ success: true, data: { submissions: rows } });
  }

  // CSV format
  const header = 'ID,Problem,Language,Status,Score,Time,Memory,Date\n';
  const csv = header + rows.map((r) =>
    `${r.id},"${r.problem_title}",${r.language},${r.status},${r.score || 0},${r.time_used || 0},${r.memory_used || 0},${r.created_at}`
  ).join('\n');

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="submissions_${user.userId}.csv"`);
  return c.body(csv);
});

export default submissions;
