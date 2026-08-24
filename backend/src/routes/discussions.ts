import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';

import { captchaMiddleware } from '../middleware/captcha';
import { sendNotification, NotificationType } from '../utils/notify';

const discussions = new Hono<AppType>();

// List discussions
discussions.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const problemId = c.req.query('problem_id');
  const category = c.req.query('category');
  const sort = c.req.query('sort') || 'newest';
  const offset = (page - 1) * pageSize;

  let query = 'SELECT d.*, u.username FROM discussions d JOIN users u ON d.user_id = u.id WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as total FROM discussions WHERE 1=1';
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (problemId !== undefined && problemId !== null && problemId !== '') {
    if (problemId === 'null' || problemId === '0') {
      query += ' AND d.problem_id IS NULL';
      countQuery += ' AND problem_id IS NULL';
    } else {
      query += ' AND d.problem_id = ?';
      countQuery += ' AND problem_id = ?';
      binds.push(parseInt(problemId));
      countBinds.push(parseInt(problemId));
    }
  }

  if (category) {
    query += ' AND d.category = ?';
    countQuery += ' AND category = ?';
    binds.push(category);
    countBinds.push(category);
  }

  // Pinned discussions always shown first, then sort by requested order
  const orderClause = sort === 'active'
    ? 'ORDER BY d.is_pinned DESC, d.reply_count DESC, d.created_at DESC LIMIT ? OFFSET ?'
    : 'ORDER BY d.is_pinned DESC, d.created_at DESC LIMIT ? OFFSET ?';
  query += ` ${orderClause}`;

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      discussions: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// Get discussion detail with replies
discussions.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));

  const discussion = await c.env.DB.prepare(
    'SELECT d.*, u.username FROM discussions d JOIN users u ON d.user_id = u.id WHERE d.id = ?'
  ).bind(id).first();

  if (!discussion) {
    return c.json({ success: false, error: { message: 'Discussion not found', code: 'NOT_FOUND' } }, 404);
  }

  // Increment view_count
  await c.env.DB.prepare(
    'UPDATE discussions SET view_count = view_count + 1 WHERE id = ?'
  ).bind(id).run();

  // 解析当前用户(用于 liked_by_me)
  const authHeader = c.req.header('Authorization');
  let myUserId: number | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { verifyJWT } = await import('../utils/jwt');
    const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET, (c.env as any).JWT_SECRET_PREVIOUS);
    if (payload) myUserId = payload.userId;
  }

  const replies = await c.env.DB.prepare(
    `SELECT dr.*, u.username,
            (SELECT setting_value FROM user_settings WHERE user_id = u.id AND setting_key = 'title') as user_title,
            (SELECT COUNT(*) FROM discussion_reply_likes drl WHERE drl.reply_id = dr.id) as like_count,
            (SELECT u2.username FROM discussion_replies dr2 JOIN users u2 ON dr2.user_id = u2.id WHERE dr2.id = dr.parent_id) as parent_username
     FROM discussion_replies dr JOIN users u ON dr.user_id = u.id
     WHERE dr.discussion_id = ? ORDER BY dr.created_at ASC`
  ).bind(id).all();

  const replyList = replies.results.map((r: any) => ({ ...r, liked_by_me: false }));
  if (myUserId) {
    const replyIds = replyList.map((r: any) => r.id);
    if (replyIds.length > 0) {
      const placeholders = replyIds.map(() => '?').join(',');
      const likes = await c.env.DB.prepare(
        `SELECT reply_id FROM discussion_reply_likes WHERE user_id = ? AND reply_id IN (${placeholders})`
      ).bind(myUserId, ...replyIds).all();
      const likedIds = new Set((likes.results as any[]).map((l: any) => l.reply_id));
      for (const r of replyList) {
        r.liked_by_me = likedIds.has(r.id);
      }
    }
  }

  // Return discussion with updated view_count
  const viewCount = (discussion as any).view_count + 1;

  return c.json({
    success: true,
    data: {
      discussion: { ...(discussion as any), view_count: viewCount },
      replies: replyList,
    },
  });
});

