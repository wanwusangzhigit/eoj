import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, contestAdminMiddleware, adminMiddleware } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { computeContestRatingChanges, RatingParticipant, INITIAL_RATING } from '../utils/rating';
import { sendNotification, NotificationType } from '../utils/notify';

const contests = new Hono<AppType>();

const contestCreateLimiter = createRateLimiter('contest_create', 10, 60_000);
const contestRegisterLimiter = createRateLimiter('contest_register', 5, 60_000);
const virtualRegisterLimiter = createRateLimiter('virtual_register', 5, 60_000);

const VALID_SCORING_TYPES = ['acm', 'ioi'];

function normalizeScoringType(s: any): 'acm' | 'ioi' {
  return s === 'ioi' ? 'ioi' : 'acm';
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

  if (status) {
    query += ' AND c.status = ?';
    countQuery += ' AND status = ?';
    binds.push(status);
    countBinds.push(status);
  } else {
    query += ' AND c.is_public = 1';
    countQuery += ' AND is_public = 1';
  }

  query += ' ORDER BY c.start_time DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      contests: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// Get contest detail
contests.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const contest = await c.env.DB.prepare(
    'SELECT c.*, u.username as creator_name FROM contests c JOIN users u ON c.created_by = u.id WHERE c.id = ?'
  ).bind(id).first();

  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  return c.json({ success: true, data: { contest } });
});

