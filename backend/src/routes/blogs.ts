import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';
import { sendNotification, NotificationType } from '../utils/notify';
import { captchaMiddleware } from '../middleware/captcha';
import { escapeLikeWildcard } from '../utils/helpers';

const blogs = new Hono<AppType>();

// GET /blogs — 博客列表(支持 mine=1 返回当前用户全部博客,含草稿)
blogs.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const sort = c.req.query('sort') || 'latest';
  const tag = c.req.query('tag');
  const mine = c.req.query('mine') === '1';
  const offset = (page - 1) * pageSize;

  // mine=1 时需要鉴权:解析 token 获取当前用户
  let myUserId: number | null = null;
  if (mine) {
    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const { verifyJWT } = await import('../utils/jwt');
      const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET, (c.env as any).JWT_SECRET_PREVIOUS);
      if (payload) myUserId = payload.userId;
    }
    if (!myUserId) {
      return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
    }
  }

  let query = `SELECT b.id, b.title, b.tags, b.status, b.view_count, b.like_count, b.comment_count, b.created_at,
       u.id as user_id, u.username, u.avatar_url
     FROM blogs b JOIN users u ON b.user_id = u.id WHERE 1=1`;
  let countQuery = 'SELECT COUNT(*) as total FROM blogs WHERE 1=1';
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (mine && myUserId) {
    query += ' AND b.user_id = ?';
    countQuery += ' AND user_id = ?';
    binds.push(myUserId);
    countBinds.push(myUserId);
  } else {
    query += " AND b.status = 'published'";
    countQuery += " AND status = 'published'";
  }

  if (tag && !mine) {
    query += " AND b.tags LIKE ? ESCAPE '\\'";
    countQuery += " AND tags LIKE ? ESCAPE '\\'";
    binds.push(`%${escapeLikeWildcard(tag)}%`);
    countBinds.push(`%${escapeLikeWildcard(tag)}%`);
  }

  const sortClauses: Record<string, string> = {
    latest: 'b.created_at DESC',
    hot: 'b.like_count DESC, b.created_at DESC',
    oldest: 'b.created_at ASC',
    most_viewed: 'b.view_count DESC',
  };
  const orderBy = sortClauses[sort] || sortClauses.latest;
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
  const id = parseInt(c.req.param('id') || '0');
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
blogs.post('/', authMiddleware, captchaMiddleware('blog'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { title, content, tags, status } = body;

  if (!title || !content) {
    return c.json({ success: false, error: { message: 'title and content are required', code: 'BAD_REQUEST' } }, 400);
  }
  if (title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (content.length > 200000) {
    return c.json({ success: false, error: { message: 'content must be at most 200000 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (tags && tags.length > 500) {
    return c.json({ success: false, error: { message: 'tags must be at most 500 characters', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO blogs (user_id, title, content, tags, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.userId, title, content, tags || '', status || 'published').run();

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Blog created' } }, 201);
});

// PUT /blogs/:id — 编辑（owner）
blogs.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const blog = await c.env.DB.prepare('SELECT user_id FROM blogs WHERE id = ?').bind(id).first();

  if (!blog) {
    return c.json({ success: false, error: { message: 'Blog not found', code: 'NOT_FOUND' } }, 404);
  }
  if ((blog as any).user_id !== user.userId && user.role !== 'admin' && user.role !== 'super_admin' && user.userId !== 1) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const body = await c.req.json();
  const { title, content, tags, status } = body;

  if (title !== undefined && title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (content !== undefined && content.length > 200000) {
    return c.json({ success: false, error: { message: 'content must be at most 200000 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (tags !== undefined && tags.length > 500) {
    return c.json({ success: false, error: { message: 'tags must be at most 500 characters', code: 'BAD_REQUEST' } }, 400);
  }

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
  const id = parseInt(c.req.param('id') || '0');
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
  const id = parseInt(c.req.param('id') || '0');

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
  const id = parseInt(c.req.param('id') || '0');
  const existing = await c.env.DB.prepare(
    'SELECT 1 FROM blog_likes WHERE blog_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();
  return c.json({ success: true, data: { liked: !!existing } });
});

// GET /blogs/:id/comments — 评论列表(含父评论引用、点赞数、我的点赞)
blogs.get('/:id/comments', async (c) => {
  const id = parseInt(c.req.param('id') || '0');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50')));
  const offset = (page - 1) * pageSize;
  const authHeader = c.req.header('Authorization');
  let myUserId: number | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { verifyJWT } = await import('../utils/jwt');
    const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET, (c.env as any).JWT_SECRET_PREVIOUS);
    if (payload) myUserId = payload.userId;
  }

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM blog_comments WHERE blog_id = ?'
  ).bind(id).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT bc.id, bc.blog_id, bc.user_id, bc.content, bc.parent_id, bc.created_at,
            u.username, u.avatar_url,
            (SELECT setting_value FROM user_settings WHERE user_id = u.id AND setting_key = 'title') as user_title,
            (SELECT COUNT(*) FROM blog_comment_likes bcl WHERE bcl.comment_id = bc.id) as like_count,
            (SELECT u2.username FROM blog_comments bc2 JOIN users u2 ON bc2.user_id = u2.id WHERE bc2.id = bc.parent_id) as parent_username,
            (SELECT bc2.content FROM blog_comments bc2 WHERE bc2.id = bc.parent_id) as parent_content
     FROM blog_comments bc JOIN users u ON bc.user_id = u.id
     WHERE bc.blog_id = ?
     ORDER BY bc.created_at ASC LIMIT ? OFFSET ?`
  ).bind(id, pageSize, offset).all();

  const comments = results.results.map((r: any) => ({
    ...r,
    liked_by_me: myUserId ? false : false,
  }));

  if (myUserId) {
    const commentIds = comments.map((c: any) => c.id);
    if (commentIds.length > 0) {
      const placeholders = commentIds.map(() => '?').join(',');
      const likes = await c.env.DB.prepare(
        `SELECT comment_id FROM blog_comment_likes WHERE user_id = ? AND comment_id IN (${placeholders})`
      ).bind(myUserId, ...commentIds).all();
      const likedIds = new Set((likes.results as any[]).map((l: any) => l.comment_id));
      for (const c of comments) {
        c.liked_by_me = likedIds.has(c.id);
      }
    }
  }

  return c.json({
    success: true,
    data: {
      comments,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /blogs/:id/comments — 评论(支持回复 parent_id 与 @提及通知)
blogs.post('/:id/comments', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const body = await c.req.json();
  const { content, parent_id } = body;

  if (!content || !content.trim()) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }

  const blog = await c.env.DB.prepare('SELECT user_id, title FROM blogs WHERE id = ?').bind(id).first();
  if (!blog) {
    return c.json({ success: false, error: { message: 'Blog not found', code: 'NOT_FOUND' } }, 404);
  }

  let parentComment: any = null;
  if (parent_id) {
    parentComment = await c.env.DB.prepare(
      'SELECT id, user_id, content FROM blog_comments WHERE id = ? AND blog_id = ?'
    ).bind(parseInt(parent_id), id).first();
    if (!parentComment) {
      return c.json({ success: false, error: { message: 'Parent comment not found', code: 'BAD_REQUEST' } }, 400);
    }
  }

  const trimmed = content.trim();
  const result = await c.env.DB.prepare(
    'INSERT INTO blog_comments (blog_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)'
  ).bind(id, user.userId, trimmed, parentComment ? parentComment.id : null).run();

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

  // 通知被回复的父评论作者(非本人)
  if (parentComment && (parentComment as any).user_id !== user.userId) {
    await sendNotification(
      c.env.DB,
      (parentComment as any).user_id,
      NotificationType.MENTION,
      '有人回复了你的评论',
      `${user.username} 回复了你的评论`,
      `/blogs/${id}`
    );
  }

  // @提及通知:提取内容中的 @username
  const mentionRegex = /@([a-zA-Z0-9_]{3,20})/g;
  const mentioned: Set<number> = new Set();
  let m: RegExpExecArray | null;
  while ((m = mentionRegex.exec(trimmed)) !== null) {
    const row: any = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(m[1]).first();
    if (row && row.id !== user.userId && row.id !== (blog as any).user_id && row.id !== (parentComment as any)?.user_id) {
      mentioned.add(row.id);
    }
  }
  for (const uid of mentioned) {
    await sendNotification(c.env.DB, uid, NotificationType.MENTION, '有人在评论中提到了你', `${user.username} 在评论中提到了你`, `/blogs/${id}`);
  }

  return c.json({ success: true, data: { id: result.meta.last_row_id, message: 'Comment posted' } }, 201);
});

// POST /blogs/comments/:commentId/like — 评论点赞/取消
blogs.post('/comments/:commentId/like', authMiddleware, async (c) => {
  const user = c.get('user');
  const commentId = parseInt(c.req.param('commentId') || '0');

  const comment = await c.env.DB.prepare('SELECT id, user_id FROM blog_comments WHERE id = ?').bind(commentId).first();
  if (!comment) {
    return c.json({ success: false, error: { message: 'Comment not found', code: 'NOT_FOUND' } }, 404);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM blog_comment_likes WHERE comment_id = ? AND user_id = ?'
  ).bind(commentId, user.userId).first();

  if (existing) {
    await c.env.DB.prepare('DELETE FROM blog_comment_likes WHERE comment_id = ? AND user_id = ?').bind(commentId, user.userId).run();
    return c.json({ success: true, data: { liked: false, message: 'Unliked' } });
  }

  await c.env.DB.prepare('INSERT INTO blog_comment_likes (comment_id, user_id) VALUES (?, ?)').bind(commentId, user.userId).run();

  // 通知评论作者(非本人)
  if ((comment as any).user_id !== user.userId) {
    await sendNotification(
      c.env.DB,
      (comment as any).user_id,
      NotificationType.MENTION,
      '有人点赞了你的评论',
      `${user.username} 点赞了你的评论`,
      `/blogs/${(comment as any).blog_id}`
    );
  }

  return c.json({ success: true, data: { liked: true, message: 'Liked' } });
});

export default blogs;
