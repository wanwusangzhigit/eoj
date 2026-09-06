import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimit';
import { getLanguageExt } from '../utils/helpers';
import { validateSourceCode, validateLanguage } from '../utils/validator';
import { captchaMiddleware } from '../middleware/captcha';
import { parseContestTimeToMs, effectiveContestStatus, isContestAdmin } from '../utils/contest-time';
import { fetchWithTimeout } from '../utils/fetch-timeout';

const submissions = new Hono<AppType>();

// OI 赛制赛时隐藏评测结果:比赛运行中且赛制为 oi 时,非主办方用户看不到状态/得分
// 按时间动态判定(不依赖可能过期的 status 静态字段),与 contests.ts 一致
async function getHiddenOIContestIds(db: D1Database, ids: number[]): Promise<Set<number>> {
  const cleanIds = [...new Set(ids.filter((x) => x))];
  if (cleanIds.length === 0) return new Set();
  const placeholders = cleanIds.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT id, start_time, end_time FROM contests WHERE id IN (${placeholders}) AND scoring_type = 'oi'`
  ).bind(...cleanIds).all();
  const hidden = new Set<number>();
  for (const r of rows.results as any[]) {
    if (effectiveContestStatus(r) === 'running') hidden.add(r.id);
  }
  return hidden;
}

function canViewOIResult(user: any): boolean {
  // 与 isContestAdmin 同语义(OI 赛时仅主办方/admin 可见评测结果)
  return isContestAdmin(user);
}

function hideSubmissionResult(sub: any): void {
  sub.status = 'pending';
  sub.score = null;
  sub.time_used = null;
  sub.memory_used = null;
}

submissions.post('/', authMiddleware, captchaMiddleware('submit'), rateLimitMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { problem_id, language, source_code, contest_id, team_contest_id } = body;

  // 互斥校验:contest_id 与 team_contest_id 不能同时提交
  if (contest_id && team_contest_id) {
    return c.json({ success: false, error: { message: 'contest_id and team_contest_id are mutually exclusive', code: 'BAD_REQUEST' } }, 400);
  }

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

  const problem = await c.env.DB.prepare('SELECT id, time_limit, memory_limit, is_public FROM problems WHERE id = ?')
    .bind(problem_id)
    .first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  // Team-private problem (is_public=0): only team members can submit
  if ((problem as any).is_public !== 1) {
    const teamProblem = await c.env.DB.prepare(
      'SELECT tp.team_id FROM team_problems tp JOIN team_members tm ON tm.team_id = tp.team_id WHERE tp.problem_id = ? AND tm.user_id = ?'
    ).bind(problem_id, user.userId).first();
    if (!teamProblem) {
      return c.json({ success: false, error: { message: 'You are not a member of the team owning this problem', code: 'FORBIDDEN' } }, 403);
    }
  }

  // Contest-scoped submission: the contest must be running, the user must be
  // registered, and the problem must belong to the contest.
  let contestSubmissionId: number | null = null;
  if (contest_id) {
    const contest = await c.env.DB.prepare(
      'SELECT id, status, start_time, end_time, duration_minutes FROM contests WHERE id = ?'
    ).bind(contest_id).first();
    if (!contest) {
      return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
    }
    // 报名记录(含虚拟参赛标记与虚拟开始时间)
    const participant = await c.env.DB.prepare(
      'SELECT id, is_virtual, virtual_start_time FROM contest_participants WHERE contest_id = ? AND user_id = ?'
    ).bind(contest_id, user.userId).first();
    if (!participant) {
      return c.json({ success: false, error: { message: 'You must register for this contest first', code: 'FORBIDDEN' } }, 403);
    }

    const nowMs = Date.now();
    // 虚拟参赛者:提交时间窗为 [virtual_start_time, virtual_start_time + duration_minutes](有时长时)
    // 真实参赛者:提交时间窗为比赛 [start_time, end_time]
    if ((participant as any).is_virtual) {
      const vStart = parseContestTimeToMs((participant as any).virtual_start_time);
      if (!isFinite(vStart)) {
        return c.json({ success: false, error: { message: 'Invalid virtual start time', code: 'BAD_REQUEST' } }, 400);
      }
      const vDuration = parseInt((contest as any).duration_minutes) || 0;
      // 双重保险(M7):即便绕过 virtual-register 直接提交,只要时长缺失也拒绝接收,
      // 避免老数据或被绕过的报名记录造成无窗口限制的提交。
      if (vDuration <= 0) {
        return c.json({ success: false, error: { message: 'Virtual participation is disabled for this contest', code: 'FORBIDDEN' } }, 403);
      }
      const vEnd = vStart + vDuration * 60000;
      if (!(nowMs >= vStart && nowMs < vEnd)) {
        return c.json({ success: false, error: { message: 'Virtual contest time has ended', code: 'FORBIDDEN' } }, 403);
      }
    } else {
      // 按当前时间动态判定,避免 status 字段过期导致拦截失效
      // (统一使用 parseContestTimeToMs,与 contests.ts 时区解析一致)
      const cStart = parseContestTimeToMs((contest as any).start_time);
      const cEnd = parseContestTimeToMs((contest as any).end_time);
      if (!(nowMs >= cStart && nowMs < cEnd)) {
        return c.json({ success: false, error: { message: 'Contest is not running', code: 'FORBIDDEN' } }, 403);
      }
    }
    const cp = await c.env.DB.prepare(
      'SELECT id FROM contest_problems WHERE contest_id = ? AND problem_id = ?'
    ).bind(contest_id, problem_id).first();
    if (!cp) {
      return c.json({ success: false, error: { message: 'Problem is not part of this contest', code: 'BAD_REQUEST' } }, 400);
    }
    contestSubmissionId = Number(contest_id);
  }

  // Team-contest-scoped submission: the team contest must be running, the user
  // must be a team member, and the problem must belong to the team contest.
  let teamContestSubmissionId: number | null = null;
  if (team_contest_id) {
    const teamContest = await c.env.DB.prepare(
      'SELECT tc.id, tc.team_id, tc.start_time, tc.end_time FROM team_contests tc WHERE tc.id = ?'
    ).bind(team_contest_id).first();
    if (!teamContest) {
      return c.json({ success: false, error: { message: 'Team contest not found', code: 'NOT_FOUND' } }, 404);
    }
    // 按当前时间动态判定,避免 status 字段过期导致拦截失效
    // (统一使用 parseContestTimeToMs,与 contests.ts 时区解析一致)
    const tcNowMs = Date.now();
    const tcStart = parseContestTimeToMs((teamContest as any).start_time);
    const tcEnd = parseContestTimeToMs((teamContest as any).end_time);
    if (!(tcNowMs >= tcStart && tcNowMs < tcEnd)) {
      return c.json({ success: false, error: { message: 'Team contest is not running', code: 'FORBIDDEN' } }, 403);
    }
    const member = await c.env.DB.prepare(
      'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?'
    ).bind((teamContest as any).team_id, user.userId).first();
    if (!member) {
      return c.json({ success: false, error: { message: 'You are not a member of this team', code: 'FORBIDDEN' } }, 403);
    }
    const tcp = await c.env.DB.prepare(
      'SELECT id FROM team_contest_problems WHERE team_contest_id = ? AND problem_id = ?'
    ).bind(team_contest_id, problem_id).first();
    if (!tcp) {
      return c.json({ success: false, error: { message: 'Problem is not part of this team contest', code: 'BAD_REQUEST' } }, 400);
    }
    teamContestSubmissionId = Number(team_contest_id);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO submissions (user_id, problem_id, language, source_code, status, contest_id, team_contest_id)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(user.userId, problem_id, language, source_code, contestSubmissionId, teamContestSubmissionId)
    .run();

  const submissionId = result.meta.last_row_id;
  const ext = getLanguageExt(language);
  const filePath = `submissions/${submissionId}.${ext}`;

  try {
    const githubContent = btoa(unescape(encodeURIComponent(source_code)));

    const githubResponse = await fetchWithTimeout(
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

  const isAdmin = isContestAdmin(user);

  let query = 'SELECT s.id, s.user_id, s.problem_id, s.language, s.status, s.score, s.time_used, s.memory_used, s.created_at, s.contest_id, p.title as problem_title, p.slug as problem_slug, u.username FROM submissions s JOIN problems p ON s.problem_id = p.id JOIN users u ON s.user_id = u.id WHERE 1=1';
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

  // OI 赛制赛时:非主办方用户隐藏评测结果
  const rows = results.results as any[];
  if (!canViewOIResult(user)) {
    const hiddenIds = await getHiddenOIContestIds(c.env.DB, rows.map((r) => r.contest_id));
    if (hiddenIds.size > 0) {
      for (const r of rows) {
        if (hiddenIds.has(r.contest_id)) hideSubmissionResult(r);
      }
    }
  }

  return c.json({
    success: true,
    data: {
      submissions: rows,
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
  const isAdmin = isContestAdmin(user);

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

  // OI 赛制赛时:非主办方用户隐藏评测结果
  if (!canViewOIResult(user)) {
    const hiddenIds = await getHiddenOIContestIds(c.env.DB, [(submission as any).contest_id]);
    if (hiddenIds.size > 0) hideSubmissionResult(submission as any);
  }

  // 团队私有题归属:附加 team_id,便于前端渲染正确的题目链接
  // (团队私有题 is_public=0,全局 /problems/:slug 查询不到,必须跳转 /team/:id/problem/:pid)
  const sub = submission as any;
  if (sub.problem_id) {
    const teamProblem: any = await c.env.DB.prepare(
      'SELECT team_id FROM team_problems WHERE problem_id = ? LIMIT 1'
    ).bind(sub.problem_id).first();
    if (teamProblem) {
      sub.team_id = teamProblem.team_id;
    }
  }

  return c.json({ success: true, data: { submission } });
});

// GET /submissions/:id/history — 同一题目的历史提交列表(本人或管理员)
// 用于「提交历史对比」:前端按提交时间线展示,并可跳转 /submissions/compare/:id1/:id2
submissions.get('/:id/history', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const isAdmin = isContestAdmin(user);

  const sub: any = await c.env.DB.prepare('SELECT id, user_id, problem_id FROM submissions WHERE id = ?')
    .bind(id).first();
  if (!sub) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }
  if (!isAdmin && sub.user_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const history = await c.env.DB.prepare(
    `SELECT id, language, status, score, time_used, memory_used, created_at
     FROM submissions
     WHERE problem_id = ? AND user_id = ?
     ORDER BY id DESC LIMIT 20`
  ).bind(sub.problem_id, sub.user_id).all();

  return c.json({ success: true, data: { history: history.results, problem_id: sub.problem_id } });
});
submissions.get('/:id/testcases', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const isAdmin = isContestAdmin(user);

  // Verify the submission belongs to the user (or user is admin)
  const submission = await c.env.DB.prepare('SELECT id, user_id, contest_id FROM submissions WHERE id = ?')
    .bind(id)
    .first();

  if (!submission) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }

  if (!isAdmin && (submission as any).user_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  // OI 赛制赛时:隐藏测试点详情
  if (!canViewOIResult(user)) {
    const hiddenIds = await getHiddenOIContestIds(c.env.DB, [(submission as any).contest_id]);
    if (hiddenIds.size > 0) {
      return c.json({ success: true, data: { testcases: [] } });
    }
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
  const isAdmin = isContestAdmin(user);

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
  const isAdmin = isContestAdmin(user);

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
    "UPDATE submissions SET status = 'pending', score = NULL, time_used = NULL, memory_used = NULL WHERE id = ?"
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
      await fetchWithTimeout(
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

    const githubResponse = await fetchWithTimeout(
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
