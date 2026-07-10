import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';
import { sendNotification, NotificationType } from '../utils/notify';

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
messages.post('/conversations', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { target_user_id, content } = body;

  if (!target_user_id || !content || !content.trim()) {
    return c.json({ success: false, error: { message: 'target_user_id and content are required', code: 'BAD_REQUEST' } }, 400);
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
