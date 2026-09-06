import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, optionalAuthMiddleware, contestAdminMiddleware, adminMiddleware } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { computeContestRatingChanges, RatingParticipant, INITIAL_RATING } from '../utils/rating';
import { sendNotification, NotificationType } from '../utils/notify';
import { recordAuditLog } from '../middleware/audit';
import { parseContestTimeToMs, effectiveContestStatus, isContestAdmin, computeFreezeWindow } from '../utils/contest-time';

const contests = new Hono<AppType>();

const contestCreateLimiter = createRateLimiter('contest_create', 10, 60_000);
const contestRegisterLimiter = createRateLimiter('contest_register', 5, 60_000);
const virtualRegisterLimiter = createRateLimiter('virtual_register', 5, 60_000);

const VALID_SCORING_TYPES = ['oi', 'icpc', 'ioi'];

function normalizeScoringType(s: any): 'oi' | 'icpc' | 'ioi' {
  if (s === 'oi') return 'oi';
  if (s === 'ioi') return 'ioi';
  return 'icpc'; // default + legacy 'acm' both map to icpc
}

// 校验比赛题目列表:problem_id 必须存在且为正整数,score 必须在 0-1000(与前端一致)
// 返回错误信息,全部合法时返回 null
async function validateContestProblems(db: D1Database, problems: any[]): Promise<string | null> {
  for (const p of problems) {
    const pid = parseInt(p.problem_id);
    if (!Number.isInteger(pid) || pid <= 0) {
      return 'problem_id must be a valid positive integer';
    }
    const score = p.score === undefined || p.score === null ? 100 : Number(p.score);
    if (!Number.isFinite(score) || score < 0 || score > 1000) {
      return 'score must be between 0 and 1000';
    }
    const exists = await db.prepare('SELECT id FROM problems WHERE id = ?').bind(pid).first();
    if (!exists) {
      return `Problem #${pid} not found`;
    }
  }
  return null;
}

// 比赛时间解析与动态状态判定见 ../utils/contest-time(parseContestTimeToMs / effectiveContestStatus)

// ── 排行榜计分核心(排行榜路由与 Rating 结算共用,保证排名一致) ──
interface RankingInput {
  submissions: any[];         // 已按时间窗过滤的提交
  participants: any[];        // 含 user_id / username / is_virtual / virtual_start_time
  contestProblems: any[];     // 含 label / problem_id / score
  scoringType: 'oi' | 'icpc' | 'ioi';
  contestStartTime: number;
  virtualStartMap: Record<number, number>;
}

function buildContestRankings(input: RankingInput): any[] {
  const { submissions, participants, contestProblems, scoringType, contestStartTime, virtualStartMap } = input;

  // Group submissions by user_id and problem_id
  const bestSubs: Record<string, any> = {};
  const lastSubs: Record<string, any> = {};   // OI: last submission per problem
  const attemptCounts: Record<string, number> = {};
  const firstAcceptedAt: Record<string, string> = {};

  for (const sub of submissions) {
    const key = `${sub.user_id}:${sub.problem_id}`;
    attemptCounts[key] = (attemptCounts[key] || 0) + 1;
    // Find best submission (ICPC and IOI both use best score)
    const existing = bestSubs[key];
    if (!existing || sub.score > existing.score || (sub.score === existing.score && sub.time_used < existing.time_used)) {
      bestSubs[key] = sub;
    }
    // OI: keep the latest submission (by created_at)
    // 注意:created_at 来自 SQLite,可能是 "YYYY-MM-DD HH:MM:SS" 格式,
    // 直接用 new Date() 在某些宿主(Node 本地开发)会按本地时区解析,导致跨午夜提交排序错乱。
    // 统一通过 parseContestTimeToMs 走 UTC 解析(M5)。
    const prevLast = lastSubs[key];
    if (!prevLast || parseContestTimeToMs(sub.created_at) > parseContestTimeToMs(prevLast.created_at)) {
      lastSubs[key] = sub;
    }
    if (sub.status === 'accepted') {
      if (!firstAcceptedAt[key] || parseContestTimeToMs(sub.created_at) < parseContestTimeToMs(firstAcceptedAt[key])) {
        firstAcceptedAt[key] = sub.created_at;
      }
    }
  }

  // Count wrong attempts before first accepted for penalty (ICPC only)
  const wrongBeforeAccepted: Record<string, number> = {};
  for (const sub of submissions) {
    const key = `${sub.user_id}:${sub.problem_id}`;
    if (firstAcceptedAt[key] && parseContestTimeToMs(sub.created_at) <= parseContestTimeToMs(firstAcceptedAt[key])) {
      if (sub.status !== 'accepted') {
        wrongBeforeAccepted[key] = (wrongBeforeAccepted[key] || 0) + 1;
      }
    }
  }

  // Build rankings
  const rankings: any[] = [];
  for (const participant of participants) {
    const userId = participant.user_id;
    const username = participant.username;
    let totalScore = 0;
    let acceptedCount = 0;
    let totalPenalty = 0; // penalty in minutes
    const problemResults: any = {};

    for (const cp of contestProblems) {
      const problemId = cp.problem_id;
      const label = cp.label;
      const score = cp.score;
      const key = `${userId}:${problemId}`;
      const bestSub = bestSubs[key];
      const attempts = attemptCounts[key] || 0;
      const wrongAttempts = wrongBeforeAccepted[key] || 0;

      if (bestSub) {
        if (scoringType === 'oi') {
          // OI: last submission counts, scored by test points
          const lastSub = lastSubs[key];
          problemResults[label] = {
            status: lastSub ? lastSub.status : bestSub.status,
            score: lastSub ? (lastSub.score || 0) : 0,
            time_used: lastSub ? (lastSub.time_used || 0) : 0,
            attempts,
            wrong_attempts: 0,
          };
          totalScore += lastSub ? (lastSub.score || 0) : 0;
        } else if (scoringType === 'ioi') {
          // IOI: best score across all attempts, no penalty
          problemResults[label] = {
            status: bestSub.status,
            score: bestSub.score || 0,
            time_used: bestSub.time_used || 0,
            attempts,
            wrong_attempts: wrongAttempts,
          };
          totalScore += bestSub.score || 0;
          if (bestSub.status === 'accepted') acceptedCount++;
        } else {
          // ICPC: best score, penalty on AC
          problemResults[label] = {
            status: bestSub.status,
            score: bestSub.score || 0,
            time_used: bestSub.time_used || 0,
            attempts,
            wrong_attempts: wrongAttempts,
          };
          if (bestSub.status === 'accepted') {
            acceptedCount++;
            totalScore += (bestSub.score != null && bestSub.score > 0) ? bestSub.score : score;
            const acTime = parseContestTimeToMs(firstAcceptedAt[key]);
            // For virtual participants, use their virtual start time as base
            const baseTime = virtualStartMap[userId] || contestStartTime;
            const timeFromStart = Math.floor((acTime - baseTime) / 60000);
            totalPenalty += timeFromStart + wrongAttempts * 20;
          } else {
            totalScore += bestSub.score > 0 ? bestSub.score : 0;
          }
        }
      } else {
        problemResults[label] = null;
      }
    }

    rankings.push({
      user_id: userId,
      username,
      is_virtual: participant.is_virtual || 0,
      virtual_start_time: participant.virtual_start_time || null,
      total_score: totalScore,
      accepted_count: acceptedCount,
      total_penalty: totalPenalty,
      problems: problemResults,
    });
  }

  rankings.sort((a, b) => {
    if (b.total_score !== a.total_score) return b.total_score - a.total_score;
    return a.total_penalty - b.total_penalty;
  });

  // Assign ranks (1-based; ties share rank, next rank skips)
  let prevScore: number | null = null;
  let prevPenalty: number | null = null;
  let prevRank = 0;
  for (let i = 0; i < rankings.length; i++) {
    const r = rankings[i];
    if (prevScore === null || r.total_score !== prevScore || r.total_penalty !== prevPenalty) {
      prevRank = i + 1;
    }
    r.rank = prevRank;
    prevScore = r.total_score;
    prevPenalty = r.total_penalty;
  }

  return rankings;
}

