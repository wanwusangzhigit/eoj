import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { sendNotification, NotificationType } from '../utils/notify';
import { createRateLimiter } from '../middleware/rateLimit';

const messages = new Hono<AppType>();

// GET /messages/conversations — 会话列表（含最后一条消息预览 + 未读数）
messages.get('/conversations', authMiddleware, async (c) => {
  const user = c.get('user');

  const conversations = await c.env.DB.prepare(
    `SELECT
       cp.conversation_id as id,
       cp.last_read_at,
       (SELECT content FROM messages m WHERE m.conversation_id = cp.conversation_id ORDER BY m.created_at DESC LIMIT 1) as last_message,
       (SELECT created_at FROM messages m WHERE m.conversation_id = cp.conversation_id ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = cp.conversation_id AND m.created_at > COALESCE(cp.last_read_at, '1970-01-01') AND m.sender_id != ?) as unread_count,
       (SELECT u.username FROM conversation_participants cp2 JOIN users u ON cp2.user_id = u.id WHERE cp2.conversation_id = cp.conversation_id AND cp2.user_id != ? LIMIT 1) as other_username,
       (SELECT u.id FROM conversation_participants cp2 JOIN users u ON cp2.user_id = u.id WHERE cp2.conversation_id = cp.conversation_id AND cp2.user_id != ? LIMIT 1) as other_user_id,
       (SELECT u.avatar_url FROM conversation_participants cp2 JOIN users u ON cp2.user_id = u.id WHERE cp2.conversation_id = cp.conversation_id AND cp2.user_id != ? LIMIT 1) as other_avatar
     FROM conversation_participants cp
     WHERE cp.user_id = ?
     ORDER BY last_message_at DESC NULLS LAST`
  ).bind(user.userId, user.userId, user.userId, user.userId, user.userId).all();

  return c.json({ success: true, data: { conversations: conversations.results } });
});

// GET /messages/conversations/:id — 会话内消息（分页，倒序）
messages.get('/conversations/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50')));
  const offset = (page - 1) * pageSize;

  // 校验当前用户是否是会话参与者
  const participant = await c.env.DB.prepare(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
  ).bind(id, user.userId).first();
  if (!participant) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?'
  ).bind(id).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at, u.username as sender_name
     FROM messages m JOIN users u ON m.sender_id = u.id
     WHERE m.conversation_id = ?
     ORDER BY m.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(id, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      messages: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /messages/conversations — 创建会话或追加消息
// 安全约束(M10):内容长度上限避免单条消息撑爆 D1 行
messages.post('/conversations', authMiddleware, createRateLimiter('user_msg', 30, 60_000), async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { target_user_id, content } = body;

  if (!target_user_id || !content || !content.trim()) {
    return c.json({ success: false, error: { message: 'target_user_id and content are required', code: 'BAD_REQUEST' } }, 400);
  }
  // 内容长度上限:私信单条 5000 字符足够日常使用,且防 D1 行大小爆炸
  if (typeof content !== 'string' || content.length > 5000) {
    return c.json({ success: false, error: { message: 'content too long (max 5000 characters)', code: 'BAD_REQUEST' } }, 400);
  }

  if (parseInt(target_user_id) === user.userId) {
    return c.json({ success: false, error: { message: 'Cannot send message to yourself', code: 'BAD_REQUEST' } }, 400);
  }

  // 检查目标用户存在
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(target_user_id).first();
  if (!target) {
    return c.json({ success: false, error: { message: 'Target user not found', code: 'NOT_FOUND' } }, 404);
  }

  // 查找是否已有会话
  let conversationId: number;
  const existing = await c.env.DB.prepare(
    `SELECT cp1.conversation_id as id
     FROM conversation_participants cp1
     JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
     WHERE cp1.user_id = ? AND cp2.user_id = ?`
  ).bind(user.userId, target_user_id).first();

  if (existing) {
    conversationId = (existing as any).id;
  } else {
    // 创建新会话
    const result = await c.env.DB.prepare('INSERT INTO conversations DEFAULT VALUES').run();
    conversationId = result.meta.last_row_id as number;
    await c.env.DB.prepare(
      'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)'
    ).bind(conversationId, user.userId, conversationId, target_user_id).run();
  }

  // 插入消息
  await c.env.DB.prepare(
    'INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)'
  ).bind(conversationId, user.userId, content.trim()).run();

  // 更新会话时间
  await c.env.DB.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(conversationId).run();

  // 通知接收方
  await sendNotification(
    c.env.DB,
    target_user_id,
    NotificationType.MESSAGE,
    `收到来自 ${user.username} 的私信`,
    content.length > 50 ? content.slice(0, 50) + '...' : content,
    `/messages/${conversationId}`
  );

  return c.json({ success: true, data: { conversation_id: conversationId, message: 'Message sent' } }, 201);
});

