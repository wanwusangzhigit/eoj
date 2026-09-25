import { Hono } from 'hono';
import { AppType } from '../types';
import { parseLimit } from '../utils/helpers';

const rankings = new Hono<AppType>();

rankings.get('/', async (c) => {
  // 审计 #H-9: 旧实现 `Math.min(50, parseInt(...))` 没有下界,
  // ?limit=-1(SQLite 解释为无限制)或 ?limit=abc(NaN)都能绕过分页,
  // 直接返回整张 users 表聚合结果。这里强制 [1, 50] 范围。
  const limit = parseLimit(c.req.query('limit'), { min: 1, max: 50, fallback: 20 });

  // 查询每个用户解决的题目数（统计 accepted 且 unique 的题目）
  const results = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.avatar_url, u.created_at,
      COUNT(DISTINCT s.problem_id) as solved_count
     FROM users u
     LEFT JOIN submissions s ON u.id = s.user_id AND s.status = 'accepted'
     GROUP BY u.id, u.username, u.avatar_url, u.created_at
     ORDER BY solved_count DESC, u.id ASC
     LIMIT ?`
  )
  .bind(limit)
  .all();

  const rankings = results.results.map((user: any, index: number) => ({
    rank: index + 1,
    user_id: user.id,
    username: user.username,
    avatar_url: user.avatar_url,
    solved_count: user.solved_count || 0,
  }));

  return c.json({ success: true, data: { rankings } });
});

export default rankings;
