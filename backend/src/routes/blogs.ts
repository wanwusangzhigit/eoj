import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';
import { sendNotification, NotificationType } from '../utils/notify';

const blogs = new Hono<AppType>();

// GET /blogs — 博客列表
blogs.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const sort = c.req.query('sort') || 'latest';
  const tag = c.req.query('tag');
  const offset = (page - 1) * pageSize;

  let query = `SELECT b.id, b.title, b.tags, b.view_count, b.like_count, b.comment_count, b.created_at,
       u.id as user_id, u.username, u.avatar_url
     FROM blogs b JOIN users u ON b.user_id = u.id WHERE b.status = 'published'`;
  let countQuery = "SELECT COUNT(*) as total FROM blogs WHERE status = 'published'";
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (tag) {
    query += ' AND b.tags LIKE ?';
    countQuery += ' AND tags LIKE ?';
    binds.push(`%${tag}%`);
    countBinds.push(`%${tag}%`);
  }

  const orderBy = sort === 'hot' ? 'b.like_count DESC, b.created_at DESC' : 'b.created_at DESC';
  query += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      blogs: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /blogs/:id — 详情（浏览数 +1）
blogs.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const blog = await c.env.DB.prepare(
    `SELECT b.*, u.username, u.avatar_url
     FROM blogs b JOIN users u ON b.user_id = u.id WHERE b.id = ?`
  ).bind(id).first();

  if (!blog) {
    return c.json({ success: false, error: { message: 'Blog not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare('UPDATE blogs SET view_count = view_count + 1 WHERE id = ?').bind(id).run();

  return c.json({ success: true, data: { blog } });
});

// POST /blogs — 创建博客
blogs.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { title, content, tags, status } = body;

  if (!title || !content) {
    return c.json({ success: false, error: { message: 'title and content are required', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO blogs (user_id, title, content, tags, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.userId, title, content, tags || '', status || 'published').run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Blog created' } }, 201);
});

// PUT /blogs/:id — 编辑（owner）
blogs.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const blog = await c.env.DB.prepare('SELECT user_id FROM blogs WHERE id = ?').bind(id).first();

  if (!blog) {
    return c.json({ success: false, error: { message: 'Blog not found', code: 'NOT_FOUND' } }, 404);
  }
  if ((blog as any).user_id !== user.userId && user.role !== 'admin' && user.role !== 'super_admin' && user.userId !== 1) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const body = await c.req.json();
  const { title, content, tags, status } = body;

  await c.env.DB.prepare(
    `UPDATE blogs SET title = COALESCE(?, title), content = COALESCE(?, content),
       tags = COALESCE(?, tags), status = COALESCE(?, status),
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(title ?? null, content ?? null, tags ?? null, status ?? null, id).run();

  return c.json({ success: true, data: { message: 'Blog updated' } });
});

// DELETE /blogs/:id — 删除
blogs.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const blog = await c.env.DB.prepare('SELECT user_id FROM blogs WHERE id = ?').bind(id).first();

  if (!blog) {
    return c.json({ success: false, error: { message: 'Blog not found', code: 'NOT_FOUND' } }, 404);
  }
  if ((blog as any).user_id !== user.userId && user.role !== 'admin' && user.role !== 'super_admin' && user.userId !== 1) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM blogs WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { message: 'Blog deleted' } });
});

// POST /blogs/:id/like — 点赞（已点则取消）
blogs.post('/:id/like', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));

  const blog = await c.env.DB.prepare('SELECT user_id FROM blogs WHERE id = ?').bind(id).first();
  if (!blog) {
    return c.json({ success: false, error: { message: 'Blog not found', code: 'NOT_FOUND' } }, 404);
  }

  const existing = await c.env.DB.prepare(
    'SELECT 1 FROM blog_likes WHERE blog_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();

  if (existing) {
    await c.env.DB.prepare('DELETE FROM blog_likes WHERE blog_id = ? AND user_id = ?').bind(id, user.userId).run();
    await c.env.DB.prepare('UPDATE blogs SET like_count = like_count - 1 WHERE id = ?').bind(id).run();
    return c.json({ success: true, data: { liked: false, message: 'Unliked' } });
  } else {
    await c.env.DB.prepare('INSERT INTO blog_likes (blog_id, user_id) VALUES (?, ?)').bind(id, user.userId).run();
    await c.env.DB.prepare('UPDATE blogs SET like_count = like_count + 1 WHERE id = ?').bind(id).run();
    return c.json({ success: true, data: { liked: true, message: 'Liked' } });
  }
});

// GET /blogs/:id/like-status — 当前用户是否已点赞
blogs.get('/:id/like-status', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const existing = await c.env.DB.prepare(
    'SELECT 1 FROM blog_likes WHERE blog_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();
  return c.json({ success: true, data: { liked: !!existing } });
});

// GET /blogs/:id/comments — 评论列表
blogs.get('/:id/comments', async (c) => {
  const id = parseInt(c.req.param('id'));
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM blog_comments WHERE blog_id = ?'
  ).bind(id).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT bc.id, bc.blog_id, bc.user_id, bc.content, bc.created_at, u.username, u.avatar_url
     FROM blog_comments bc JOIN users u ON bc.user_id = u.id
     WHERE bc.blog_id = ?
     ORDER BY bc.created_at ASC LIMIT ? OFFSET ?`
  ).bind(id, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      comments: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /blogs/:id/comments — 评论
blogs.post('/:id/comments', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json();
  const { content } = body;

  if (!content || !content.trim()) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }

  const blog = await c.env.DB.prepare('SELECT user_id, title FROM blogs WHERE id = ?').bind(id).first();
  if (!blog) {
    return c.json({ success: false, error: { message: 'Blog not found', code: 'NOT_FOUND' } }, 404);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO blog_comments (blog_id, user_id, content) VALUES (?, ?, ?)'
  ).bind(id, user.userId, content.trim()).run();

  await c.env.DB.prepare('UPDATE blogs SET comment_count = comment_count + 1 WHERE id = ?').bind(id).run();

  // 通知博客作者
  if ((blog as any).user_id !== user.userId) {
    await sendNotification(
      c.env.DB,
      (blog as any).user_id,
      NotificationType.MENTION,
      '有人评论了你的博客',
      `${user.username} 评论了你的《${(blog as any).title}》`,
      `/blogs/${id}`
    );
  }

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Comment posted' } }, 201);
});

export default blogs;
