import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';

const notifications = new Hono<AppType>();

// GET /notifications — 当前用户通知列表（分页 + type 筛选）
notifications.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const type = c.req.query('type');
  const offset = (page - 1) * pageSize;

  let query = 'SELECT id, user_id, type, title, content, link, is_read, created_at FROM notifications WHERE user_id = ?';
  let countQuery = 'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?';
  const binds: any[] = [user.userId];
  const countBinds: any[] = [user.userId];

  if (type) {
    query += ' AND type = ?';
    countQuery += ' AND type = ?';
    binds.push(type);
    countBinds.push(type);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      notifications: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// GET /notifications/unread-count — 未读通知数（用于 Header 气泡）
notifications.get('/unread-count', authMiddleware, async (c) => {
  const user = c.get('user');
  const result = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0'
  ).bind(user.userId).first();
  return c.json({ success: true, data: { count: (result as any)?.cnt || 0 } });
});

// POST /notifications/:id/read — 标记单条已读
notifications.post('/:id/read', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
  ).bind(id, user.userId).run();
  return c.json({ success: true, data: { message: 'Marked as read' } });
});

// POST /notifications/read-all — 全部已读
notifications.post('/read-all', authMiddleware, async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
  ).bind(user.userId).run();
  return c.json({ success: true, data: { message: 'All marked as read' } });
});

export default notifications;
