import { Hono } from 'hono';
import { AppType } from '../types';

const rankings = new Hono<AppType>();

rankings.get('/', async (c) => {
  const limit = Math.min(50, parseInt(c.req.query('limit') || '20'));

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
    id: user.id,
    username: user.username,
    avatar_url: user.avatar_url,
    solved_count: user.solved_count || 0,
  }));

  return c.json({ success: true, data: { rankings } });
});

export default rankings;
