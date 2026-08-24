import { Hono } from 'hono';
import { AppType } from '../types';
import { fetchSpjCode } from '../utils/github-spj';
import { fetchWithTimeout } from '../utils/fetch-timeout';

// 恒定时间字符串比较,避免 CALLBACK_SECRET 校验的时序侧信道攻击
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) {
    diff |= ba[i] ^ bb[i];
  }
  return diff === 0;
}

const internal = new Hono<AppType>();

internal.post('/callback', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }

  const token = authHeader.slice(7);
  if (!timingSafeEqual(token, c.env.CALLBACK_SECRET)) {
    return c.json({ success: false, error: { message: 'Invalid callback secret', code: 'FORBIDDEN' } }, 403);
  }

  const body = await c.req.json();
  const { submission_id, status, score, time_used, memory_used, details, github_run_id } = body;

  if (!submission_id || !status) {
    return c.json({ success: false, error: { message: 'submission_id and status are required', code: 'BAD_REQUEST' } }, 400);
  }

  // 类型与长度上限校验,防止持有 CALLBACK_SECRET 的恶意调用方塞入超大 payload
  // 导致 D1 行/字段超过 SQLite 限制(默认 1GB 但实际由 wrangler 限制)。
  // submission_id 可能以字符串形式传入,校验其为合法数字即可接受。
  if (typeof submission_id !== 'number' && typeof submission_id !== 'string') {
    return c.json({ success: false, error: { message: 'submission_id must be a number', code: 'BAD_REQUEST' } }, 400);
  }
  const submissionIdStr = String(submission_id);
  if (!/^\d+$/.test(submissionIdStr) || submissionIdStr.length > 64) {
    return c.json({ success: false, error: { message: 'submission_id must be a number', code: 'BAD_REQUEST' } }, 400);
  }
  if (typeof status !== 'string' || status.length > 64) {
    return c.json({ success: false, error: { message: 'Invalid status', code: 'BAD_REQUEST' } }, 400);
  }
  if (score !== undefined && score !== null && (typeof score !== 'number' || !Number.isFinite(score) || Math.abs(score) > 1e9)) {
    return c.json({ success: false, error: { message: 'Invalid score', code: 'BAD_REQUEST' } }, 400);
  }
  if (time_used !== undefined && time_used !== null && (typeof time_used !== 'number' || !Number.isFinite(time_used) || time_used < 0 || time_used > 86400000)) {
    return c.json({ success: false, error: { message: 'Invalid time_used', code: 'BAD_REQUEST' } }, 400);
  }
  if (memory_used !== undefined && memory_used !== null && (typeof memory_used !== 'number' || !Number.isFinite(memory_used) || memory_used < 0 || memory_used > 1073741824)) {
    return c.json({ success: false, error: { message: 'Invalid memory_used', code: 'BAD_REQUEST' } }, 400);
  }
  if (github_run_id !== undefined && github_run_id !== null && (typeof github_run_id !== 'string' || github_run_id.length > 64)) {
    return c.json({ success: false, error: { message: 'Invalid github_run_id', code: 'BAD_REQUEST' } }, 400);
  }
  const MAX_DETAILS_BYTES = 2 * 1024 * 1024; // 2MB 上限,足够容纳数百个 testcase 详情
  if (details !== undefined && details !== null) {
    const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
    if (detailsStr.length > MAX_DETAILS_BYTES) {
      return c.json({ success: false, error: { message: 'details too large', code: 'BAD_REQUEST' } }, 400);
    }
  }

  const validStatuses = [
    'accepted', 'wrong_answer', 'time_limit_exceeded',
    'memory_limit_exceeded', 'runtime_error', 'compile_error', 'system_error',
    'security_blocked',
  ];

  if (!validStatuses.includes(status)) {
    return c.json({ success: false, error: { message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'BAD_REQUEST' } }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM submissions WHERE id = ?')
    .bind(submissionIdStr)
    .first();

  if (!existing) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }

  // Parse and store testcases details
  let testcaseList: any[] = [];
  if (details) {
    try {
      testcaseList = typeof details === 'string' ? JSON.parse(details) : details;
      if (!Array.isArray(testcaseList)) testcaseList = [];
    } catch {
      testcaseList = [];
    }
  }

  // Delete old testcases and logs for this submission (supports rejudge)
  await c.env.DB.prepare('DELETE FROM submission_testcases WHERE submission_id = ?')
    .bind(submissionIdStr)
    .run();
  await c.env.DB.prepare('DELETE FROM judge_logs WHERE submission_id = ?')
    .bind(submissionIdStr)
    .run();

  // Insert testcase details
  for (let i = 0; i < testcaseList.length; i++) {
    const tc = testcaseList[i];
    await c.env.DB.prepare(
      `INSERT INTO submission_testcases (submission_id, testcase_id, status, time_used, memory_used, score, detail, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        submissionIdStr,
        tc.testcase_id || tc.id || null,
        tc.status || status,
        tc.time_used || 0,
        tc.memory_used || 0,
        tc.score || 0,
        tc.detail || tc.message || '',
        i
      )
      .run();
  }

  // Insert judge logs from callback
  const logs = body.logs;
  if (Array.isArray(logs)) {
    for (const log of logs) {
      await c.env.DB.prepare(
        `INSERT INTO judge_logs (submission_id, log_type, message) VALUES (?, ?, ?)`
      )
        .bind(submissionIdStr, log.log_type || 'info', log.message || '')
        .run();
    }
  }

  // Insert a summary log entry for the final status
  await c.env.DB.prepare(
    `INSERT INTO judge_logs (submission_id, log_type, message) VALUES (?, ?, ?)`
  )
    .bind(submissionIdStr, 'result', `Judging finished: ${status}, score=${score || 0}, time=${time_used || 0}ms, memory=${memory_used || 0}KB`)
    .run();

  await c.env.DB.prepare(
    `UPDATE submissions SET status = ?, score = ?, time_used = ?, memory_used = ?, details = ?, github_run_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  )
    .bind(
      status,
      score || 0,
      time_used || null,
      memory_used || null,
      details ? JSON.stringify(details) : null,
      github_run_id || null,
      submissionIdStr
    )
    .run();

  return c.json({ success: true, data: { message: 'Submission updated' } });
});