// Create contest (admin only)
contests.post('/', authMiddleware, contestAdminMiddleware, contestCreateLimiter, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { title, description, start_time, end_time, is_public, problems, scoring_type, is_rated, allow_virtual, duration_minutes } = body;

  if (!title || !start_time || !end_time) {
    return c.json({ success: false, error: { message: 'title, start_time, end_time are required', code: 'BAD_REQUEST' } }, 400);
  }

  if (title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }

  if (description && description.length > 5000) {
    return c.json({ success: false, error: { message: 'description must be at most 5000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  if (new Date(start_time) >= new Date(end_time)) {
    return c.json({ success: false, error: { message: 'start_time must be before end_time', code: 'BAD_REQUEST' } }, 400);
  }

  if (problems && Array.isArray(problems) && problems.length > 26) {
    return c.json({ success: false, error: { message: 'problems array must have at most 26 items', code: 'BAD_REQUEST' } }, 400);
  }

  const finalScoringType = normalizeScoringType(scoring_type);

  const startTime = new Date(start_time);
  const endTime = new Date(end_time);
  const now = new Date();
  let status = 'upcoming';
  if (now >= startTime && now < endTime) status = 'running';
  if (now >= endTime) status = 'ended';

  const result = await c.env.DB.prepare(
    'INSERT INTO contests (title, description, start_time, end_time, status, is_public, created_by, scoring_type, is_rated, allow_virtual, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    title,
    description || '',
    start_time,
    end_time,
    status,
    is_public ?? 1,
    user.userId,
    finalScoringType,
    is_rated ? 1 : 0,
    allow_virtual === false ? 0 : 1,
    duration_minutes ?? null,
  ).run();

  const contestId = result.meta.last_row_id;

  // Add problems to contest
  if (problems && Array.isArray(problems)) {
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      const label = String.fromCharCode(65 + i); // A, B, C...
      await c.env.DB.prepare(
        'INSERT INTO contest_problems (contest_id, problem_id, label, score) VALUES (?, ?, ?, ?)'
      ).bind(contestId, p.problem_id, p.label || label, p.score || 100).run();
    }
  }

  return c.json({ success: true, data: { id: contestId, message: 'Contest created' } }, 201);
});

// Update contest (admin only)
contests.put('/:id', authMiddleware, contestAdminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);
  const body = await c.req.json();
  const { title, description, start_time, end_time, is_public, status, scoring_type, is_rated, allow_virtual, duration_minutes } = body;

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const updates: string[] = [];
  const binds: any[] = [];

  if (title !== undefined) { updates.push('title = ?'); binds.push(title); }
  if (description !== undefined) { updates.push('description = ?'); binds.push(description); }
  if (start_time !== undefined) { updates.push('start_time = ?'); binds.push(start_time); }
  if (end_time !== undefined) { updates.push('end_time = ?'); binds.push(end_time); }
  if (is_public !== undefined) { updates.push('is_public = ?'); binds.push(is_public); }
  if (status !== undefined) { updates.push('status = ?'); binds.push(status); }
  if (scoring_type !== undefined) { updates.push('scoring_type = ?'); binds.push(normalizeScoringType(scoring_type)); }
  if (is_rated !== undefined) { updates.push('is_rated = ?'); binds.push(is_rated ? 1 : 0); }
  if (allow_virtual !== undefined) { updates.push('allow_virtual = ?'); binds.push(allow_virtual ? 1 : 0); }
  if (duration_minutes !== undefined) { updates.push('duration_minutes = ?'); binds.push(duration_minutes); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    binds.push(id);
    await c.env.DB.prepare(`UPDATE contests SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  }

  // Update problems if provided
  if (body.problems && Array.isArray(body.problems)) {
    await c.env.DB.prepare('DELETE FROM contest_problems WHERE contest_id = ?').bind(id).run();
    for (let i = 0; i < body.problems.length; i++) {
      const p = body.problems[i];
      const label = String.fromCharCode(65 + i);
      await c.env.DB.prepare(
        'INSERT INTO contest_problems (contest_id, problem_id, label, score) VALUES (?, ?, ?, ?)'
      ).bind(id, p.problem_id, p.label || label, p.score || 100).run();
    }
  }

  return c.json({ success: true, data: { message: 'Contest updated' } });
});

// Delete contest (admin only)
contests.delete('/:id', authMiddleware, contestAdminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);
  await c.env.DB.prepare('DELETE FROM contests WHERE id = ?').bind(id).run();
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
  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;
  const isParticipant = !!(await c.env.DB.prepare(
    'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
  ).bind(id, user.userId).first());

  const contestStatus = (contest as any).status;
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
    `SELECT cp.label, cp.score, p.id, p.title, p.slug, p.difficulty, p.tags, p.time_limit, p.memory_limit
     FROM contest_problems cp JOIN problems p ON cp.problem_id = p.id
     WHERE cp.contest_id = ? ORDER BY cp.label`
  ).bind(id).all();

  // If contest is running, include sample testcases
  // If ended, include all testcases
  return c.json({ success: true, data: { problems: problems.results } });
});

// Register for contest
contests.post('/:id/register', authMiddleware, contestRegisterLimiter, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const contestStatus = (contest as any).status;
  if (contestStatus === 'ended') {
    return c.json({ success: false, error: { message: 'Contest has ended', code: 'BAD_REQUEST' } }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();

  if (existing) {
    return c.json({ success: false, error: { message: 'Already registered', code: 'BAD_REQUEST' } }, 400);
  }

  await c.env.DB.prepare(
    'INSERT INTO contest_participants (contest_id, user_id) VALUES (?, ?)'
  ).bind(id, user.userId).run();

  return c.json({ success: true, data: { message: 'Registered successfully' } });
});

// Get contest rankings/leaderboard
contests.get('/:id/rankings', async (c) => {
  const id = parseInt(c.req.param('id'));

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const scoringType = normalizeScoringType((contest as any).scoring_type);
  const onlyVirtual = c.req.query('virtual') === '1';

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

  // Use contest time window (or virtual start time + duration for virtual participants)
  const allSubmissions = await c.env.DB.prepare(
    `SELECT id, user_id, problem_id, status, score, time_used, created_at FROM submissions
     WHERE user_id IN (${placeholders}) AND problem_id IN (${problemPlaceholders})
     AND status != 'pending' AND status != 'running'
     AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
  ).bind(...userIds, ...problemIds, (contest as any).start_time, (contest as any).end_time).all();

  // Group submissions by user_id and problem_id
  const bestSubs: Record<string, any> = {};
  const attemptCounts: Record<string, number> = {};
  const firstAcceptedAt: Record<string, string> = {};

  for (const sub of allSubmissions.results as any[]) {
    const key = `${sub.user_id}:${sub.problem_id}`;
    attemptCounts[key] = (attemptCounts[key] || 0) + 1;
    // Find best submission (ACM and IOI both use best score)
    const existing = bestSubs[key];
    if (!existing || sub.score > existing.score || (sub.score === existing.score && sub.time_used < existing.time_used)) {
      bestSubs[key] = sub;
    }
    if (sub.status === 'accepted') {
      if (!firstAcceptedAt[key] || new Date(sub.created_at) < new Date(firstAcceptedAt[key])) {
        firstAcceptedAt[key] = sub.created_at;
      }
    }
  }

  // Count wrong attempts before first accepted for penalty (ACM only)
  const wrongBeforeAccepted: Record<string, number> = {};
  for (const sub of allSubmissions.results as any[]) {
    const key = `${sub.user_id}:${sub.problem_id}`;
    if (firstAcceptedAt[key] && new Date(sub.created_at) <= new Date(firstAcceptedAt[key])) {
      if (sub.status !== 'accepted') {
        wrongBeforeAccepted[key] = (wrongBeforeAccepted[key] || 0) + 1;
      }
    }
  }

  const contestStartTime = new Date((contest as any).start_time).getTime();

  // Build per-participant virtual start time lookup (for virtual penalty calc)
  const virtualStartMap: Record<number, number> = {};
  for (const p of participants.results as any[]) {
    if (p.is_virtual && p.virtual_start_time) {
      virtualStartMap[p.user_id] = new Date(p.virtual_start_time).getTime();
    }
  }

  // Build rankings
  const rankings: any[] = [];
  for (const participant of participants.results) {
    const userId = (participant as any).user_id;
    const username = (participant as any).username;
    let totalScore = 0;
    let acceptedCount = 0;
    let totalPenalty = 0; // penalty in minutes
    const problemResults: any = {};

    for (const cp of contestProblems.results) {
      const problemId = (cp as any).problem_id;
      const label = (cp as any).label;
      const score = (cp as any).score;
      const key = `${userId}:${problemId}`;
      const bestSub = bestSubs[key];
      const attempts = attemptCounts[key] || 0;
      const wrongAttempts = wrongBeforeAccepted[key] || 0;

      if (bestSub) {
        problemResults[label] = {
          status: bestSub.status,
          score: bestSub.score || 0,
          time_used: bestSub.time_used || 0,
          attempts,
          wrong_attempts: wrongAttempts,
        };
        if (scoringType === 'ioi') {
          // IOI: best score across all attempts, no penalty
          totalScore += bestSub.score || 0;
          if (bestSub.status === 'accepted') acceptedCount++;
        } else {
          // ACM: best score, penalty on AC
          if (bestSub.status === 'accepted') {
            acceptedCount++;
            totalScore += bestSub.score || score;
            const acTime = new Date(firstAcceptedAt[key]).getTime();
            // For virtual participants, use their virtual start time as base
            const baseTime = virtualStartMap[userId] || contestStartTime;
            const timeFromStart = Math.floor((acTime - baseTime) / 60000);
            totalPenalty += timeFromStart + wrongAttempts * 20;
          } else {
            totalScore += bestSub.score || 0;
          }
        }
      } else {
        problemResults[label] = null;
      }
    }

    rankings.push({
      user_id: userId,
      username,
      is_virtual: (participant as any).is_virtual || 0,
      virtual_start_time: (participant as any).virtual_start_time || null,
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

  return c.json({
    success: true,
    data: {
      rankings,
      problems: contestProblems.results,
      scoring_type: scoringType,
      is_rated: (contest as any).is_rated || 0,
      rating_finalized: (contest as any).rating_finalized || 0,
    },
  });
});

// Check if user is registered
contests.get('/:id/registration', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const registered = !!(await c.env.DB.prepare(
    'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?'
  ).bind(id, user.userId).first());

  return c.json({ success: true, data: { registered } });
});

// Get current user's problem status in contest
contests.get('/:id/my-status', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const contest = await c.env.DB.prepare('SELECT * FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
  }

  const contestProblems = await c.env.DB.prepare(
    'SELECT cp.label, cp.problem_id, cp.score FROM contest_problems cp WHERE cp.contest_id = ? ORDER BY cp.label'
  ).bind(id).all();

  if (contestProblems.results.length === 0) {
    return c.json({ success: true, data: { problems: {} } });
  }

  const problemIds = contestProblems.results.map((p: any) => p.problem_id);
  const problemPlaceholders = problemIds.map(() => '?').join(',');

  const submissions = await c.env.DB.prepare(
    `SELECT problem_id, status, score FROM submissions
     WHERE user_id = ? AND problem_id IN (${problemPlaceholders})
     AND status != 'pending' AND status != 'running'
     AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
  ).bind(user.userId, ...problemIds, (contest as any).start_time, (contest as any).end_time).all();

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

  // Virtual participation only makes sense for ended contests
  if ((contest as any).status !== 'ended') {
    return c.json({ success: false, error: { message: 'Virtual participation is only available for ended contests', code: 'BAD_REQUEST' } }, 400);
  }

  // Check if already registered (virtual or regular)
  const existing = await c.env.DB.prepare(
    'SELECT id, is_virtual FROM contest_participants WHERE contest_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();
  if (existing) {
    return c.json({ success: false, error: { message: 'Already registered', code: 'BAD_REQUEST' } }, 400);
  }

  const nowIso = new Date().toISOString();
  const result = await c.env.DB.prepare(
    'INSERT INTO contest_participants (contest_id, user_id, is_virtual, virtual_start_time) VALUES (?, ?, 1, ?)'
  ).bind(id, user.userId, nowIso).run();

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

  if ((contest as any).status !== 'ended') {
    return c.json({ success: false, error: { message: 'Contest must be ended before finalizing ratings', code: 'BAD_REQUEST' } }, 400);
  }

  if ((contest as any).rating_finalized === 1) {
    return c.json({ success: false, error: { message: 'Ratings have already been finalized', code: 'BAD_REQUEST' } }, 400);
  }

  // Fetch rankings (re-use rankings logic by calling internal fetch)
  // Note: we only consider non-virtual participants for rating.
  const participants = await c.env.DB.prepare(
    'SELECT cp.user_id FROM contest_participants cp WHERE cp.contest_id = ? AND cp.is_virtual = 0'
  ).bind(id).all();

  if (participants.results.length === 0) {
    return c.json({ success: false, error: { message: 'No participants to rate', code: 'BAD_REQUEST' } }, 400);
  }

  // Re-run the rankings computation by querying submissions directly (simplified)
  const contestProblems = await c.env.DB.prepare(
    'SELECT cp.label, cp.problem_id, cp.score FROM contest_problems cp WHERE cp.contest_id = ? ORDER BY cp.label'
  ).bind(id).all();

  const userIds = participants.results.map((p: any) => p.user_id);
  const problemIds = contestProblems.results.map((p: any) => p.problem_id);
  const placeholders = userIds.map(() => '?').join(',');
  const problemPlaceholders = problemIds.map(() => '?').join(',');

  const allSubmissions = await c.env.DB.prepare(
    `SELECT id, user_id, problem_id, status, score, created_at FROM submissions
     WHERE user_id IN (${placeholders}) AND problem_id IN (${problemPlaceholders})
     AND status != 'pending' AND status != 'running'
     AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
  ).bind(...userIds, ...problemIds, (contest as any).start_time, (contest as any).end_time).all();

  // Compute per-user total score (use best score per problem)
  const bestScoreByKey: Record<string, number> = {};
  for (const sub of allSubmissions.results as any[]) {
    const key = `${sub.user_id}:${sub.problem_id}`;
    const cur = bestScoreByKey[key] ?? -1;
    if (sub.score > cur) bestScoreByKey[key] = sub.score;
  }

  // Build (user_id, score, rank)
  const userScores: { user_id: number; score: number }[] = [];
  for (const p of participants.results as any[]) {
    let total = 0;
    for (const cp of contestProblems.results as any[]) {
      const key = `${p.user_id}:${cp.problem_id}`;
      total += bestScoreByKey[key] ?? 0;
    }
    userScores.push({ user_id: p.user_id, score: total });
  }

  // Sort by score desc; assign ranks (ties share rank)
  userScores.sort((a, b) => b.score - a.score);
  let prevScore: number | null = null;
  let prevRank = 0;
  const ranked: { user_id: number; rank: number }[] = [];
  for (let i = 0; i < userScores.length; i++) {
    const us = userScores[i];
    if (prevScore === null || us.score !== prevScore) {
      prevRank = i + 1;
    }
    ranked.push({ user_id: us.user_id, rank: prevRank });
    prevScore = us.score;
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

  // Persist changes in a single batch (D1 supports sequential prepared statements)
  const rankByUser = new Map<number, number>();
  for (const r of ranked) rankByUser.set(r.user_id, r.rank);

  for (const ch of changes) {
    await c.env.DB.prepare(
      'INSERT INTO rating_changes (user_id, contest_id, old_rating, new_rating, delta, reason) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(ch.user_id, id, ch.old_rating, ch.new_rating, ch.delta, `Contest #${id} finalization`).run();

    // Upsert user_ratings
    const existing = await c.env.DB.prepare('SELECT user_id FROM user_ratings WHERE user_id = ?').bind(ch.user_id).first();
    if (existing) {
      await c.env.DB.prepare(
        'UPDATE user_ratings SET rating = ?, max_rating = MAX(max_rating, ?), updated_at = datetime("now") WHERE user_id = ?'
      ).bind(ch.new_rating, ch.new_rating, ch.user_id).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO user_ratings (user_id, rating, max_rating) VALUES (?, ?, ?)'
      ).bind(ch.user_id, ch.new_rating, ch.new_rating).run();
    }

    // Write final_rank + final_rating_delta into contest_participants
    await c.env.DB.prepare(
      'UPDATE contest_participants SET final_rank = ?, final_rating_delta = ? WHERE contest_id = ? AND user_id = ? AND is_virtual = 0'
    ).bind(rankByUser.get(ch.user_id) ?? null, ch.delta, id, ch.user_id).run();

    // Notify the user
    await sendNotification(
      c.env.DB,
      ch.user_id,
      NotificationType.CONTEST,
      'Rating 已更新',
      `比赛《${(contest as any).title}》结算完成：${ch.old_rating} → ${ch.new_rating} (${ch.delta >= 0 ? '+' : ''}${ch.delta})`,
      `/contests/${id}`
    );
  }

  // Mark contest as finalized
  await c.env.DB.prepare('UPDATE contests SET rating_finalized = 1 WHERE id = ?').bind(id).run();

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
contests.get('/:id/rating-changes', async (c) => {
  const id = parseInt(c.req.param('id'));

  const contest = await c.env.DB.prepare('SELECT id, title, rating_finalized FROM contests WHERE id = ?').bind(id).first();
  if (!contest) {
    return c.json({ success: false, error: { message: 'Contest not found', code: 'NOT_FOUND' } }, 404);
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

export default contests;
