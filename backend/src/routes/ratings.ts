import { Hono } from 'hono';
import { AppType } from '../types';

const ratings = new Hono<AppType>();

// GET /ratings/leaderboard — Rating 排行榜
ratings.get('/leaderboard', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM user_ratings'
  ).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT ur.user_id, u.username, u.avatar_url, ur.rating, ur.max_rating
     FROM user_ratings ur
     JOIN users u ON ur.user_id = u.id
     ORDER BY ur.rating DESC, ur.user_id ASC
     LIMIT ? OFFSET ?`
  )
    .bind(pageSize, offset)
    .all();

  const rankings = results.results.map((r: any, index: number) => ({
    ...r,
    rank: offset + index + 1,
  }));

  return c.json({
    success: true,
    data: {
      rankings,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
});

// GET /users/:username/rating — 获取用户 Rating 信息
ratings.get('/users/:username/rating', async (c) => {
  const username = c.req.param('username');

  const user = await c.env.DB.prepare(
    'SELECT id, username FROM users WHERE username = ?'
  )
    .bind(username)
    .first();

  if (!user) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }

  const userId = (user as any).id;

  const ratingInfo = await c.env.DB.prepare(
    'SELECT rating, max_rating FROM user_ratings WHERE user_id = ?'
  )
    .bind(userId)
    .first();

  const history = await c.env.DB.prepare(
    `SELECT rc.id, rc.contest_id, c.title as contest_title, rc.old_rating, rc.new_rating, rc.delta, rc.created_at
     FROM rating_changes rc
     LEFT JOIN contests c ON rc.contest_id = c.id
     WHERE rc.user_id = ?
     ORDER BY rc.created_at ASC`
  )
    .bind(userId)
    .all();

  return c.json({
    success: true,
    data: {
      rating: (ratingInfo as any)?.rating || 0,
      max_rating: (ratingInfo as any)?.max_rating || 0,
      history: history.results,
    },
  });
});

export default ratings;