// POST /messages/admin/send — 管理员定向/群发站内信(admin)
// 安全约束(H4):
//  - 群发影响面大,加严限流(2次/分钟,而非 20次/分钟),避免大量 INSERT 打挂 D1
//  - 群发强制设置最大收件人上限,防御未来用户量爆炸后的意外 DoS
//  - content 统一截断到 2000 字符(此前定向模式截断、群发模式未截断,不一致)
messages.post('/admin/send', authMiddleware, adminMiddleware, createRateLimiter('admin_msg', 2, 60_000), async (c) => {
  const admin = c.get('user');
  const body = await c.req.json();
  const { target_user_id, content } = body;

  if (!content || !content.trim()) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }
  // 类型校验 + 统一长度截断(原代码仅 target 模式截断,群发模式无截断)
  if (typeof content !== 'string' || content.length > 10000) {
    return c.json({ success: false, error: { message: 'content too long (max 10000 characters)', code: 'BAD_REQUEST' } }, 400);
  }
  const trimmed = content.trim().substring(0, 2000);

  // 定向:发给指定用户
  if (target_user_id) {
    const targetId = parseInt(target_user_id);
    if (targetId === admin.userId) {
      return c.json({ success: false, error: { message: 'Cannot send message to yourself', code: 'BAD_REQUEST' } }, 400);
    }
    const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
    if (!target) {
      return c.json({ success: false, error: { message: 'Target user not found', code: 'NOT_FOUND' } }, 404);
    }

    // 查找或创建 管理员↔用户 会话
    let conversationId: number;
    const existing = await c.env.DB.prepare(
      `SELECT cp1.conversation_id as id
       FROM conversation_participants cp1
       JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
       WHERE cp1.user_id = ? AND cp2.user_id = ?`
    ).bind(admin.userId, targetId).first();

    if (existing) {
      conversationId = (existing as any).id;
    } else {
      const result = await c.env.DB.prepare('INSERT INTO conversations DEFAULT VALUES').run();
      conversationId = result.meta.last_row_id as number;
      await c.env.DB.prepare(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)'
      ).bind(conversationId, admin.userId, conversationId, targetId).run();
    }

    await c.env.DB.prepare(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)'
    ).bind(conversationId, admin.userId, trimmed).run();
    await c.env.DB.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(conversationId).run();
    await sendNotification(c.env.DB, targetId, NotificationType.MESSAGE, `来自管理员的私信`, trimmed.slice(0, 50), `/messages/${conversationId}`);

    return c.json({ success: true, data: { sent: 1, conversation_id: conversationId, message: 'Message sent' } }, 201);
  }

  // 群发:发给所有用户(逐用户创建/复用会话)
  // 安全约束(H4):强制设置收件人总数上限,即便站点用户量增长也不会单次广播炸 D1
  const MAX_BROADCAST_RECIPIENTS = 5000;
  const users = await c.env.DB.prepare('SELECT id FROM users WHERE id != ? LIMIT ?').bind(admin.userId, MAX_BROADCAST_RECIPIENTS).all();
  let sent = 0;
  for (const u of (users.results as any[])) {
    let conversationId: number;
    const existing = await c.env.DB.prepare(
      `SELECT cp1.conversation_id as id
       FROM conversation_participants cp1
       JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
       WHERE cp1.user_id = ? AND cp2.user_id = ?`
    ).bind(admin.userId, u.id).first();

    if (existing) {
      conversationId = (existing as any).id;
    } else {
      const result = await c.env.DB.prepare('INSERT INTO conversations DEFAULT VALUES').run();
      conversationId = result.meta.last_row_id as number;
      await c.env.DB.prepare(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)'
      ).bind(conversationId, admin.userId, conversationId, u.id).run();
    }

    await c.env.DB.prepare(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)'
    ).bind(conversationId, admin.userId, trimmed).run();
    await c.env.DB.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(conversationId).run();
    await sendNotification(c.env.DB, u.id, NotificationType.MESSAGE, `来自管理员的站内信`, trimmed.slice(0, 50), `/messages/${conversationId}`);
    sent++;
  }

  return c.json({ success: true, data: { sent, message: `Broadcast sent to ${sent} users` } }, 201);
});

// POST /messages/conversations/:id/read — 更新 last_read_at
messages.post('/conversations/:id/read', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  await c.env.DB.prepare(
    'UPDATE conversation_participants SET last_read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?'
  ).bind(id, user.userId).run();

  return c.json({ success: true, data: { message: 'Marked as read' } });
});

// GET /messages/unread-count — 总未读消息数
messages.get('/unread-count', authMiddleware, async (c) => {
  const user = c.get('user');
  const result = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM messages m
     JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
     WHERE cp.user_id = ? AND m.sender_id != ? AND m.created_at > COALESCE(cp.last_read_at, '1970-01-01')`
  ).bind(user.userId, user.userId).first();
  return c.json({ success: true, data: { count: (result as any)?.cnt || 0 } });
});

export default messages;