// Create discussion
discussions.post('/', authMiddleware, captchaMiddleware('discussion'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { problem_id, title, content, category } = body;

  if (!title) {
    return c.json({ success: false, error: { message: 'title is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (!content) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (content.length > 200000) {
    return c.json({ success: false, error: { message: 'content must be at most 200000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  const validCategories = ['question', 'share', 'general'];
  if (category && !validCategories.includes(category)) {
    return c.json({ success: false, error: { message: 'category must be one of: question, share, general', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO discussions (problem_id, user_id, title, content, category) VALUES (?, ?, ?, ?, ?)'
  ).bind(problem_id || null, user.userId, title, content, category || 'question').run();

  const discussionId = result.meta.last_row_id;

  return c.json({ success: true, data: { id: discussionId, message: 'Discussion created' } }, 201);
});

// Update discussion
discussions.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);
  const body = await c.req.json();
  const { title, content, category } = body;

  const discussion = await c.env.DB.prepare('SELECT * FROM discussions WHERE id = ?').bind(id).first();
  if (!discussion) {
    return c.json({ success: false, error: { message: 'Discussion not found', code: 'NOT_FOUND' } }, 404);
  }

  // Only author can edit
  if ((discussion as any).user_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Forbidden: only author can edit', code: 'FORBIDDEN' } }, 403);
  }

  const validCategories = ['question', 'share', 'general'];
  if (category && !validCategories.includes(category)) {
    return c.json({ success: false, error: { message: 'category must be one of: question, share, general', code: 'BAD_REQUEST' } }, 400);
  }
  if (title !== undefined && title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }
  if (content !== undefined && content.length > 200000) {
    return c.json({ success: false, error: { message: 'content must be at most 200000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  const updates: string[] = [];
  const binds: any[] = [];

  if (title !== undefined) { updates.push('title = ?'); binds.push(title); }
  if (content !== undefined) { updates.push('content = ?'); binds.push(content); }
  if (category !== undefined) { updates.push('category = ?'); binds.push(category); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    binds.push(id);
    await c.env.DB.prepare(`UPDATE discussions SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  }

  return c.json({ success: true, data: { message: 'Discussion updated' } });
});

// Delete discussion
discussions.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const discussion = await c.env.DB.prepare('SELECT * FROM discussions WHERE id = ?').bind(id).first();
  if (!discussion) {
    return c.json({ success: false, error: { message: 'Discussion not found', code: 'NOT_FOUND' } }, 404);
  }

  // Only author or admin can delete
  const isOwner = (discussion as any).user_id === user.userId;
  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;
  if (!isOwner && !isAdmin) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  // Delete replies first (cascade should handle this, but explicit for safety)
  await c.env.DB.prepare('DELETE FROM discussion_replies WHERE discussion_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM discussions WHERE id = ?').bind(id).run();

  return c.json({ success: true, data: { message: 'Discussion deleted' } });
});

// Create reply (支持回复 parent_id 与 @提及通知)
discussions.post('/:id/replies', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);
  const body = await c.req.json();
  const { content, parent_id } = body;

  if (!content) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }
  // (M9)长度上限:回复比主帖(content 200000)更紧凑,50000 字符足够,
  // 避免恶意发送超大回复撑爆 D1 行大小
  if (typeof content !== 'string' || content.length > 50000) {
    return c.json({ success: false, error: { message: 'content too long (max 50000 characters)', code: 'BAD_REQUEST' } }, 400);
  }

  const discussion = await c.env.DB.prepare('SELECT * FROM discussions WHERE id = ?').bind(id).first();
  if (!discussion) {
    return c.json({ success: false, error: { message: 'Discussion not found', code: 'NOT_FOUND' } }, 404);
  }

  let parentReply: any = null;
  if (parent_id) {
    parentReply = await c.env.DB.prepare(
      'SELECT id, user_id, content FROM discussion_replies WHERE id = ? AND discussion_id = ?'
    ).bind(parseInt(parent_id), id).first();
    if (!parentReply) {
      return c.json({ success: false, error: { message: 'Parent reply not found', code: 'BAD_REQUEST' } }, 400);
    }
  }

  const trimmed = content.trim();
  await c.env.DB.prepare(
    'INSERT INTO discussion_replies (discussion_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)'
  ).bind(id, user.userId, trimmed, parentReply ? parentReply.id : null).run();

  // Increment reply_count and update updated_at
  await c.env.DB.prepare(
    "UPDATE discussions SET reply_count = reply_count + 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run();

  // 通知被回复者(非本人)
  if (parentReply && (parentReply as any).user_id !== user.userId) {
    await sendNotification(
      c.env.DB,
      (parentReply as any).user_id,
      NotificationType.MENTION,
      '有人回复了你的回复',
      `${user.username} 回复了你的回复`,
      `/discussions/${id}`
    );
  }

  // @提及通知
  const mentionRegex = /@([a-zA-Z0-9_]{3,20})/g;
  const mentioned: Set<number> = new Set();
  let m: RegExpExecArray | null;
  while ((m = mentionRegex.exec(trimmed)) !== null) {
    const row: any = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(m[1]).first();
    if (row && row.id !== user.userId && row.id !== (parentReply as any)?.user_id) {
      mentioned.add(row.id);
    }
  }
  for (const uid of mentioned) {
    await sendNotification(c.env.DB, uid, NotificationType.MENTION, '有人在回复中提到了你', `${user.username} 在回复中提到了你`, `/discussions/${id}`);
  }

  return c.json({ success: true, data: { message: 'Reply added' } }, 201);
});

// POST /discussions/:id/replies/:replyId/like — 回复点赞/取消
discussions.post('/:id/replies/:replyId/like', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);
  const replyId = parseInt(c.req.param('replyId')!);

  const reply = await c.env.DB.prepare(
    'SELECT id, user_id FROM discussion_replies WHERE id = ? AND discussion_id = ?'
  ).bind(replyId, id).first();
  if (!reply) {
    return c.json({ success: false, error: { message: 'Reply not found', code: 'NOT_FOUND' } }, 404);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM discussion_reply_likes WHERE reply_id = ? AND user_id = ?'
  ).bind(replyId, user.userId).first();

  if (existing) {
    await c.env.DB.prepare('DELETE FROM discussion_reply_likes WHERE reply_id = ? AND user_id = ?').bind(replyId, user.userId).run();
    return c.json({ success: true, data: { liked: false, message: 'Unliked' } });
  }

  await c.env.DB.prepare('INSERT INTO discussion_reply_likes (reply_id, user_id) VALUES (?, ?)').bind(replyId, user.userId).run();

  if ((reply as any).user_id !== user.userId) {
    await sendNotification(
      c.env.DB,
      (reply as any).user_id,
      NotificationType.MENTION,
      '有人点赞了你的回复',
      `${user.username} 点赞了你的回复`,
      `/discussions/${id}`
    );
  }

  return c.json({ success: true, data: { liked: true, message: 'Liked' } });
});

// Delete reply
discussions.delete('/:id/replies/:replyId', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);
  const replyId = parseInt(c.req.param('replyId')!);

  const reply = await c.env.DB.prepare(
    'SELECT * FROM discussion_replies WHERE id = ? AND discussion_id = ?'
  ).bind(replyId, id).first();

  if (!reply) {
    return c.json({ success: false, error: { message: 'Reply not found', code: 'NOT_FOUND' } }, 404);
  }

  // Only author or admin can delete
  const isOwner = (reply as any).user_id === user.userId;
  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;
  if (!isOwner && !isAdmin) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM discussion_replies WHERE id = ?').bind(replyId).run();

  // Decrement reply_count
  await c.env.DB.prepare(
    'UPDATE discussions SET reply_count = reply_count - 1 WHERE id = ? AND reply_count > 0'
  ).bind(id).run();

  return c.json({ success: true, data: { message: 'Reply deleted' } });
});

export default discussions;