// List contests
contests.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const status = c.req.query('status');
  const offset = (page - 1) * pageSize;

  let query = 'SELECT c.*, u.username as creator_name FROM contests c JOIN users u ON c.created_by = u.id WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as total FROM contests WHERE 1=1';
  const binds: any[] = [];
  const countBinds: any[] = [];

  // 公开比赛列表:始终限定 is_public = 1,避免非公开比赛泄露
  query += ' AND c.is_public = 1';
  countQuery += ' AND is_public = 1';

  // status 筛选按当前时间动态判断,不依赖可能过期的 status 静态字段
  if (status === 'upcoming') {
    query += ' AND datetime(c.start_time) > datetime(\'now\')';
    countQuery += " AND datetime(start_time) > datetime('now')";
  } else if (status === 'running') {
    query += " AND datetime(c.start_time) <= datetime('now') AND datetime(c.end_time) > datetime('now')";
    countQuery += " AND datetime(start_time) <= datetime('now') AND datetime(end_time) > datetime('now')";
  } else if (status === 'ended') {
    query += " AND datetime(c.end_time) <= datetime('now')";
    countQuery += " AND datetime(end_time) <= datetime('now')";
  }

  query += ' ORDER BY c.start_time DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  // 每条附加服务器时间动态计算的 effective_status,前端以服务端时间为准判断状态
  const contests = (results.results as any[]).map((c: any) => ({
    ...c,
    effective_status: effectiveContestStatus(c),
  }));

  return c.json({
    success: true,
    data: {
      contests,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /contests/ical — 导出当前用户已报名比赛的 ICS 日历文件
// 注意:必须注册在 /:id 通配路由之前,否则 /ical 会被 /:id 抓住(id="ical")导致 404。
contests.get('/ical', authMiddleware, async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.title, c.start_time, c.end_time, c.description
     FROM contests c JOIN contest_participants cp ON c.id = cp.contest_id
     WHERE cp.user_id = ? AND cp.is_virtual = 0
     ORDER BY c.start_time ASC`
  ).bind(user.userId).all();

  // ICS 转义:逗号/分号/换行/反斜杠
  const esc = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  // 转 UTC 格式 YYYYMMDDTHHMMSSZ
  const toUtc = (t: string) => {
    const d = new Date(parseContestTimeToMs(t));
    return isNaN(d.getTime())
      ? ''
      : d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  const nowIso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const events = (rows.results as any[])
    .filter((r) => toUtc(r.start_time) && toUtc(r.end_time))
    .map((r) => {
      const lines = [
        'BEGIN:VEVENT',
        `UID:contest-${r.id}@oj`,
        `DTSTAMP:${nowIso}`,
        `DTSTART:${toUtc(r.start_time)}`,
        `DTEND:${toUtc(r.end_time)}`,
        `SUMMARY:${esc(r.title)}`,
        `DESCRIPTION:${esc(r.description || '')}`,
        'END:VEVENT',
      ];
      return lines.join('\r\n');
    })
    .join('\r\n');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OJ System//Contests//ZH-CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    events,
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  c.header('Content-Type', 'text/calendar; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="my-contests.ics"');
  c.header('Cache-Control', 'no-store');
  return c.body(ics);
});

// Get contest detail
// 公开比赛详情,但需识别已登录用户以返回正确的 is_registered(可选鉴权)
contests.get('/:id', optionalAuthMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);
  const contest = await c.env.DB.prepare(
    'SELECT c.*, u.username as creator_name FROM contests c JOIN users u ON c.created_by = u.id WHERE c.id = ?'
  ).bind(id).first();

  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // Server-side computed fields
  const effective_status = effectiveContestStatus(contest);

  // Participant count
  const pc = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM contest_participants WHERE contest_id = ?').bind(id).first();
  const participant_count = (pc as any)?.cnt || 0;

  // is_registered / is_virtual if user present
  let is_registered = false;
  let is_virtual = false;
  const user = c.get('user');
  if (user) {
    const reg: any = await c.env.DB.prepare('SELECT id, is_virtual FROM contest_participants WHERE contest_id = ? AND user_id = ?').bind(id, user.userId).first();
    is_registered = !!reg;
    is_virtual = !!(reg && reg.is_virtual);
  }

  // 私有比赛(is_public=0)仅管理员或已报名参与者可见,避免按 ID 泄露
  const isAdmin = isContestAdmin(user);
  if ((contest as any).is_public !== 1 && !isAdmin && !is_registered) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // problems_visible: reuse same logic as problems endpoint
  const problems_visible = (() => {
    if (!contest) return 0;
    if (effective_status === 'running') return (isAdmin || is_registered) ? 1 : 0;
    if (effective_status === 'upcoming') return isAdmin ? 1 : 0;
    // ended: visible
    return 1;
  })();

  const server_time = new Date().toISOString();

  return c.json({ success: true, data: { contest, effective_status, participant_count, is_registered, is_virtual, problems_visible, server_time } });
});

// Create contest (admin only)
contests.post('/', authMiddleware, contestAdminMiddleware, contestCreateLimiter, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { title, description, start_time, end_time, is_public, problems, scoring_type, is_rated, allow_virtual, duration_minutes, freeze_minutes } = body;

  if (!title || !start_time || !end_time) {
    return c.json({ success: false, error: { message: 'title, start_time, end_time are required', code: 'BAD_REQUEST' } }, 400);
  }

  if (freeze_minutes !== undefined && (!Number.isInteger(freeze_minutes) || freeze_minutes < 0)) {
    return c.json({ success: false, error: { message: 'freeze_minutes must be a non-negative integer', code: 'BAD_REQUEST' } }, 400);
  }

  if (title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }

  if (description && description.length > 5000) {
    return c.json({ success: false, error: { message: 'description must be at most 5000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  // 时间校验统一通过 parseContestTimeToMs 走 UTC 解析(M6):
  // 直接用 new Date(...) 解析带时间戳或空格分隔的字符串时行为依赖宿主时区,
  // 与入库后读回使用的 parseContestTimeToMs 可能不一致,导致校验通过但实际时间错位。
  const startMs = parseContestTimeToMs(start_time);
  const endMs = parseContestTimeToMs(end_time);
  if (!isFinite(startMs) || !isFinite(endMs)) {
    return c.json({ success: false, error: { message: 'invalid start_time or end_time', code: 'BAD_REQUEST' } }, 400);
  }
  if (startMs >= endMs) {
    return c.json({ success: false, error: { message: 'start_time must be before end_time', code: 'BAD_REQUEST' } }, 400);
  }

  if (problems && Array.isArray(problems) && problems.length > 26) {
    return c.json({ success: false, error: { message: 'problems array must have at most 26 items', code: 'BAD_REQUEST' } }, 400);
  }

  const finalScoringType = normalizeScoringType(scoring_type);

  // 规范化存储为 ISO 字符串,确保后续读回与 parseContestTimeToMs 解析一致
  const startTimeIso = new Date(startMs).toISOString();
  const endTimeIso = new Date(endMs).toISOString();
  const now = Date.now();
  let status = 'upcoming';
  if (now >= startMs && now < endMs) status = 'running';
  if (now >= endMs) status = 'ended';

  const result = await c.env.DB.prepare(
    'INSERT INTO contests (title, description, start_time, end_time, status, is_public, created_by, scoring_type, is_rated, allow_virtual, duration_minutes, freeze_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    title,
    description || '',
    startTimeIso,
    endTimeIso,
    status,
    is_public ?? 1,
    user.userId,
    finalScoringType,
    is_rated ? 1 : 0,
    allow_virtual === false ? 0 : 1,
    duration_minutes ?? null,
    freeze_minutes ?? 0,
  ).run();

  const contestId = result.meta.last_row_id;

  // Add problems to contest
  if (problems && Array.isArray(problems)) {
    const problemErr = await validateContestProblems(c.env.DB, problems);
    if (problemErr) {
      return c.json({ success: false, error: { message: problemErr, code: 'BAD_REQUEST' } }, 400);
    }
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      const label = String.fromCharCode(65 + i); // A, B, C...
      await c.env.DB.prepare(
        'INSERT INTO contest_problems (contest_id, problem_id, label, score) VALUES (?, ?, ?, ?)'
      ).bind(contestId, p.problem_id, p.label || label, p.score || 100).run();
    }
  }

  await recordAuditLog(c, 'contest:create', user.userId, user.username);

  return c.json({ success: true, data: { id: contestId, message: 'Contest created' } }, 201);
});

// POST /contests/:id/clone — 克隆比赛(admin):复制比赛字段 + 题目关联
// 已结束的比赛时间自动顺延到未来,避免克隆出已结束的比赛
contests.post('/:id/clone', authMiddleware, contestAdminMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const source: any = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!source) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // 计算新时间:原比赛未结束则沿用,已结束则顺延(时长保持一致)
  const nowMs = Date.now();
  const startMs = parseContestTimeToMs(source.start_time);
  const endMs = parseContestTimeToMs(source.end_time);
  const durationMs = Math.max(0, endMs - startMs);
  let newStartIso = source.start_time;
  let newEndIso = source.end_time;
  if (endMs <= nowMs) {
    newStartIso = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(); // 明天开始
    newEndIso = new Date(nowMs + 24 * 60 * 60 * 1000 + durationMs).toISOString();
  }

  const newTitle = `${source.title}（副本）`;
  const result = await c.env.DB.prepare(
    `INSERT INTO contests (title, description, start_time, end_time, status, is_public, created_by, scoring_type, is_rated, allow_virtual, duration_minutes, freeze_minutes)
     VALUES (?, ?, ?, ?, 'upcoming', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    newTitle,
    source.description || '',
    newStartIso,
    newEndIso,
    source.is_public,
    user.userId,
    source.scoring_type,
    source.is_rated,
    source.allow_virtual,
    source.duration_minutes,
    source.freeze_minutes || 0,
  ).run();
  const newId = result.meta.last_row_id;

  // 复制题目关联
  const problems = await c.env.DB.prepare(
    'SELECT problem_id, label, score FROM contest_problems WHERE contest_id = ? ORDER BY label'
  ).bind(id).all();
  if (problems.results.length > 0) {
    const stmts = (problems.results as any[]).map((p) =>
      c.env.DB.prepare(
        'INSERT INTO contest_problems (contest_id, problem_id, label, score) VALUES (?, ?, ?, ?)'
      ).bind(newId, p.problem_id, p.label, p.score)
    );
    await c.env.DB.batch(stmts);
  }

  await recordAuditLog(c, 'contest:clone', user.userId, user.username);

  return c.json({ success: true, data: { id: newId, title: newTitle, message: 'Contest cloned' } }, 201);
});

// Update contest (admin only)
contests.put('/:id', authMiddleware, contestAdminMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);
  const body = await c.req.json();
  const { title, description, start_time, end_time, is_public, status, scoring_type, is_rated, allow_virtual, duration_minutes, freeze_minutes } = body;

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  if (freeze_minutes !== undefined && (!Number.isInteger(freeze_minutes) || freeze_minutes < 0)) {
    return c.json({ success: false, error: { message: 'freeze_minutes must be a non-negative integer', code: 'BAD_REQUEST' } }, 400);
  }

  // 与创建接口一致的时间校验:统一通过 parseContestTimeToMs 走 UTC 解析(M6),
  // 避免宿主时区差异导致校验与实际存储错位。
  // 由于允许单独更新 start_time 或 end_time,需取最终值再比较。
  const curStartMs = parseContestTimeToMs((contest as any).start_time);
  const curEndMs = parseContestTimeToMs((contest as any).end_time);
  const newStartMs = start_time !== undefined ? parseContestTimeToMs(start_time) : curStartMs;
  const newEndMs = end_time !== undefined ? parseContestTimeToMs(end_time) : curEndMs;
  if (!isFinite(newStartMs) || !isFinite(newEndMs)) {
    return c.json({ success: false, error: { message: 'invalid start_time or end_time', code: 'BAD_REQUEST' } }, 400);
  }
  if (newStartMs >= newEndMs) {
    return c.json({ success: false, error: { message: 'start_time must be before end_time', code: 'BAD_REQUEST' } }, 400);
  }
  if (title !== undefined && title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (description !== undefined && description.length > 5000) {
    return c.json({ success: false, error: { message: 'description must be at most 5000 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (body.problems && Array.isArray(body.problems) && body.problems.length > 26) {
    return c.json({ success: false, error: { message: 'problems array must have at most 26 items', code: 'BAD_REQUEST' } }, 400);
  }

  const updates: string[] = [];
  const binds: any[] = [];

  if (title !== undefined) { updates.push('title = ?'); binds.push(title); }
  if (description !== undefined) { updates.push('description = ?'); binds.push(description); }
  // 规范化为 ISO 字符串后再入库,与创建接口一致,避免后续读回时解析不一致
  if (start_time !== undefined) { updates.push('start_time = ?'); binds.push(new Date(newStartMs).toISOString()); }
  if (end_time !== undefined) { updates.push('end_time = ?'); binds.push(new Date(newEndMs).toISOString()); }
  if (is_public !== undefined) { updates.push('is_public = ?'); binds.push(is_public); }
  if (status !== undefined) { updates.push('status = ?'); binds.push(status); }
  if (scoring_type !== undefined) { updates.push('scoring_type = ?'); binds.push(normalizeScoringType(scoring_type)); }
  if (is_rated !== undefined) { updates.push('is_rated = ?'); binds.push(is_rated ? 1 : 0); }
  if (allow_virtual !== undefined) { updates.push('allow_virtual = ?'); binds.push(allow_virtual ? 1 : 0); }
  if (duration_minutes !== undefined) { updates.push('duration_minutes = ?'); binds.push(duration_minutes); }
  if (freeze_minutes !== undefined) { updates.push('freeze_minutes = ?'); binds.push(freeze_minutes); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    binds.push(id);
    await c.env.DB.prepare(`UPDATE contests SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  }

  // Update problems if provided (原子性:先删后插在同一 batch 中)
  if (body.problems && Array.isArray(body.problems)) {
    const problemErr = await validateContestProblems(c.env.DB, body.problems);
    if (problemErr) {
      return c.json({ success: false, error: { message: problemErr, code: 'BAD_REQUEST' } }, 400);
    }
    const stmts = [c.env.DB.prepare('DELETE FROM contest_problems WHERE contest_id = ?').bind(id)];
    for (let i = 0; i < body.problems.length; i++) {
      const p = body.problems[i];
      const label = String.fromCharCode(65 + i);
      stmts.push(c.env.DB.prepare(
        'INSERT INTO contest_problems (contest_id, problem_id, label, score) VALUES (?, ?, ?, ?)'
      ).bind(id, p.problem_id, p.label || label, p.score || 100));
    }
    await c.env.DB.batch(stmts);
  }

  await recordAuditLog(c, 'contest:update', user.userId, user.username);

  return c.json({ success: true, data: { message: 'Contest updated' } });
});

// Delete contest (admin only)
contests.delete('/:id', authMiddleware, contestAdminMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  // 已结算的 Rated 比赛禁止删除:其 rating_changes/submissions.contest_id 为 ON DELETE SET NULL,
  // 删除会导致 Rating 历史脱钩(用户 Rating 保留但无法追溯来源)
  const contest: any = await c.env.DB.prepare('SELECT is_rated, rating_finalized FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }
  if (contest.is_rated === 1 && contest.rating_finalized === 1) {
    return c.json({ success: false, error: { message: 'Cannot delete a contest whose ratings have been finalized', code: 'BAD_REQUEST' } }, 400);
  }

  await c.env.DB.prepare('DELETE FROM contests WHERE id = ?').bind(id).run();
  await recordAuditLog(c, 'contest:delete', user.userId, user.username);
  return c.json({ success: true, data: { message: 'Contest deleted' } });
});

// Get contest problems
contests.get('/:id/problems', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // Check if user is participant or admin
  const isAdmin = isContestAdmin(user);
  const isParticipant = !!(await c.env.DB.prepare(
    'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
  ).bind(id, user.userId).first());

  // 按当前时间动态判定,避免 status 字段过期导致拦截失效
  const contestStatus = effectiveContestStatus(contest);
  const isRunning = contestStatus === 'running';
  const isEnded = contestStatus === 'ended';

  // Only participants (or admin) can see problems during running contest
  if (isRunning && !isAdmin && !isParticipant) {
    return c.json({ success: false, error: { message: 'You must register for this contest first', code: 'FORBIDDEN' } }, 403);
  }

  // During upcoming contest, only admin can see problems
  if (contestStatus === 'upcoming' && !isAdmin) {
    return c.json({ success: false, error: { message: 'Contest has not started yet', code: 'FORBIDDEN' } }, 403);
  }

  const problems = await c.env.DB.prepare(
    `SELECT cp.label, cp.score, p.id, p.title, p.slug, p.difficulty, p.tags, p.time_limit, p.memory_limit,
            (SELECT COUNT(*) FROM submissions WHERE problem_id = p.id AND status = 'accepted') as accepted_count,
            (SELECT COUNT(*) FROM submissions WHERE problem_id = p.id) as submission_count
     FROM contest_problems cp JOIN problems p ON cp.problem_id = p.id
     WHERE cp.contest_id = ? ORDER BY cp.label`
  ).bind(id).all();

  // If contest is running, include sample testcases
  // If ended, include all testcases
  return c.json({ success: true, data: { problems: problems.results } });
});

// Get a single contest problem detail (protected by contest status:
// upcoming invisible, running requires registration)
contests.get('/:id/problems/:slug', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);
  const slug = c.req.param('slug')!;

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const isAdmin = isContestAdmin(user);
  const isParticipant = !!(await c.env.DB.prepare(
    'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
  ).bind(id, user.userId).first());

  // 按当前时间动态判定,避免 status 字段过期导致拦截失效
  const contestStatus = effectiveContestStatus(contest);
  if (contestStatus === 'upcoming' && !isAdmin) {
    return c.json({ success: false, error: { message: 'Contest has not started yet', code: 'FORBIDDEN' } }, 403);
  }
  if (contestStatus === 'running' && !isAdmin && !isParticipant) {
    return c.json({ success: false, error: { message: 'You must register for this contest first', code: 'FORBIDDEN' } }, 403);
  }

  const problem = await c.env.DB.prepare(
    `SELECT cp.label, cp.score, p.id, p.title, p.slug, p.description, p.input_format,
            p.output_format, p.time_limit, p.memory_limit, p.difficulty, p.tags, p.judge_type
     FROM contest_problems cp JOIN problems p ON cp.problem_id = p.id
     WHERE cp.contest_id = ? AND ${/^\d+$/.test(slug) ? 'p.id' : 'p.slug'} = ?`
  ).bind(id, /^\d+$/.test(slug) ? parseInt(slug) : slug).first();

  if (!problem) {
    return c.json({ success: false, error: { message: 'Problem not found in this contest', code: 'NOT_FOUND' } }, 404);
  }

  return c.json({ success: true, data: { problem } });
});

// Register for contest
contests.post('/:id/register', authMiddleware, contestRegisterLimiter, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const contestStatus = effectiveContestStatus(contest);
  if (contestStatus === 'ended') {
    return c.json({ success: false, error: { message: 'Contest has ended', code: 'BAD_REQUEST' } }, 400);
  }

  // 私有比赛(is_public=0)仅管理员可报名,避免通过 API 绕过前端入口参加私有比赛
  const isAdmin = isContestAdmin(user);
  if ((contest as any).is_public !== 1 && !isAdmin) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // 原子报名:依赖 contest_participants 上的 UNIQUE(contest_id, user_id) 约束,
  // 并发双请求时第二个 INSERT 冲突被吞掉(changes=0),返回友好 400 而非 500
  const result = await c.env.DB.prepare(
    'INSERT INTO contest_participants (contest_id, user_id) VALUES (?, ?) ON CONFLICT(contest_id, user_id) DO NOTHING'
  ).bind(id, user.userId).run();

  if (result.meta.changes === 0) {
    return c.json({ success: false, error: { message: 'Already registered', code: 'BAD_REQUEST' } }, 400);
  }

  return c.json({ success: true, data: { message: 'Registered successfully' } });
});

// Get contest rankings/leaderboard
contests.get('/:id/rankings', optionalAuthMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // 私有比赛(is_public=0)仅管理员或已报名参与者可见,避免按 ID 泄露
  const user = c.get('user');
  const isAdmin = isContestAdmin(user);
  if ((contest as any).is_public !== 1 && !isAdmin) {
    const registered = user ? await c.env.DB.prepare(
      'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
    ).bind(id, user.userId).first() : null;
    if (!registered) {
      return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
    }
  }

  const scoringType = normalizeScoringType((contest as any).scoring_type);
  const onlyVirtual = c.req.query('virtual') === '1';
  // 排行榜分页(默认全量:pageSize=0 表示不分页)
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.max(0, parseInt(c.req.query('pageSize') || '0'));

  // Get all participants (optionally only virtual)
  let participantsQuery = 'SELECT cp.user_id, cp.is_virtual, cp.virtual_start_time, u.username FROM contest_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.contest_id = ?';
  if (onlyVirtual) participantsQuery += ' AND cp.is_virtual = 1';
  else participantsQuery += ' AND cp.is_virtual = 0';
  const participants = await c.env.DB.prepare(participantsQuery).bind(id).all();

  // Get contest problems
  const contestProblems = await c.env.DB.prepare(
    'SELECT cp.label, cp.problem_id, cp.score FROM contest_problems cp WHERE cp.contest_id = ? ORDER BY cp.label'
  ).bind(id).all();

  if (participants.results.length === 0 || contestProblems.results.length === 0) {
    return c.json({ success: true, data: { rankings: [], problems: contestProblems.results, scoring_type: scoringType } });
  }

  // Batch query: get ALL submissions for counting attempts, and best for each
  const userIds = participants.results.map((p: any) => p.user_id);
  const problemIds = contestProblems.results.map((p: any) => p.problem_id);

  const placeholders = userIds.map(() => '?').join(',');
  const problemPlaceholders = problemIds.map(() => '?').join(',');

  // 封榜:比赛进行中且已进入冻结期(freeze_minutes 内)时,排行榜只统计冻结前的提交,
  // 冻结后的评测结果对排行榜不可见(比赛结束后自动解禁)
  const { boardFrozen, rankingEndIso: rankingEndTime } = computeFreezeWindow(contest as any);

  // 按参与者类型取提交窗口:
  // - 真实参赛者:使用比赛 [start_time, rankingEndTime](封榜时上限为冻结时间)
  // - 虚拟参赛者:虚拟开始时间在比赛结束后,提交晚于 end_time,不能套用比赛时间窗
  //   (否则 created_at <= end_time 会把虚拟提交全部过滤掉),故下限取最早的
  //   virtual_start_time,上限为最早的 virtual_start + duration_minutes(若有时长设置)
  let subLowerBound: string;
  let subUpperBound: string | null;
  if (onlyVirtual) {
    const virtualStarts = participants.results
      .map((p: any) => p.virtual_start_time)
      .filter((v: any) => !!v)
      .sort();
    subLowerBound = virtualStarts[0] || (contest as any).start_time;
    // 虚拟参赛时长限制:duration_minutes 设置后,提交窗口上限 = 最早虚拟开始时间 + 时长
    const virtualDurationMinutes = parseInt((contest as any).duration_minutes) || 0;
    if (virtualDurationMinutes > 0) {
      const virtualEndMs = parseContestTimeToMs(subLowerBound) + virtualDurationMinutes * 60000;
      subUpperBound = new Date(virtualEndMs).toISOString();
    } else {
      subUpperBound = null;
    }
  } else {
    subLowerBound = (contest as any).start_time;
    subUpperBound = rankingEndTime;
  }

  let subQuery = `SELECT id, user_id, problem_id, status, score, time_used, created_at FROM submissions
     WHERE user_id IN (${placeholders}) AND problem_id IN (${problemPlaceholders})
     AND contest_id = ?
     AND status != 'pending' AND status != 'running'
     AND datetime(created_at) >= datetime(?)`;
  const subBinds: any[] = [...userIds, ...problemIds, id, subLowerBound];
  if (subUpperBound) {
    subQuery += ' AND datetime(created_at) <= datetime(?)';
    subBinds.push(subUpperBound);
  }
  const allSubmissions = await c.env.DB.prepare(subQuery).bind(...subBinds).all();

  // 计分核心复用共享函数 buildContestRankings(与 Rating 结算一致)
  const contestStartTime = parseContestTimeToMs((contest as any).start_time);

  // Build per-participant virtual start time lookup (for virtual penalty calc)
  const virtualStartMap: Record<number, number> = {};
  for (const p of participants.results as any[]) {
    if (p.is_virtual && p.virtual_start_time) {
      virtualStartMap[p.user_id] = parseContestTimeToMs(p.virtual_start_time);
    }
  }

  const rankings = buildContestRankings({
    submissions: allSubmissions.results as any[],
    participants: participants.results as any[],
    contestProblems: contestProblems.results as any[],
    scoringType,
    contestStartTime,
    virtualStartMap,
  });

  // OI 赛制赛时:隐藏每题得分/状态与排名(保留行但清空可比字段,避免通过 rank 顺序泄漏强弱)
  // 比赛结束后自动解禁
  const oiRunning = scoringType === 'oi' && effectiveContestStatus(contest) === 'running';
  if (oiRunning) {
    for (const r of rankings) {
      r.rank = null;
      r.total_score = null;
      r.accepted_count = null;
      r.total_penalty = null;
      const probs: any = r.problems;
      for (const label of Object.keys(probs || {})) {
        if (probs[label]) {
          probs[label] = { ...probs[label], status: 'pending', score: null, time_used: null };
        }
      }
    }
  }

  // 排行榜分页:pageSize > 0 时按页切片,否则全量返回
  const totalRankings = rankings.length;
  let pageRankings = rankings;
  let pagination: any = null;
  if (pageSize > 0) {
    const offset = (page - 1) * pageSize;
    pageRankings = rankings.slice(offset, offset + pageSize);
    pagination = {
      page,
      pageSize,
      total: totalRankings,
      totalPages: Math.max(1, Math.ceil(totalRankings / pageSize)),
    };
  }

  return c.json({
    success: true,
    data: {
      rankings: pageRankings,
      problems: contestProblems.results,
      scoring_type: scoringType,
      is_rated: (contest as any).is_rated || 0,
      rating_finalized: (contest as any).rating_finalized || 0,
      result_hidden: oiRunning ? 1 : 0,
      board_frozen: boardFrozen ? 1 : 0,
      pagination,
    },
  });
});

// GET /contests/:id/certificate — 生成当前用户的比赛成绩证书(SVG→PNG)
// 需要:比赛已结束且用户已报名(有 final_rank)
contests.get('/:id/certificate', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const contest: any = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }
  if (effectiveContestStatus(contest) !== 'ended') {
    return c.json({ success: false, error: { message: 'Certificate is only available after the contest ends', code: 'BAD_REQUEST' } }, 400);
  }

  const participant: any = await c.env.DB.prepare(
    'SELECT cp.final_rank, cp.is_virtual, u.username FROM contest_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.contest_id = ? AND cp.user_id = ? AND cp.is_virtual = 0'
  ).bind(id, user.userId).first();
  if (!participant || participant.final_rank == null) {
    return c.json({ success: false, error: { message: 'No rank recorded for this contest', code: 'NOT_FOUND' } }, 404);
  }

  const escXml = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rank = participant.final_rank;
  const medalText = rank === 1 ? '🏆 冠军' : rank === 2 ? '🥈 亚军' : rank === 3 ? '🥉 季军' : `第 ${rank} 名`;
  const medalColor = rank === 1 ? '#f5a623' : rank === 2 ? '#8a8f98' : rank === 3 ? '#c08a4e' : '#4f6ef7';
  const title = contest.title || 'OJ Contest';
  const username = participant.username || user.username;
  const dateStr = new Date(parseContestTimeToMs(contest.end_time)).toLocaleDateString('zh-CN');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520" viewBox="0 0 800 520">
  <rect width="800" height="520" fill="#faf8f4"/>
  <rect x="24" y="24" width="752" height="472" fill="none" stroke="${medalColor}" stroke-width="4"/>
  <rect x="36" y="36" width="728" height="448" fill="none" stroke="${medalColor}" stroke-width="1" stroke-dasharray="6 4"/>
  <text x="400" y="120" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#888">成绩证书</text>
  <text x="400" y="180" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#222">${escXml(title)}</text>
  <text x="400" y="250" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#444">${escXml(username)}</text>
  <text x="400" y="320" text-anchor="middle" font-family="sans-serif" font-size="36" font-weight="bold" fill="${medalColor}">${medalText}</text>
  <text x="400" y="390" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#999">比赛日期:${escXml(dateStr)}</text>
  <text x="400" y="440" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#bbb">— OJ System —</text>
</svg>`;

  const { svgToPng } = await import('../utils/captcha');
  const pngBytes = await svgToPng(svg);
  // Uint8Array 需转为 ArrayBuffer 以满足 Hono BodyInit 类型
  const pngBuffer = pngBytes.slice().buffer as ArrayBuffer;

  c.header('Content-Type', 'image/png');
  c.header('Content-Disposition', `attachment; filename="certificate-${id}-${user.userId}.png"`);
  c.header('Cache-Control', 'no-store');
  return c.body(pngBuffer);
});

// GET /contests/:id/rankings/export — 导出排行榜 CSV(与 rankings 端点同数据口径)
contests.get('/:id/rankings/export', optionalAuthMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // 私有比赛(is_public=0)仅管理员或已报名参与者可见,与 rankings 端点一致
  const user = c.get('user');
  const isAdmin = isContestAdmin(user);
  if ((contest as any).is_public !== 1 && !isAdmin) {
    const registered = user ? await c.env.DB.prepare(
      'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
    ).bind(id, user.userId).first() : null;
    if (!registered) {
      return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
    }
  }

  const scoringType = normalizeScoringType((contest as any).scoring_type);

  // CSV 仅导出真实参赛者(与 rankings/image 端点一致);
  // 虚拟参赛者提交发生在比赛结束后,会被时间窗过滤而显示 0 分,不应出现在榜单中
  const participants = await c.env.DB.prepare(
    `SELECT cp.user_id, cp.is_virtual, cp.virtual_start_time, u.username FROM contest_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.contest_id = ? AND cp.is_virtual = 0`
  ).bind(id).all();
  const contestProblems = await c.env.DB.prepare(
    'SELECT cp.label, cp.problem_id, cp.score FROM contest_problems cp WHERE cp.contest_id = ? ORDER BY cp.label'
  ).bind(id).all();

  // 封榜与时间窗口逻辑统一走 computeFreezeWindow,与 rankings 端点一致
  const { boardFrozen, rankingEndIso } = computeFreezeWindow(contest as any);

  const userIds = participants.results.map((p: any) => p.user_id);
  const problemIds = contestProblems.results.map((p: any) => p.problem_id);
  const placeholders = userIds.map(() => '?').join(',');
  const problemPlaceholders = problemIds.map(() => '?').join(',');

  const subLowerBound = (contest as any).start_time;
  const subQuery = `SELECT id, user_id, problem_id, status, score, time_used, created_at FROM submissions
     WHERE user_id IN (${placeholders}) AND problem_id IN (${problemPlaceholders})
     AND contest_id = ?
     AND status != 'pending' AND status != 'running'
     AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`;
  const allSubmissions = await c.env.DB.prepare(subQuery)
    .bind(...userIds, ...problemIds, id, subLowerBound, rankingEndIso).all();

  const virtualStartMap: Record<number, number> = {};
  for (const p of participants.results as any[]) {
    if (p.is_virtual && p.virtual_start_time) {
      virtualStartMap[p.user_id] = parseContestTimeToMs(p.virtual_start_time);
    }
  }

  const rankings = buildContestRankings({
    submissions: allSubmissions.results as any[],
    participants: participants.results as any[],
    contestProblems: contestProblems.results as any[],
    scoringType,
    contestStartTime: parseContestTimeToMs((contest as any).start_time),
    virtualStartMap,
  });

  // 构建 CSV
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const labels = (contestProblems.results as any[]).map((p: any) => p.label);
  const header = ['rank', 'username', 'user_id', 'total_score', 'accepted_count', 'total_penalty', ...labels];
  const rows = rankings.map((r: any) => {
    const cells = [r.rank, r.username, r.user_id, r.total_score, r.accepted_count, r.total_penalty];
    for (const label of labels) {
      const pr = (r.problems || {})[label];
      cells.push(pr ? `${pr.status}:${pr.score ?? 0}` : '');
    }
    return cells.map(esc).join(',');
  });
  const csv = '\uFEFF' + [header.map(esc).join(','), ...rows].join('\r\n');

  const filename = `contest-${id}-rankings.csv`;
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  c.header('Cache-Control', 'no-store');
  return c.body(csv);
});

// GET /contests/:id/rankings/image — 榜单长图(SVG→PNG,可分享)
// 与 CSV 导出同数据口径,渲染为图片便于分享
contests.get('/:id/rankings/image', optionalAuthMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // 私有比赛权限与 rankings 端点一致
  const user = c.get('user');
  const isAdmin = isContestAdmin(user);
  if ((contest as any).is_public !== 1 && !isAdmin) {
    const registered = user ? await c.env.DB.prepare(
      'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
    ).bind(id, user.userId).first() : null;
    if (!registered) {
      return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
    }
  }

  const scoringType = normalizeScoringType((contest as any).scoring_type);
  const participants = await c.env.DB.prepare(
    `SELECT cp.user_id, cp.is_virtual, cp.virtual_start_time, u.username FROM contest_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.contest_id = ? AND cp.is_virtual = 0`
  ).bind(id).all();
  const contestProblems = await c.env.DB.prepare(
    'SELECT cp.label, cp.problem_id, cp.score FROM contest_problems cp WHERE cp.contest_id = ? ORDER BY cp.label'
  ).bind(id).all();

  const userIds = participants.results.map((p: any) => p.user_id);
  const problemIds = contestProblems.results.map((p: any) => p.problem_id);
  const placeholders = userIds.map(() => '?').join(',');
  const problemPlaceholders = problemIds.map(() => '?').join(',');

  // 封榜与时间窗口逻辑统一走 computeFreezeWindow,避免绕过封榜泄露最终成绩(H1)
  const { rankingEndIso } = computeFreezeWindow(contest as any);

  const allSubmissions = await c.env.DB.prepare(
    `SELECT id, user_id, problem_id, status, score, time_used, created_at FROM submissions
     WHERE user_id IN (${placeholders}) AND problem_id IN (${problemPlaceholders})
     AND contest_id = ?
     AND status != 'pending' AND status != 'running'
     AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
  ).bind(...userIds, ...problemIds, id, (contest as any).start_time, rankingEndIso).all();

  const rankings = buildContestRankings({
    submissions: allSubmissions.results as any[],
    participants: participants.results as any[],
    contestProblems: contestProblems.results as any[],
    scoringType,
    contestStartTime: parseContestTimeToMs((contest as any).start_time),
    virtualStartMap: {},
  });

  // 渲染 SVG 长图:标题 + 排名表(最多展示 30 名)
  const escXml = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const shown = rankings.slice(0, 30);
  const labels = (contestProblems.results as any[]).map((p: any) => p.label);
  const rowH = 36;
  const headerH = 54;
  const titleH = 88;
  const padding = 32;
  const width = 720;
  const colRanks = 70;
  const colUser = 220;
  const colScore = 120;
  const colAc = 110;
  const colPenalty = scoringType === 'icpc' ? 110 : 0;
  const problemColW = Math.max(44, Math.min(72, (width - padding * 2 - colRanks - colUser - colScore - colAc - colPenalty) / Math.max(1, labels.length)));
  const height = titleH + headerH + shown.length * rowH + padding * 2;

  let rowsXml = '';
  const cellStyle = (x: number, w: number, bold = false, color = '#333') =>
    `<text x="${x}" y="${0}" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="${bold ? 600 : 400}" fill="${color}">`;
  shown.forEach((r: any, idx: number) => {
    const y = titleH + headerH + idx * rowH + rowH / 2 + 5;
    const medal = r.rank === 1 ? '#f5a623' : r.rank === 2 ? '#8a8f98' : r.rank === 3 ? '#c08a4e' : '#333';
    rowsXml += `<text x="${padding + colRanks / 2}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700" fill="${medal}">${r.rank}</text>`;
    rowsXml += `<text x="${padding + colRanks + 12}" y="${y}" font-family="sans-serif" font-size="14" fill="#222">${escXml(r.username)}</text>`;
    rowsXml += `<text x="${padding + colRanks + colUser + colScore / 2}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="600" fill="#333">${r.total_score ?? '—'}</text>`;
    rowsXml += `<text x="${padding + colRanks + colUser + colScore + colAc / 2}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#3fb950">${r.accepted_count ?? 0}</text>`;
    if (scoringType === 'icpc') {
      rowsXml += `<text x="${padding + colRanks + colUser + colScore + colAc + colPenalty / 2}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#888">${r.total_penalty ?? 0}</text>`;
    }
    labels.forEach((label: string, li: number) => {
      const pr = (r.problems || {})[label];
      const x = padding + colRanks + colUser + colScore + colAc + colPenalty + li * problemColW + problemColW / 2;
      if (pr) {
        const color = pr.status === 'accepted' ? '#3fb950' : '#f85149';
        rowsXml += `<text x="${x}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="600" fill="${color}">${pr.status === 'accepted' ? 'AC' : pr.score != null ? pr.score : '—'}</text>`;
      }
    });
    if (idx % 2 === 1) {
      rowsXml = `<rect x="${padding}" y="${titleH + headerH + idx * rowH}" width="${width - padding * 2}" height="${rowH}" fill="#f5f5f8"/>` + rowsXml;
    }
  });

  const headerY = titleH + headerH / 2 + 5;
  let headerXml = `<text x="${padding + colRanks / 2}" y="${headerY}" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="600" fill="#888">Rank</text>`;
  headerXml += `<text x="${padding + colRanks + 12}" y="${headerY}" font-family="sans-serif" font-size="13" font-weight="600" fill="#888">User</text>`;
  headerXml += `<text x="${padding + colRanks + colUser + colScore / 2}" y="${headerY}" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="600" fill="#888">Score</text>`;
  headerXml += `<text x="${padding + colRanks + colUser + colScore + colAc / 2}" y="${headerY}" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="600" fill="#888">AC</text>`;
  if (scoringType === 'icpc') {
    headerXml += `<text x="${padding + colRanks + colUser + colScore + colAc + colPenalty / 2}" y="${headerY}" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="600" fill="#888">Penalty</text>`;
  }
  labels.forEach((label: string, li: number) => {
    const x = padding + colRanks + colUser + colScore + colAc + colPenalty + li * problemColW + problemColW / 2;
    headerXml += `<text x="${x}" y="${headerY}" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="600" fill="#888">${label}</text>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${padding}" y="${48}" font-family="sans-serif" font-size="24" font-weight="700" fill="#222">${escXml((contest as any).title)}</text>
  <text x="${width - padding}" y="${48}" text-anchor="end" font-family="sans-serif" font-size="13" fill="#999">榜单 · ${scoringType.toUpperCase()}</text>
  <line x1="${padding}" y1="${titleH - 12}" x2="${width - padding}" y2="${titleH - 12}" stroke="#eee" stroke-width="1"/>
  <rect x="${padding}" y="${titleH}" width="${width - padding * 2}" height="${headerH}" fill="#f0f2f8"/>
  ${headerXml}
  ${rowsXml}
</svg>`;

  const { svgToPng } = await import('../utils/captcha');
  const pngBytes = await svgToPng(svg);
  const pngBuffer = pngBytes.slice().buffer as ArrayBuffer;

  c.header('Content-Type', 'image/png');
  c.header('Content-Disposition', `attachment; filename="contest-${id}-rankings.png"`);
  c.header('Cache-Control', 'no-store');
  return c.body(pngBuffer);
});

// Check if user is registered
contests.get('/:id/registration', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const reg: any = await c.env.DB.prepare(
    'SELECT id, is_virtual FROM contest_participants WHERE contest_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();

  return c.json({ success: true, data: { registered: !!reg, is_virtual: !!(reg && reg.is_virtual) } });
});

// Get current user's problem status in contest
contests.get('/:id/my-status', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // 与 problems 接口一致:运行中仅报名者(或管理员)可查看个人状态,避免未报名用户枚举题目标签
  const isAdmin = isContestAdmin(user);
  if (effectiveContestStatus(contest) === 'running' && !isAdmin) {
    const registered = await c.env.DB.prepare(
      'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
    ).bind(id, user.userId).first();
    if (!registered) {
      return c.json({ success: false, error: { message: 'You must register for this contest first', code: 'FORBIDDEN' } }, 403);
    }
  }

  const contestProblems = await c.env.DB.prepare(
    'SELECT cp.label, cp.problem_id, cp.score FROM contest_problems cp WHERE cp.contest_id = ? ORDER BY cp.label'
  ).bind(id).all();

  if (contestProblems.results.length === 0) {
    return c.json({ success: true, data: { problems: {} } });
  }

  const problemIds = contestProblems.results.map((p: any) => p.problem_id);
  const problemPlaceholders = problemIds.map(() => '?').join(',');

  // 查询该用户报名记录(虚拟参赛者用虚拟开始时间窗口)
  const participant = await c.env.DB.prepare(
    'SELECT is_virtual, virtual_start_time FROM contest_participants WHERE contest_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();

  let subLower: string;
  let subUpper: string;
  if ((participant as any)?.is_virtual) {
    // 虚拟参赛者:提交窗口 = [virtual_start_time, virtual_start_time + duration_minutes](有时长时)
    const vStart = parseContestTimeToMs((participant as any).virtual_start_time);
    if (!isFinite(vStart)) {
      return c.json({ success: true, data: { problems: {} } });
    }
    const vDuration = parseInt((contest as any).duration_minutes) || 0;
    subLower = new Date(vStart).toISOString();
    subUpper = vDuration > 0 ? new Date(vStart + vDuration * 60000).toISOString() : new Date().toISOString();
  } else {
    subLower = (contest as any).start_time;
    subUpper = (contest as any).end_time;
  }

  const submissions = await c.env.DB.prepare(
    `SELECT problem_id, status, score FROM submissions
     WHERE user_id = ? AND problem_id IN (${problemPlaceholders})
     AND contest_id = ?
     AND status != 'pending' AND status != 'running'
     AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
  ).bind(user.userId, ...problemIds, id, subLower, subUpper).all();

  // Build per-problem status
  const problemStatus: Record<string, { status: string; score: number; best_score: number }> = {};
  for (const cp of contestProblems.results as any[]) {
    problemStatus[cp.label] = { status: 'unattempted', score: 0, best_score: 0 };
  }

  for (const sub of submissions.results as any[]) {
    const cp = (contestProblems.results as any[]).find((p: any) => p.problem_id === sub.problem_id);
    if (!cp) continue;
    const label = cp.label;
    const existing = problemStatus[label];
    if (sub.score > existing.best_score) {
      existing.best_score = sub.score;
      existing.status = sub.status;
      existing.score = sub.score;
    } else if (existing.status === 'unattempted') {
      existing.status = sub.status;
      existing.score = sub.score;
    }
  }

  // OI 赛制赛时:不向选手泄露评测状态(保持未评测显示)
  const scoringType = normalizeScoringType((contest as any).scoring_type);
  if (scoringType === 'oi' && effectiveContestStatus(contest) === 'running') {
    for (const label of Object.keys(problemStatus)) {
      if (problemStatus[label].status !== 'unattempted') {
        problemStatus[label] = { status: 'pending', score: 0, best_score: 0 };
      }
    }
  }

  return c.json({ success: true, data: { problems: problemStatus } });
});

// === Wave C: Virtual participation ===

// POST /contests/:id/virtual-register — start a virtual participation for an ended contest
contests.post('/:id/virtual-register', authMiddleware, virtualRegisterLimiter, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((contest as any).allow_virtual !== 1) {
    return c.json({ success: false, error: { message: 'Virtual participation is disabled for this contest', code: 'FORBIDDEN' } }, 403);
  }

  // 虚拟参赛必须有明确时长(M7):若 duration_minutes 缺失或为 0,
  // 提交时间窗口将退化为无上限(见 submissions.ts),虚拟参赛者可在比赛结束后任意时间内继续提交,
  // 与"虚拟参赛 = 等效时长内重跑比赛"的语义相悖,也会污染虚拟排行榜。
  const virtualDurationMinutes = parseInt((contest as any).duration_minutes) || 0;
  if (virtualDurationMinutes <= 0) {
    return c.json({ success: false, error: { message: 'Virtual participation is disabled for this contest', code: 'FORBIDDEN' } }, 403);
  }

  // 私有比赛(is_public=0)仅管理员可虚拟参赛,避免通过 API 绕过前端入口
  const isAdmin = isContestAdmin(user);
  if ((contest as any).is_public !== 1 && !isAdmin) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // Virtual participation only makes sense for ended contests
  if (effectiveContestStatus(contest) !== 'ended') {
    return c.json({ success: false, error: { message: 'Virtual participation is only available for ended contests', code: 'BAD_REQUEST' } }, 400);
  }

  // 原子报名:依赖 UNIQUE(contest_id, user_id) 约束,并发双请求时第二个冲突
  // 被吞掉(changes=0),返回友好 400 而非 500(与普通报名一致)
  const nowIso = new Date().toISOString();
  const result = await c.env.DB.prepare(
    'INSERT INTO contest_participants (contest_id, user_id, is_virtual, virtual_start_time) VALUES (?, ?, 1, ?) ON CONFLICT(contest_id, user_id) DO NOTHING'
  ).bind(id, user.userId, nowIso).run();

  if (result.meta.changes === 0) {
    return c.json({ success: false, error: { message: 'Already registered', code: 'BAD_REQUEST' } }, 400);
  }

  return c.json({
    success: true,
    data: {
      participant_id: result.meta.last_row_id,
      virtual_start_time: nowIso,
      message: 'Virtual participation started',
    },
  });
});

// === Wave C: Rating finalization (admin) ===

// POST /contests/:id/finalize — compute rating changes for a rated contest (admin)
contests.post('/:id/finalize', authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  if ((contest as any).is_rated !== 1) {
    return c.json({ success: false, error: { message: 'This contest is not rated', code: 'BAD_REQUEST' } }, 400);
  }

  if (effectiveContestStatus(contest) !== 'ended') {
    return c.json({ success: false, error: { message: 'Contest must be ended before finalizing ratings', code: 'BAD_REQUEST' } }, 400);
  }

  if ((contest as any).rating_finalized === 1) {
    return c.json({ success: false, error: { message: 'Ratings have already been finalized', code: 'BAD_REQUEST' } }, 400);
  }

  // Fetch non-virtual participants for rating (same shape as rankings endpoint,
  // so we can reuse the shared scoring core buildContestRankings)
  const participants = await c.env.DB.prepare(
    `SELECT cp.user_id, cp.is_virtual, cp.virtual_start_time, u.username
     FROM contest_participants cp JOIN users u ON cp.user_id = u.id
     WHERE cp.contest_id = ? AND cp.is_virtual = 0`
  ).bind(id).all();

  if (participants.results.length === 0) {
    return c.json({ success: false, error: { message: 'No participants to rate', code: 'BAD_REQUEST' } }, 400);
  }

  const contestProblems = await c.env.DB.prepare(
    'SELECT cp.label, cp.problem_id, cp.score FROM contest_problems cp WHERE cp.contest_id = ? ORDER BY cp.label'
  ).bind(id).all();

  const userIds = participants.results.map((p: any) => p.user_id);
  const problemIds = contestProblems.results.map((p: any) => p.problem_id);
  const placeholders = userIds.map(() => '?').join(',');
  const problemPlaceholders = problemIds.map(() => '?').join(',');

  const allSubmissions = await c.env.DB.prepare(
    `SELECT id, user_id, problem_id, status, score, time_used, created_at FROM submissions
     WHERE user_id IN (${placeholders}) AND problem_id IN (${problemPlaceholders})
     AND status != 'pending' AND status != 'running'
     AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
  ).bind(...userIds, ...problemIds, (contest as any).start_time, (contest as any).end_time).all();

  // 复用排行榜计分核心,保证 Rating 结算排名与排行榜一致
  // (ICPC 罚时 / OI 最后一次提交 / IOI 最高分)
  const finalizeStartTime = parseContestTimeToMs((contest as any).start_time);
  const finalizeVirtualMap: Record<number, number> = {};
  for (const p of participants.results as any[]) {
    if (p.is_virtual && p.virtual_start_time) {
      finalizeVirtualMap[p.user_id] = parseContestTimeToMs(p.virtual_start_time);
    }
  }
  const finalizeRankings = buildContestRankings({
    submissions: allSubmissions.results as any[],
    participants: participants.results as any[],
    contestProblems: contestProblems.results as any[],
    scoringType: normalizeScoringType((contest as any).scoring_type),
    contestStartTime: finalizeStartTime,
    virtualStartMap: finalizeVirtualMap,
  });

  // 只保留有提交的参与者(未提交代码的不计入 Rating 结算)
  const submittedUserIds = new Set((allSubmissions.results as any[]).map((s: any) => s.user_id));
  // 关键修正(H3):过滤掉零提交者后必须重新分配 rank。
  // 否则弃赛选手占用前排名次,真实参赛者的名次会被抬高,导致 Rating delta 被错误拉低。
  // finalizeRankings 已按 (total_score DESC, total_penalty ASC) 排序,过滤后相对次序保留,
  // 故只需在过滤后的子集上重走标准的并列排名算法即可。
  const rankedFinalists = finalizeRankings.filter((r: any) => submittedUserIds.has(r.user_id));
  let prevScore: number | null = null;
  let prevPenalty: number | null = null;
  let prevRank = 0;
  for (let i = 0; i < rankedFinalists.length; i++) {
    const r = rankedFinalists[i];
    if (prevScore === null || r.total_score !== prevScore || r.total_penalty !== prevPenalty) {
      prevRank = i + 1;
    }
    r.rank = prevRank;
    prevScore = r.total_score;
    prevPenalty = r.total_penalty;
  }
  const ranked: { user_id: number; rank: number }[] = rankedFinalists.map((r: any) => ({
    user_id: r.user_id,
    rank: r.rank,
  }));

  if (ranked.length === 0) {
    return c.json({ success: false, error: { message: 'No participants with submissions to rate', code: 'BAD_REQUEST' } }, 400);
  }

  // Fetch pre-contest ratings for all participants
  const userIdList = ranked.map((r) => r.user_id);
  const ratingPlaceholders = userIdList.map(() => '?').join(',');
  const ratingRows = await c.env.DB.prepare(
    `SELECT user_id, rating FROM user_ratings WHERE user_id IN (${ratingPlaceholders})`
  ).bind(...userIdList).all();

  const ratingMap: Map<number, number> = new Map();
  for (const r of ratingRows.results as any[]) {
    ratingMap.set(r.user_id, r.rating);
  }
  // For users without a row, default to INITIAL_RATING (0)
  for (const uid of userIdList) {
    if (!ratingMap.has(uid)) ratingMap.set(uid, INITIAL_RATING);
  }

  // Fetch past ratings (recent 5) per user for first-time-participant seeding
  const pastRatingsMap: Map<number, number[]> = new Map();
  for (const uid of userIdList) {
    const past = await c.env.DB.prepare(
      'SELECT new_rating FROM rating_changes WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
    ).bind(uid).all();
    pastRatingsMap.set(uid, (past.results as any[]).map((r) => r.new_rating).reverse());
  }

  // Build participants array for the algorithm
  const ratingParticipants: RatingParticipant[] = ranked.map((r) => ({
    user_id: r.user_id,
    rating: ratingMap.get(r.user_id) ?? INITIAL_RATING,
    rank: r.rank,
  }));

  // Compute changes
  const changes = computeContestRatingChanges(ratingParticipants, pastRatingsMap);

  // 原子抢占结算标记:条件更新保证并发请求仅一个能通过(另一个直接返回已结算)
  const claimResult = await c.env.DB.prepare(
    'UPDATE contests SET rating_finalized = 1 WHERE id = ? AND rating_finalized = 0'
  ).bind(id).run();
  if ((claimResult as any).meta.changes === 0) {
    return c.json({ success: false, error: { message: 'Ratings have already been finalized', code: 'BAD_REQUEST' } }, 400);
  }

  // 收集全部写语句,放入同一 D1 batch 原子执行(避免中途失败留下半成品)
  const rankByUser = new Map<number, number>();
  for (const r of ranked) rankByUser.set(r.user_id, r.rank);

  const stmts: D1PreparedStatement[] = [];
  for (const ch of changes) {
    stmts.push(c.env.DB.prepare(
      'INSERT INTO rating_changes (user_id, contest_id, old_rating, new_rating, delta, reason) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(ch.user_id, id, ch.old_rating, ch.new_rating, ch.delta, `Contest #${id} finalization`));

    // Upsert user_ratings (UNIQUE(user_id))
    const existing = await c.env.DB.prepare('SELECT user_id FROM user_ratings WHERE user_id = ?').bind(ch.user_id).first();
    if (existing) {
      stmts.push(c.env.DB.prepare(
        'UPDATE user_ratings SET rating = ?, max_rating = MAX(max_rating, ?), updated_at = datetime("now") WHERE user_id = ?'
      ).bind(ch.new_rating, ch.new_rating, ch.user_id));
    } else {
      stmts.push(c.env.DB.prepare(
        'INSERT INTO user_ratings (user_id, rating, max_rating) VALUES (?, ?, ?)'
      ).bind(ch.user_id, ch.new_rating, ch.new_rating));
    }

    // Write final_rank + final_rating_delta into contest_participants
    stmts.push(c.env.DB.prepare(
      'UPDATE contest_participants SET final_rank = ?, final_rating_delta = ? WHERE contest_id = ? AND user_id = ? AND is_virtual = 0'
    ).bind(rankByUser.get(ch.user_id) ?? null, ch.delta, id, ch.user_id));
  }

  try {
    // 原子写入全部结算数据
    await c.env.DB.batch(stmts);
  } catch (e) {
    // 写入失败:回滚抢占标记,允许重试
    await c.env.DB.prepare('UPDATE contests SET rating_finalized = 0 WHERE id = ?').bind(id).run();
    throw e;
  }

  // 通知用户(batch 成功后发送,失败不影响结算结果)
  for (const ch of changes) {
    await sendNotification(
      c.env.DB,
      ch.user_id,
      NotificationType.CONTEST,
      'Rating 已更新',
      `比赛《${(contest as any).title}》结算完成：${ch.old_rating} → ${ch.new_rating} (${ch.delta >= 0 ? '+' : ''}${ch.delta})`,
      `/contests/${id}`
    );
  }

  return c.json({
    success: true,
    data: {
      message: 'Ratings finalized',
      changes_count: changes.length,
      changes: changes.map((c) => ({
        user_id: c.user_id,
        old_rating: c.old_rating,
        new_rating: c.new_rating,
        delta: c.delta,
      })),
    },
  });
});

// GET /contests/:id/rating-changes — list rating changes for a finalized contest
contests.get('/:id/rating-changes', optionalAuthMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);

  const contest: any = await c.env.DB.prepare('SELECT id, title, rating_finalized, is_public FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // 私有比赛(is_public=0)仅管理员或已报名参与者可见,避免按 ID 泄露 Rating 历史
  const user = c.get('user');
  const isAdmin = isContestAdmin(user);
  if (contest.is_public !== 1 && !isAdmin) {
    const registered = user ? await c.env.DB.prepare(
      'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
    ).bind(id, user.userId).first() : null;
    if (!registered) {
      return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
    }
  }

  const results = await c.env.DB.prepare(
    `SELECT rc.id, rc.user_id, rc.contest_id, rc.old_rating, rc.new_rating, rc.delta, rc.created_at,
            u.username
     FROM rating_changes rc
     JOIN users u ON rc.user_id = u.id
     WHERE rc.contest_id = ?
     ORDER BY rc.new_rating DESC`
  ).bind(id).all();

  return c.json({
    success: true,
    data: {
      contest: {
        id,
        title: (contest as any).title,
        rating_finalized: (contest as any).rating_finalized,
      },
      changes: results.results,
    },
  });
});

// ============================================================
// 赛时公告
// ============================================================

// GET /contests/:id/announcements — 公告列表(公开;私有比赛仅管理员/参与者可见)
contests.get('/:id/announcements', optionalAuthMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);

  const contest: any = await c.env.DB.prepare('SELECT id, is_public FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  // 私有比赛(is_public=0)仅管理员或已报名参与者可见,避免按 ID 泄露
  const user = c.get('user');
  const isAdmin = isContestAdmin(user);
  if (contest.is_public !== 1 && !isAdmin) {
    const registered = user ? await c.env.DB.prepare(
      'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
    ).bind(id, user.userId).first() : null;
    if (!registered) {
      return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
    }
  }

  const results = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.content, a.is_pinned, a.created_at, a.updated_at,
            u.id as user_id, u.username
     FROM contest_announcements a JOIN users u ON a.user_id = u.id
     WHERE a.contest_id = ?
     ORDER BY a.is_pinned DESC, a.created_at DESC`
  ).bind(id).all();

  return c.json({ success: true, data: { announcements: results.results } });
});

// POST /contests/:id/announcements — 发布公告(主办方/admin)
contests.post('/:id/announcements', authMiddleware, contestAdminMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { title, content, is_pinned } = body;

  if (!title || !content) {
    return c.json({ success: false, error: { message: 'title and content are required', code: 'BAD_REQUEST' } }, 400);
  }

  const contest = await c.env.DB.prepare('SELECT id FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO contest_announcements (contest_id, user_id, title, content, is_pinned) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, user.userId, title, content, is_pinned ? 1 : 0).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Announcement published' } }, 201);
});

// PUT /contests/:id/announcements/:announcementId — 编辑公告(主办方/admin)
contests.put('/:id/announcements/:announcementId', authMiddleware, contestAdminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const announcementId = parseInt(c.req.param('announcementId') || '0');
  const body = await c.req.json();

  const announcement: any = await c.env.DB.prepare(
    'SELECT id FROM contest_announcements WHERE id = ? AND contest_id = ?'
  ).bind(announcementId, id).first();
  if (!announcement) {
    return c.json({ success: false, error: { message: 'Announcement not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE contest_announcements SET
       title = COALESCE(?, title), content = COALESCE(?, content),
       is_pinned = COALESCE(?, is_pinned), updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND contest_id = ?`
  ).bind(
    body.title ?? null,
    body.content ?? null,
    body.is_pinned !== undefined ? (body.is_pinned ? 1 : 0) : null,
    announcementId, id
  ).run();

  return c.json({ success: true, data: { message: 'Announcement updated' } });
});

// DELETE /contests/:id/announcements/:announcementId — 删除公告(主办方/admin)
contests.delete('/:id/announcements/:announcementId', authMiddleware, contestAdminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const announcementId = parseInt(c.req.param('announcementId') || '0');

  const announcement: any = await c.env.DB.prepare(
    'SELECT id FROM contest_announcements WHERE id = ? AND contest_id = ?'
  ).bind(announcementId, id).first();
  if (!announcement) {
    return c.json({ success: false, error: { message: 'Announcement not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare('DELETE FROM contest_announcements WHERE id = ? AND contest_id = ?').bind(announcementId, id).run();
  return c.json({ success: true, data: { message: 'Announcement deleted' } });
});

// ============================================================
// 赛时私密答疑(选手提问 -> 主办方回答,禁止公开提问)
// ============================================================

// GET /contests/:id/clarifications — 答疑列表
// 选手只能看到自己的提问;主办方/admin 可看到全部
contests.get('/:id/clarifications', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  const contest = await c.env.DB.prepare('SELECT id FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const isHost = isContestAdmin(user);

  let query = `SELECT cl.id, cl.contest_id, cl.user_id, cl.question, cl.answer, cl.status,
                      cl.created_at, cl.answered_at, u.username
               FROM contest_clarifications cl JOIN users u ON cl.user_id = u.id
               WHERE cl.contest_id = ?`;
  const binds: any[] = [id];
  if (!isHost) {
    query += ' AND cl.user_id = ?';
    binds.push(user.userId);
  }
  query += ' ORDER BY cl.created_at DESC';

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  return c.json({ success: true, data: { clarifications: results.results } });
});

// POST /contests/:id/clarifications — 选手提交提问(仅已报名选手)
contests.post('/:id/clarifications', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { question } = body;

  if (!question || !question.trim()) {
    return c.json({ success: false, error: { message: 'question is required', code: 'BAD_REQUEST' } }, 400);
  }
  if (question.length > 2000) {
    return c.json({ success: false, error: { message: 'question must be at most 2000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  const contest: any = await c.env.DB.prepare('SELECT id, start_time, end_time FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }
  // 按当前时间动态判定:必须查询 start_time/end_time 才能正确计算状态,
  // 否则 effectiveContestStatus 会因字段缺失恒返回 'upcoming'(比赛开始后仍误报"未开始")
  // 同时(L8):答疑仅在比赛进行中开放,与"赛时私密答疑"的设计语义一致;
  // 比赛结束前的 upcoming 阶段与结束后的 ended 阶段均不接受新提问。
  const contestStatus = effectiveContestStatus(contest);
  if (contestStatus !== 'running') {
    return c.json({ success: false, error: { message: contestStatus === 'upcoming' ? 'Contest has not started yet' : 'Contest has ended', code: 'FORBIDDEN' } }, 403);
  }

  // 仅已报名(参赛)选手可提问
  const participant = await c.env.DB.prepare(
    'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();
  if (!participant) {
    return c.json({ success: false, error: { message: 'You must register for this contest first', code: 'FORBIDDEN' } }, 403);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO contest_clarifications (contest_id, user_id, question) VALUES (?, ?, ?)'
  ).bind(id, user.userId, question.trim()).run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Question submitted' } }, 201);
});

// PUT /contests/:id/clarifications/:clarificationId — 主办方回答
contests.put('/:id/clarifications/:clarificationId', authMiddleware, contestAdminMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const clarificationId = parseInt(c.req.param('clarificationId') || '0');
  const body = await c.req.json();

  if (!body.answer || !body.answer.trim()) {
    return c.json({ success: false, error: { message: 'answer is required', code: 'BAD_REQUEST' } }, 400);
  }

  const clarification: any = await c.env.DB.prepare(
    'SELECT id, status FROM contest_clarifications WHERE id = ? AND contest_id = ?'
  ).bind(clarificationId, id).first();
  if (!clarification) {
    return c.json({ success: false, error: { message: 'Clarification not found', code: 'NOT_FOUND' } }, 404);
  }

  // (L9)幂等保护:已答疑问不允许再次回答/修改,避免被覆盖且无审计痕迹。
  // 如需纠正回答,应通过额外的"撤回"流程将 status 改回 pending,而非直接覆盖。
  if (clarification.status === 'answered') {
    return c.json({ success: false, error: { message: 'Clarification has already been answered', code: 'BAD_REQUEST' } }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE contest_clarifications SET answer = ?, answered_by = ?, status = 'answered', answered_at = CURRENT_TIMESTAMP
     WHERE id = ? AND contest_id = ?`
  ).bind(body.answer.trim(), user.userId, clarificationId, id).run();

  return c.json({ success: true, data: { message: 'Answer submitted' } });
});

export default contests;