internal.get('/judge-data', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }

  const token = authHeader.slice(7);
  if (!timingSafeEqual(token, c.env.CALLBACK_SECRET)) {
    return c.json({ success: false, error: { message: 'Invalid callback secret', code: 'FORBIDDEN' } }, 403);
  }

  const submissionId = parseInt(c.req.query('submission_id') || '0');
  if (!submissionId) {
    return c.json({ success: false, error: { message: 'submission_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  const submission = await c.env.DB.prepare(
    'SELECT id, problem_id, language, source_code FROM submissions WHERE id = ?'
  )
    .bind(submissionId)
    .first();

  if (!submission) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }

  const problem = await c.env.DB.prepare(
    'SELECT slug, time_limit, memory_limit, judge_type, spj_language FROM problems WHERE id = ?'
  )
    .bind((submission as any).problem_id)
    .first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found', code: 'NOT_FOUND' } }, 404);
  }

  const filePath = `testcases/${(problem as any).slug}.json`;
  const githubResponse = await fetchWithTimeout(
    `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${filePath}`,
    {
      headers: {
        Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3.raw',
        'User-Agent': 'OJ-System',
      },
    }
  );

  if (!githubResponse.ok) {
    const body = await githubResponse.text();
    console.error('GitHub testcase fetch failed:', githubResponse.status, body);
    return c.json({ success: false, error: { message: 'Failed to load testcases from judge repository', code: 'INTERNAL_ERROR' } }, 500);
  }

  let testcases: any[];
  try {
    testcases = await githubResponse.json();
  } catch (e) {
    console.error('Invalid testcase JSON:', e);
    return c.json({ success: false, error: { message: 'Invalid testcase format in judge repository', code: 'INTERNAL_ERROR' } }, 500);
  }

  // Admin-configurable hard cap for the whole judging action (seconds).
  // The judge runner enforces it as the outer timeout; when exceeded the
  // action is killed and a system_error is reported.
  const timeoutRow: any = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'action_timeout'").first();
  const actionTimeout = parseInt((timeoutRow?.value as string) || '') || 300;

  const responseData: any = {
    submission,
    testcases,
    problem,
    action_timeout: actionTimeout,
  };

  // Include SPJ code if judge_type is 'spj'
  if ((problem as any).judge_type === 'spj' && (problem as any).spj_language) {
    const spjCode = await fetchSpjCode(c.env, (problem as any).slug, (problem as any).spj_language);
    responseData.spj_code = spjCode;
  }

  return c.json({
    success: true,
    data: responseData,
  });
});

export default internal;
