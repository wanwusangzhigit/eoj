import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';

const achievements = new Hono<AppType>();

// 成就定义
const ACHIEVEMENT_DEFS: Record<string, { title: string; icon: string; desc: string }> = {
  first_ac:      { title: '初露锋芒', icon: '🎯', desc: '第一次通过题目' },
  ten_ac:        { title: '小试牛刀', icon: '⭐', desc: '通过 10 道题目' },
  fifty_ac:      { title: '渐入佳境', icon: '🌟', desc: '通过 50 道题目' },
  hundred_ac:    { title: '百题斩', icon: '💯', desc: '通过 100 道题目' },
  twohundred_ac: { title: '题海战术', icon: '🏆', desc: '通过 200 道题目' },
  first_contest: { title: '初战赛场', icon: '⚔️', desc: '第一次参加比赛' },
  first_blog:    { title: '初试啼声', icon: '📝', desc: '发布第一篇博客' },
  first_solution:{ title: '乐于分享', icon: '📖', desc: '发布第一篇题解' },
};

// GET /achievements — 获取当前用户的成就列表
achievements.get('/', authMiddleware, async (c) => {
  const user = c.get('user');

  const userAchievements = await c.env.DB.prepare(
    'SELECT achievement_key, achieved_at FROM user_achievements WHERE user_id = ?'
  ).bind(user.userId).all();

  const earnedKeys = new Set((userAchievements.results as any[]).map((r) => r.achievement_key));
  const earnedMap = new Map((userAchievements.results as any[]).map((r) => [r.achievement_key, r.achieved_at]));

  const allAchievements = Object.entries(ACHIEVEMENT_DEFS).map(([key, def]) => ({
    key,
    ...def,
    earned: earnedKeys.has(key),
    earned_at: earnedMap.get(key) || null,
  }));

  return c.json({
    success: true,
    data: { achievements: allAchievements },
  });
});

// GET /achievements/check — 检查并发放新成就
achievements.get('/check', authMiddleware, async (c) => {
  const user = c.get('user');

  // 统计已AC题目数
  const acCount: any = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT problem_id) as cnt FROM submissions WHERE user_id = ? AND status = 'accepted'"
  ).bind(user.userId).first();
  const solved = (acCount as any)?.cnt || 0;

  // 检查各项成就条件
  const checks: { key: string; condition: boolean }[] = [
    { key: 'first_ac', condition: solved >= 1 },
    { key: 'ten_ac', condition: solved >= 10 },
    { key: 'fifty_ac', condition: solved >= 50 },
    { key: 'hundred_ac', condition: solved >= 100 },
    { key: 'twohundred_ac', condition: solved >= 200 },
  ];

  // 检查参赛次数
  const contestCount: any = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM contest_participants WHERE user_id = ?'
  ).bind(user.userId).first();
  if ((contestCount as any)?.cnt > 0) {
    checks.push({ key: 'first_contest', condition: true });
  }

  // 检查博客数量
  const blogCount: any = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM blogs WHERE user_id = ? AND status = 'published'"
  ).bind(user.userId).first();
  if ((blogCount as any)?.cnt > 0) {
    checks.push({ key: 'first_blog', condition: true });
  }

  // 检查题解数量
  const solutionCount: any = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM solutions WHERE user_id = ?'
  ).bind(user.userId).first();
  if ((solutionCount as any)?.cnt > 0) {
    checks.push({ key: 'first_solution', condition: true });
  }

  const newAchievements: string[] = [];
  for (const check of checks) {
    if (!check.condition) continue;
    const existing = await c.env.DB.prepare(
      'SELECT id FROM user_achievements WHERE user_id = ? AND achievement_key = ?'
    ).bind(user.userId, check.key).first();
    if (!existing) {
      await c.env.DB.prepare(
        'INSERT INTO user_achievements (user_id, achievement_key) VALUES (?, ?)'
      ).bind(user.userId, check.key).run();
      newAchievements.push(check.key);
    }
  }

  return c.json({
    success: true,
    data: {
      new_achievements: newAchievements.map((key) => ({
        key,
        ...ACHIEVEMENT_DEFS[key],
      })),
      solved_count: solved,
    },
  });
});

export default achievements;