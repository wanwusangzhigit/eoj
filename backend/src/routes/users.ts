import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware, superAdminMiddleware } from '../middleware/auth';
import { escapeLikeWildcard } from '../utils/helpers';
import { validatePassword } from '../utils/validator';
import * as bcrypt from 'bcryptjs';

const users = new Hono<AppType>();

// Admin only: List all users (paginated)
users.get('/list', authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search') || '';
  const offset = (page - 1) * pageSize;

  let countQuery = 'SELECT COUNT(*) as total FROM users';
  let dataQuery = 'SELECT id, username, avatar_url, role, permissions, banned, created_at FROM users';
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (search) {
    countQuery += " WHERE username LIKE ? ESCAPE '\\'";
    dataQuery += " WHERE username LIKE ? ESCAPE '\\'";
    binds.push(`%${escapeLikeWildcard(search)}%`);
    countBinds.push(`%${escapeLikeWildcard(search)}%`);
  }

  dataQuery += ' ORDER BY id ASC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(dataQuery).bind(...binds, pageSize, offset).all();
  
  return c.json({
    success: true,
    data: {
      users: results.results,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
});

// Admin only: Update user role
// 安全约束(H5):
//  - 不可修改超级管理员(userId===1)的角色
//  - 普通管理员只能在被授予的 admin/user 两个角色之间切换
//  - 授予 super_admin 角色必须由超级管理员本人(superAdminMiddleware)操作,
//    否则任意 admin 都能"造一个 super_admin 出来"绕过 superAdminOnly 接口限制
users.put('/:id/role', authMiddleware, adminMiddleware, async (c) => {
  const userId = parseInt(c.req.param('id') || '0');
  const body: any = await c.req.json();
  const { role } = body;
  const currentUser = c.get('user');

  // Check if trying to change super admin (user id=1)
  if (userId === 1) {
    return c.json({ success: false, error: { message: 'Cannot modify super admin role', code: 'FORBIDDEN' } }, 403);
  }

  const isSuperAdmin = currentUser.userId === 1 || currentUser.role === 'super_admin';

  // 普通管理员禁止授予/撤销 super_admin 角色
  if (role === 'super_admin' && !isSuperAdmin) {
    return c.json({ success: false, error: { message: 'Only super admin can grant super_admin role', code: 'FORBIDDEN' } }, 403);
  }

  // 允许的角色白名单
  const allowedRoles = isSuperAdmin ? ['user', 'admin', 'super_admin'] : ['user', 'admin'];
  if (!allowedRoles.includes(role)) {
    return c.json({ success: false, error: { message: 'Invalid role', code: 'BAD_REQUEST' } }, 400);
  }

  // 防止目标已是 super_admin 时被普通 admin 降级(避免绕道降权再 ban)
  const target: any = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
  if (!target) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }
  if (target.role === 'super_admin' && !isSuperAdmin) {
    return c.json({ success: false, error: { message: 'Cannot modify super admin role', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?')
    .bind(role, userId)
    .run();

  return c.json({ success: true, data: { message: 'Role updated' } });
});

// Super admin only: Update user permissions
users.put('/:id/permissions', authMiddleware, superAdminMiddleware, async (c) => {
  const userId = parseInt(c.req.param('id') || '0');
  const body: any = await c.req.json();
  const { permissions } = body;

  if (userId === 1) {
    return c.json({ success: false, error: { message: 'Cannot modify super admin permissions', code: 'FORBIDDEN' } }, 403);
  }

  const validPermissions = ['contest_admin', 'problem_admin', 'list_admin', 'ticket_admin', 'upload_admin'];
  if (!Array.isArray(permissions) || !permissions.every((p: string) => validPermissions.includes(p))) {
    return c.json({ success: false, error: { message: 'Invalid permissions', code: 'BAD_REQUEST' } }, 400);
  }

  await c.env.DB.prepare('UPDATE users SET permissions = ? WHERE id = ?')
    .bind(JSON.stringify(permissions), userId)
    .run();

  return c.json({ success: true, data: { message: 'Permissions updated' } });
});

// Admin only: Ban or unban a user
users.put('/:id/ban', authMiddleware, adminMiddleware, async (c) => {
  const userId = parseInt(c.req.param('id') || '0');
  const body: any = await c.req.json();
  const { banned } = body;

  // Cannot ban super admin
  if (userId === 1) {
    return c.json({ success: false, error: { message: 'Cannot ban super admin', code: 'FORBIDDEN' } }, 403);
  }

  // Cannot ban/unban yourself
  const currentUser = c.get('user');
  if (currentUser.userId === userId) {
    return c.json({ success: false, error: { message: 'Cannot ban/unban yourself', code: 'FORBIDDEN' } }, 403);
  }

  if (typeof banned !== 'boolean') {
    return c.json({ success: false, error: { message: 'banned field must be boolean', code: 'BAD_REQUEST' } }, 400);
  }

  // (M6)防止管理员互相封禁造成管理混乱:
  //  - 普通管理员不能封禁/解封超级管理员或其他管理员
  //  - 只有超级管理员本人(userId===1)或 super_admin 角色才能封禁其他管理员
  // 解封(unban)操作允许普通 admin 执行(降低运维门槛)
  if (banned) {
    const target: any = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
    if (!target) {
      return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
    }
    const targetIsAdmin = target.role === 'admin' || target.role === 'super_admin';
    const callerIsSuperAdmin = currentUser.userId === 1 || currentUser.role === 'super_admin';
    if (targetIsAdmin && !callerIsSuperAdmin) {
      return c.json({ success: false, error: { message: 'Only super admin can ban other admins', code: 'FORBIDDEN' } }, 403);
    }
  }

  await c.env.DB.prepare('UPDATE users SET banned = ? WHERE id = ?')
    .bind(banned ? 1 : 0, userId)
    .run();

  return c.json({ success: true, data: { message: banned ? 'User banned' : 'User unbanned' } });
});

users.get('/profile', authMiddleware, async (c) => {
  const user = c.get('user');
  
  // Fetch full user details from DB since JWT only contains basic info
  const fullUser: any = await c.env.DB.prepare('SELECT id, username, avatar_url, bio, role, created_at FROM users WHERE id = ?')
    .bind(user.userId)
    .first();

  if (!fullUser) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }

  // 自定义头衔(存于 user_settings,key = title)
  const titleRow: any = await c.env.DB.prepare(
    "SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = 'title'"
  ).bind(fullUser.id).first();
  const title = titleRow?.setting_value || '';
  
  const statsResult = await c.env.DB.prepare(`
    SELECT 
      COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.problem_id END) as solved_count,
      COUNT(s.id) as total_submissions,
      COUNT(DISTINCT s.problem_id) as attempted_count
    FROM submissions s
    WHERE s.user_id = ?
  `).bind(fullUser.id).first();
  
  const recentSubmissions = await c.env.DB.prepare(`
    SELECT s.*, p.title, p.slug 
    FROM submissions s
    JOIN problems p ON s.problem_id = p.id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
    LIMIT 10
  `).bind(fullUser.id).all();

  // 用户标签云:按已 AC 题目的标签计数
  const tagCloudRows = await c.env.DB.prepare(
    `SELECT p.tags FROM submissions s JOIN problems p ON s.problem_id = p.id
     WHERE s.user_id = ? AND s.status = 'accepted' AND p.tags IS NOT NULL AND p.tags != '[]'`
  ).bind(fullUser.id).all();
  const tagCloudMap = new Map<string, number>();
  for (const row of tagCloudRows.results as any[]) {
    try {
      const parsed = JSON.parse(row.tags || '[]');
      if (Array.isArray(parsed)) {
        parsed.forEach((tag: string) => tagCloudMap.set(tag, (tagCloudMap.get(tag) || 0) + 1));
      }
    } catch { /* skip */ }
  }
  const tagCloud = Array.from(tagCloudMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));
  
  return c.json({
    success: true,
    data: {
      user: {
        id: fullUser.id,
        username: fullUser.username,
        avatar_url: fullUser.avatar_url,
        role: fullUser.role,
        created_at: fullUser.created_at,
        title,
      },
      stats: {
        solved_count: (statsResult as any)?.solved_count || 0,
        total_submissions: (statsResult as any)?.total_submissions || 0,
        attempted_count: (statsResult as any)?.attempted_count || 0,
      },
      recent_submissions: recentSubmissions.results,
      tag_cloud: tagCloud,
    },
  });
});

users.get('/submissions', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const status = c.req.query('status') || '';
  const offset = (page - 1) * pageSize;
  
  let countQuery = 'SELECT COUNT(*) as total FROM submissions WHERE user_id = ?';
  let dataQuery = `
    SELECT s.*, p.title, p.slug, p.difficulty 
    FROM submissions s
    JOIN problems p ON s.problem_id = p.id
    WHERE s.user_id = ?
  `;
  
  const binds: any[] = [user.userId];
  const countBinds: any[] = [user.userId];
  
  if (status) {
    countQuery += ' AND status = ?';
    dataQuery += ' AND s.status = ?';
    binds.push(status);
    countBinds.push(status);
  }
  
  dataQuery += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
  binds.push(pageSize, offset);
  
  const countResult = await c.env.DB.prepare(countQuery)
    .bind(...countBinds)
    .first();
  const total = (countResult as any)?.total || 0;
  
  const results = await c.env.DB.prepare(dataQuery)
    .bind(...binds)
    .all();
  
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

users.get('/solved', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT p.id) as total
    FROM problems p
    JOIN submissions s ON p.id = s.problem_id
    WHERE s.user_id = ? AND s.status = 'accepted'
  `).bind(user.userId).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(`
    SELECT DISTINCT p.*
    FROM problems p
    JOIN submissions s ON p.id = s.problem_id
    WHERE s.user_id = ? AND s.status = 'accepted'
    ORDER BY p.id ASC
    LIMIT ? OFFSET ?
  `).bind(user.userId, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      problems: results.results,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
});

users.get('/contests', authMiddleware, async (c) => {
  const user = c.get('user');

  const results = await c.env.DB.prepare(`
    SELECT c.*, cp.joined_at, cp.final_rank, cp.final_rating_delta,
      (SELECT COUNT(*) FROM contest_participants WHERE contest_id = c.id) as participant_count
    FROM contests c
    JOIN contest_participants cp ON c.id = cp.contest_id
    WHERE cp.user_id = ?
    ORDER BY c.start_time DESC
  `).bind(user.userId).all();

  return c.json({
    success: true,
    data: {
      contests: results.results,
    },
  });
});

// GET /users/heatmap - Current user's submission heatmap (last 365 days)
users.get('/heatmap', authMiddleware, async (c) => {
  const user = c.get('user');
  const results = await c.env.DB.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM submissions
    WHERE user_id = ? AND created_at >= date('now', '-365 days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).bind(user.userId).all();

  const heatmap: Record<string, number> = {};
  for (const row of results.results as any[]) {
    heatmap[row.date] = row.count;
  }

  return c.json({ success: true, data: { heatmap } });
});

// GET /users/language-stats - Current user's submission stats by language
users.get('/language-stats', authMiddleware, async (c) => {
  const user = c.get('user');
  const results = await c.env.DB.prepare(`
    SELECT language,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted
    FROM submissions
    WHERE user_id = ?
    GROUP BY language
    ORDER BY total DESC
  `).bind(user.userId).all();

  return c.json({ success: true, data: { languages: results.results } });
});

// GET /users/stats - Current user's 做题统计可视化(难度分布 + 每月 AC 趋势 + 提交状态)
users.get('/stats', authMiddleware, async (c) => {
  const user = c.get('user');
  const uid = user.userId;

  // 难度分布:按题目难度统计 AC / 尝试
  const difficultyRows = await c.env.DB.prepare(
    `SELECT p.difficulty,
            COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.problem_id END) as accepted,
            COUNT(DISTINCT s.problem_id) as attempted
     FROM submissions s JOIN problems p ON s.problem_id = p.id
     WHERE s.user_id = ? AND p.difficulty IS NOT NULL
     GROUP BY p.difficulty`
  ).bind(uid).all();

  // 每月 AC 趋势(近 12 个月)
  const monthlyRows = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', created_at) as month,
            COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
            COUNT(*) as total
     FROM submissions
     WHERE user_id = ? AND created_at >= date('now', '-12 months')
     GROUP BY month ORDER BY month ASC`
  ).bind(uid).all();

  // 提交状态汇总
  const statusRows = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count
     FROM submissions WHERE user_id = ? GROUP BY status`
  ).bind(uid).all();

  return c.json({
    success: true,
    data: {
      difficulty: difficultyRows.results,
      monthly: monthlyRows.results,
      status: statusRows.results,
    },
  });
});

// GET /users/wrong-problems - 错题本:最近一次提交未 AC 的题目(含失败次数)
// 若某题最近一次提交已 AC,则视为已攻克,不再出现在错题本
users.get('/wrong-problems', authMiddleware, async (c) => {
  const user = c.get('user');
  const uid = user.userId;
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  // 每题的最近一次提交状态
  const lastStatusRows = await c.env.DB.prepare(
    `SELECT s.problem_id,
            (SELECT status FROM submissions s2 WHERE s2.user_id = ? AND s2.problem_id = s.problem_id ORDER BY s2.id DESC LIMIT 1) as last_status,
            (SELECT COUNT(*) FROM submissions s3 WHERE s3.user_id = ? AND s3.problem_id = s.problem_id AND s3.status != 'accepted') as fail_count,
            (SELECT MAX(created_at) FROM submissions s4 WHERE s4.user_id = ? AND s4.problem_id = s.problem_id) as last_submitted_at
     FROM submissions s
     WHERE s.user_id = ?
     GROUP BY s.problem_id
     HAVING last_status IS NOT NULL AND last_status != 'accepted'`
  ).bind(uid, uid, uid, uid).all();

  // 按失败次数排序后分页
  const wrongProblems = (lastStatusRows.results as any[])
    .filter((r) => r.fail_count > 0)
    .sort((a, b) => b.fail_count - a.fail_count || String(b.last_submitted_at).localeCompare(String(a.last_submitted_at)));

  const total = wrongProblems.length;
  const pageItems = wrongProblems.slice(offset, offset + pageSize);

  // 联表取题目信息
  const problemIds = pageItems.map((p: any) => p.problem_id);
  let problems: any[] = [];
  if (problemIds.length > 0) {
    const placeholders = problemIds.map(() => '?').join(',');
    const rows = await c.env.DB.prepare(
      `SELECT id, title, slug, difficulty, tags FROM problems WHERE id IN (${placeholders})`
    ).bind(...problemIds).all();
    const map = new Map((rows.results as any[]).map((p: any) => [p.id, p]));
    problems = pageItems.map((p: any) => ({ ...(map.get(p.problem_id) || {}), fail_count: p.fail_count, last_submitted_at: p.last_submitted_at }));
  }

  return c.json({
    success: true,
    data: {
      problems,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /users/annual-report?year=YYYY — 年度做题报告(提交/AC/最长连续天数/最擅长标签/月度分布)
users.get('/annual-report', authMiddleware, async (c) => {
  const user = c.get('user');
  const uid = user.userId;
  const year = parseInt(c.req.query('year') || '') || new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;

  const [subCount, acCount, solvedCount, dayRows, tagRows, monthRows, weekRows] = await Promise.all([
    c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM submissions WHERE user_id = ? AND created_at >= ? AND created_at < ?'
    ).bind(uid, yearStart, yearEnd).first(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM submissions WHERE user_id = ? AND status = 'accepted' AND created_at >= ? AND created_at < ?"
    ).bind(uid, yearStart, yearEnd).first(),
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT problem_id) as count FROM submissions
       WHERE user_id = ? AND status = 'accepted' AND created_at >= ? AND created_at < ?`
    ).bind(uid, yearStart, yearEnd).first(),
    c.env.DB.prepare(
      `SELECT DISTINCT date(created_at) as day FROM submissions
       WHERE user_id = ? AND created_at >= ? AND created_at < ? ORDER BY day ASC`
    ).bind(uid, yearStart, yearEnd).all(),
    c.env.DB.prepare(
      `SELECT p.tags FROM submissions s JOIN problems p ON s.problem_id = p.id
       WHERE s.user_id = ? AND s.status = 'accepted' AND s.created_at >= ? AND s.created_at < ?
         AND p.tags IS NOT NULL AND p.tags != '[]'`
    ).bind(uid, yearStart, yearEnd).all(),
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as total,
              SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted
       FROM submissions WHERE user_id = ? AND created_at >= ? AND created_at < ?
       GROUP BY month ORDER BY month ASC`
    ).bind(uid, yearStart, yearEnd).all(),
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', created_at) as day, COUNT(*) as count
       FROM submissions WHERE user_id = ? AND created_at >= ? AND created_at < ?
       GROUP BY day ORDER BY day ASC`
    ).bind(uid, yearStart, yearEnd).all(),
  ]);

  // 最长连续做题天数
  const days = (weekRows.results as any[]).map((r) => r.day);
  let longestStreak = 0;
  let currentStreak = 0;
  let prev: Date | null = null;
  for (const d of days) {
    const cur = new Date(d + 'T00:00:00Z');
    if (prev) {
      const diff = Math.round((cur.getTime() - prev.getTime()) / 86400000);
      currentStreak = diff === 1 ? currentStreak + 1 : 1;
    } else {
      currentStreak = 1;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
    prev = cur;
  }

  // 最擅长标签(AC 题目的标签频次 Top5)
  const tagCount = new Map<string, number>();
  for (const row of (tagRows.results as any[])) {
    try {
      const parsed = JSON.parse(row.tags || '[]');
      if (Array.isArray(parsed)) {
        parsed.forEach((tag: string) => tagCount.set(tag, (tagCount.get(tag) || 0) + 1));
      }
    } catch { /* skip */ }
  }
  const topTags = Array.from(tagCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  return c.json({
    success: true,
    data: {
      year,
      total_submissions: (subCount as any)?.count || 0,
      accepted: (acCount as any)?.count || 0,
      solved_problems: (solvedCount as any)?.count || 0,
      practice_days: days.length,
      longest_streak: longestStreak,
      top_tags: topTags,
      monthly: monthRows.results,
    },
  });
});

