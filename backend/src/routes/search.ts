import { Hono } from 'hono';
import { AppType } from '../types';
import { escapeLikeWildcard } from '../utils/helpers';

const search = new Hono<AppType>();

// ── Search Suggestions (for autocomplete) ──
// GET /search/suggestions?q=keyword — returns top 3 results per category
search.get('/suggestions', async (c) => {
  const q = (c.req.query('q') || '').trim();

  if (!q || q.length < 2) {
    return c.json({ success: true, data: { suggestions: [] } });
  }

  const like = `%${escapeLikeWildcard(q)}%`;
  const limit = 3;
  const suggestions: any[] = [];

  // Top problems
  const problems = await c.env.DB.prepare(
    `SELECT id, title, slug, difficulty, tags, 'problem' as type
     FROM problems WHERE is_public = 1 AND (title LIKE ? OR slug LIKE ?)
     LIMIT ?`
  ).bind(like, like, limit).all();
  for (const p of problems.results as any[]) {
    suggestions.push({
      type: 'problem',
      id: p.id,
      title: p.title,
      subtitle: `难度: ${p.difficulty}`,
      url: `/problems/${p.slug}`,
    });
  }

  // Top users
  const users = await c.env.DB.prepare(
    `SELECT id, username, avatar_url, 'user' as type
     FROM users WHERE username LIKE ? LIMIT ?`
  ).bind(like, limit).all();
  for (const u of users.results as any[]) {
    suggestions.push({
      type: 'user',
      id: u.id,
      title: u.username,
      subtitle: '用户',
      avatar_url: u.avatar_url,
      url: `/users/${u.username}`,
    });
  }

  // Top blogs
  const blogs = await c.env.DB.prepare(
    `SELECT b.id, b.title, 'blog' as type, u.username
     FROM blogs b JOIN users u ON b.user_id = u.id
     WHERE b.status = 'published' AND b.title LIKE ? LIMIT ?`
  ).bind(like, limit).all();
  for (const b of blogs.results as any[]) {
    suggestions.push({
      type: 'blog',
      id: b.id,
      title: b.title,
      subtitle: `by ${b.username}`,
      url: `/blogs/${b.id}`,
    });
  }

  // Top discussions
  const discussions = await c.env.DB.prepare(
    `SELECT d.id, d.title, 'discussion' as type, u.username
     FROM discussions d JOIN users u ON d.user_id = u.id
     WHERE d.title LIKE ? LIMIT ?`
  ).bind(like, limit).all();
  for (const d of discussions.results as any[]) {
    suggestions.push({
      type: 'discussion',
      id: d.id,
      title: d.title,
      subtitle: `by ${d.username}`,
      url: `/discussions/${d.id}`,
    });
  }

  // Sort: problems first, then users, then blogs, then discussions
  const typeOrder: Record<string, number> = { problem: 0, user: 1, blog: 2, discussion: 3 };
  suggestions.sort((a, b) => (typeOrder[a.type] || 0) - (typeOrder[b.type] || 0));

  return c.json({
    success: true,
    data: { suggestions: suggestions.slice(0, 8), query: q },
  });
});

// GET /search?q=keyword&type=all|problems|users|blogs|discussions
search.get('/', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const type = c.req.query('type') || 'all';
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(20, Math.max(1, parseInt(c.req.query('pageSize') || '10')));
  const offset = (page - 1) * pageSize;

  if (!q || q.length < 1) {
    return c.json({ success: true, data: { results: [], total: 0 } });
  }

  const results: any[] = [];
  const like = `%${escapeLikeWildcard(q)}%`;

  // Search problems
  if (type === 'all' || type === 'problems') {
    const problems = await c.env.DB.prepare(
      `SELECT id, title, slug, difficulty, tags, 'problem' as type,
              (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id AND status = 'accepted') as accepted_count
       FROM problems WHERE is_public = 1 AND (title LIKE ? OR slug LIKE ?)
       LIMIT ? OFFSET ?`
    ).bind(like, like, pageSize, offset).all();
    for (const p of problems.results as any[]) {
      results.push({
        type: 'problem',
        id: p.id,
        title: p.title,
        slug: p.slug,
        difficulty: p.difficulty,
        tags: p.tags,
        accepted_count: p.accepted_count,
        url: `/problems/${p.slug}`,
      });
    }
  }

  // Search users
  if (type === 'all' || type === 'users') {
    const users = await c.env.DB.prepare(
      `SELECT id, username, avatar_url, 'user' as type
       FROM users WHERE username LIKE ?
       LIMIT ? OFFSET ?`
    ).bind(like, pageSize, offset).all();
    for (const u of users.results as any[]) {
      results.push({
        type: 'user',
        id: u.id,
        title: u.username,
        username: u.username,
        avatar_url: u.avatar_url,
        url: `/users/${u.username}`,
      });
    }
  }

  // Search blogs
  if (type === 'all' || type === 'blogs') {
    const blogs = await c.env.DB.prepare(
      `SELECT b.id, b.title, b.tags, b.status, b.created_at, 'blog' as type,
              u.username
       FROM blogs b JOIN users u ON b.user_id = u.id
       WHERE b.status = 'published' AND b.title LIKE ?
       LIMIT ? OFFSET ?`
    ).bind(like, pageSize, offset).all();
    for (const b of blogs.results as any[]) {
      results.push({
        type: 'blog',
        id: b.id,
        title: b.title,
        username: b.username,
        created_at: b.created_at,
        url: `/blogs/${b.id}`,
      });
    }
  }

  // Search discussions
  if (type === 'all' || type === 'discussions') {
    const discussions = await c.env.DB.prepare(
      `SELECT d.id, d.title, d.reply_count, d.created_at, 'discussion' as type,
              u.username
       FROM discussions d JOIN users u ON d.user_id = u.id
       WHERE d.title LIKE ?
       LIMIT ? OFFSET ?`
    ).bind(like, pageSize, offset).all();
    for (const d of discussions.results as any[]) {
      results.push({
        type: 'discussion',
        id: d.id,
        title: d.title,
        username: d.username,
        reply_count: d.reply_count,
        created_at: d.created_at,
        url: `/discussions/${d.id}`,
      });
    }
  }

  // Sort: problems first, then users, then blogs, then discussions
  const typeOrder: Record<string, number> = { problem: 0, user: 1, blog: 2, discussion: 3 };
  results.sort((a, b) => (typeOrder[a.type] || 0) - (typeOrder[b.type] || 0));

  return c.json({
    success: true,
    data: {
      results: results.slice(0, pageSize),
      total: results.length,
      query: q,
    },
  });
});

export default search;