users.get('/:username', async (c) => {
  const username = c.req.param('username');
  const currentUser = c.get('user');

  const user = await c.env.DB.prepare(`
    SELECT id, username, avatar_url, bio, created_at
    FROM users WHERE username = ?
  `).bind(username).first();

  if (!user) {
    return c.json({
      success: false,
      error: { message: 'User not found', code: 'NOT_FOUND' }
    }, 404);
  }

  // 自定义头衔(存于 user_settings,key = title)
  const titleRow: any = await c.env.DB.prepare(
    "SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = 'title'"
  ).bind((user as any).id).first();
  const title = titleRow?.setting_value || '';

  const statsResult = await c.env.DB.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.problem_id END) as solved_count,
      COUNT(s.id) as total_submissions,
      COUNT(DISTINCT s.problem_id) as attempted_count
    FROM submissions s
    WHERE s.user_id = ?
  `).bind((user as any).id).first();

  const solvedProblems = await c.env.DB.prepare(`
    SELECT p.id, p.title, p.slug, p.difficulty
    FROM problems p
    JOIN submissions s ON p.id = s.problem_id
    WHERE s.user_id = ? AND s.status = 'accepted'
    GROUP BY p.id
    ORDER BY p.id ASC
  `).bind((user as any).id).all();

  // 用户标签云:按已 AC 题目的标签计数(公开资料也展示)
  const tagCloudRows = await c.env.DB.prepare(
    `SELECT p.tags FROM submissions s JOIN problems p ON s.problem_id = p.id
     WHERE s.user_id = ? AND s.status = 'accepted' AND p.tags IS NOT NULL AND p.tags != '[]'`
  ).bind((user as any).id).all();
  const tagCloudMap = new Map<string, number>();
  for (const row of tagCloudRows.results as any[]) {
    try {
      const parsed = JSON.parse(row.tags || '[]');
      if (Array.isArray(parsed)) {
        parsed.forEach((tag: string) => tagCloudMap.set(tag, (tagCloudMap.get(tag) || 0) + 1));
      }
    } catch { /* skip */ }
  }
  const tagCloud = Array.from(tagCloudMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  const recentSubmissions = await c.env.DB.prepare(`
    SELECT s.id, s.language, s.status, s.created_at, p.title, p.slug
    FROM submissions s
    JOIN problems p ON s.problem_id = p.id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
    LIMIT 10
  `).bind((user as any).id).all();

  // 粉丝/关注数
  const followersCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM user_follows WHERE following_id = ?'
  ).bind((user as any).id).first();
  const followingCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM user_follows WHERE follower_id = ?'
  ).bind((user as any).id).first();

  // 是否已关注
  let isFollowing = false;
  if (currentUser) {
    const followRow = await c.env.DB.prepare(
      'SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?'
    ).bind(currentUser.userId, (user as any).id).first();
    isFollowing = !!followRow;
  }

  return c.json({
    success: true,
    data: {
      user: {
        id: (user as any).id,
        username: (user as any).username,
        avatar_url: (user as any).avatar_url,
        bio: (user as any).bio || '',
        created_at: (user as any).created_at,
        title,
        followers_count: (followersCount as any)?.cnt || 0,
        following_count: (followingCount as any)?.cnt || 0,
        is_following: isFollowing,
      },
      stats: {
        solved_count: (statsResult as any)?.solved_count || 0,
        total_submissions: (statsResult as any)?.total_submissions || 0,
        attempted_count: (statsResult as any)?.attempted_count || 0,
      },
      solved_problems: solvedProblems.results,
      recent_submissions: recentSubmissions.results,
      tag_cloud: tagCloud,
    },
  });
});

// POST /users/:username/follow — 关注
users.post('/:username/follow', authMiddleware, async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');

  const target = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (!target) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }
  const targetId = (target as any).id;
  if (targetId === currentUser.userId) {
    return c.json({ success: false, error: { message: 'Cannot follow yourself', code: 'BAD_REQUEST' } }, 400);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)'
    ).bind(currentUser.userId, targetId).run();

    // 通知被关注者
    const { sendNotification, NotificationType } = await import('../utils/notify');
    await sendNotification(
      c.env.DB,
      targetId,
      NotificationType.FOLLOW,
      '你有新的粉丝',
      `${currentUser.username} 关注了你`,
      `/users/${currentUser.username}`
    );

    return c.json({ success: true, data: { following: true, message: 'Followed' } }, 201);
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return c.json({ success: false, error: { message: 'Already following', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to follow user', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// DELETE /users/:username/follow — 取关
users.delete('/:username/follow', authMiddleware, async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');

  const target = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (!target) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare(
    'DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?'
  ).bind(currentUser.userId, (target as any).id).run();

  return c.json({ success: true, data: { following: false, message: 'Unfollowed' } });
});

// GET /users/:username/followers — 粉丝列表
users.get('/:username/followers', async (c) => {
  const username = c.req.param('username');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const target = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (!target) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM user_follows WHERE following_id = ?'
  ).bind((target as any).id).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.avatar_url, u.bio, uf.created_at as followed_at
     FROM user_follows uf JOIN users u ON uf.follower_id = u.id
     WHERE uf.following_id = ?
     ORDER BY uf.created_at DESC LIMIT ? OFFSET ?`
  ).bind((target as any).id, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      users: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /users/:username/following — 关注列表
users.get('/:username/following', async (c) => {
  const username = c.req.param('username');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const target = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (!target) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM user_follows WHERE follower_id = ?'
  ).bind((target as any).id).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.avatar_url, u.bio, uf.created_at as followed_at
     FROM user_follows uf JOIN users u ON uf.following_id = u.id
     WHERE uf.follower_id = ?
     ORDER BY uf.created_at DESC LIMIT ? OFFSET ?`
  ).bind((target as any).id, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      users: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

users.put('/profile', authMiddleware, async (c) => {
  const user = c.get('user');
  const body: any = await c.req.json();
  const avatarUrl = body.avatar_url;
  const bio = body.bio;
  const signature = body.signature;

  // Validate bio length
  if (bio !== undefined && bio.length > 500) {
    return c.json({ success: false, error: { message: 'Bio too long (max 500 characters)', code: 'BAD_REQUEST' } }, 400);
  }

  // Validate signature length
  if (signature !== undefined && signature.length > 200) {
    return c.json({ success: false, error: { message: 'Signature too long (max 200 characters)', code: 'BAD_REQUEST' } }, 400);
  }

  // Build update query dynamically
  const updates: string[] = [];
  const params: any[] = [];
  if (avatarUrl !== undefined) { updates.push('avatar_url = ?'); params.push(avatarUrl); }
  if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
  if (signature !== undefined) { updates.push('signature = ?'); params.push(signature); }

  if (updates.length === 0) {
    return c.json({ success: false, error: { message: 'No fields to update', code: 'BAD_REQUEST' } }, 400);
  }

  params.push(user.userId);
  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  const updatedUser = await c.env.DB.prepare('SELECT id, username, avatar_url, bio, signature, role, created_at FROM users WHERE id = ?').bind(user.userId).first();
  return c.json({ success: true, data: { user: updatedUser } });
});

users.put('/change-password', authMiddleware, async (c) => {
  const user = c.get('user');
  const body: any = await c.req.json();
  const oldPassword = body.old_password;
  const newPassword = body.new_password;

  if (!oldPassword || !newPassword) {
    return c.json({ success: false, error: { message: 'Missing old_password or new_password', code: 'BAD_REQUEST' } }, 400);
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return c.json({ success: false, error: { message: passwordError, code: 'BAD_REQUEST' } }, 400);
  }

  const dbUser: any = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.userId).first();

  if (!dbUser?.password_hash) {
    // OAuth user without password - allow setting initial password
    const hash = bcrypt.hashSync(newPassword, 10);
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, user.userId).run();
    return c.json({ success: true, data: { message: 'Password set successfully' } });
  }

  if (!bcrypt.compareSync(oldPassword, dbUser.password_hash)) {
    return c.json({ success: false, error: { message: 'Old password is incorrect', code: 'UNAUTHORIZED' } }, 401);
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, user.userId).run();
  return c.json({ success: true, data: { message: 'Password changed successfully' } });
});

// GET /users/export — 导出当前用户全部数据(隐私合规:用户可下载自己的数据)
users.get('/export', authMiddleware, async (c) => {
  const user = c.get('user');
  const uid = user.userId;

  const [profile, submissions, notes, blogs, solutions, discussions, favorites, collections, tickets, follows] = await Promise.all([
    c.env.DB.prepare('SELECT id, username, email, avatar_url, bio, signature, role, created_at FROM users WHERE id = ?').bind(uid).first(),
    c.env.DB.prepare('SELECT id, problem_id, language, source_code, status, score, time_used, memory_used, created_at FROM submissions WHERE user_id = ? ORDER BY id').bind(uid).all(),
    c.env.DB.prepare('SELECT problem_id, content, is_public, created_at, updated_at FROM problem_notes WHERE user_id = ? ORDER BY id').bind(uid).all(),
    c.env.DB.prepare('SELECT id, title, content, tags, status, created_at, updated_at FROM blogs WHERE user_id = ? ORDER BY id').bind(uid).all(),
    c.env.DB.prepare('SELECT id, problem_id, title, content, language, review_status, created_at FROM solutions WHERE user_id = ? ORDER BY id').bind(uid).all(),
    c.env.DB.prepare('SELECT id, problem_id, title, content, category, created_at FROM discussions WHERE user_id = ? ORDER BY id').bind(uid).all(),
    c.env.DB.prepare('SELECT f.problem_id, f.created_at, p.title as problem_title FROM favorites f JOIN problems p ON f.problem_id = p.id WHERE f.user_id = ? ORDER BY f.id').bind(uid).all(),
    c.env.DB.prepare('SELECT pc.id, pc.name, pc.description, pc.is_public, pc.created_at FROM problem_collections pc WHERE pc.user_id = ? ORDER BY pc.id').bind(uid).all(),
    c.env.DB.prepare('SELECT id, title, content, category, priority, status, created_at FROM tickets WHERE user_id = ? ORDER BY id').bind(uid).all(),
    c.env.DB.prepare('SELECT u.username as following_username, uf.created_at FROM user_follows uf JOIN users u ON uf.following_id = u.id WHERE uf.follower_id = ? ORDER BY uf.id').bind(uid).all(),
  ]);

  const data = {
    exported_at: new Date().toISOString(),
    profile: profile,
    submissions: submissions.results,
    notes: notes.results,
    blogs: blogs.results,
    solutions: solutions.results,
    discussions: discussions.results,
    favorites: favorites.results,
    collections: collections.results,
    tickets: tickets.results,
    following: follows.results,
  };

  const json = JSON.stringify(data, null, 2);
  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="user-${uid}-data.json"`);
  c.header('Cache-Control', 'no-store');
  return c.body(json);
});

export default users;
