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

// GET /notifications/stream-token — 签发短时效 SSE 连接 token(5 分钟)
// EventSource 无法携带 Authorization 头,token 只能走 URL 查询参数。
// 使用短时效专用 token 而非主登录 JWT,避免长期有效的登录凭证出现在
// 浏览器历史/代理日志中;过期后前端会重新获取或回退到轮询。
notifications.get('/stream-token', authMiddleware, async (c) => {
  const user = c.get('user');
  const { signJWT } = await import('../utils/jwt');
  const token = await signJWT(
    {
      userId: user.userId,
      username: user.username,
      role: user.role,
      permissions: user.permissions || [],
    },
    c.env.JWT_SECRET,
    5 * 60 // 5 分钟
  );
  return c.json({ success: true, data: { token, expires_in: 300 } });
});

// ── SSE (Server-Sent Events) stream for real-time notifications ──
// GET /notifications/stream?token=xxx — uses query param for auth (EventSource can't set headers)
notifications.get('/stream', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    return c.json({ success: false, error: { message: 'Token required', code: 'UNAUTHORIZED' } }, 401);
  }

  const { verifyJWT } = await import('../utils/jwt');
  const payload = await verifyJWT(token, c.env.JWT_SECRET, (c.env as any).JWT_SECRET_PREVIOUS);
  if (!payload) {
    return c.json({ success: false, error: { message: 'Invalid token', code: 'UNAUTHORIZED' } }, 401);
  }

  const userId = payload.userId;

  // Create a stream using TransformStream (avoids c.stream() typing issues)
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const sse = (event: string, data: string) => {
    return writer.write(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
  };

  sse('connected', JSON.stringify({ status: 'ok', userId }));

  let lastCheck = Date.now();
  let lastHeartbeat = Date.now();

  const pollTimer = setInterval(async () => {
    try {
      const result: any = await c.env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0 AND strftime('%s', created_at) * 1000 > ?"
      ).bind(userId, lastCheck).first();

      if (result && result.cnt > 0) {
        const newNotifs: any = await c.env.DB.prepare(
          "SELECT id, type, title, content, link, created_at FROM notifications WHERE user_id = ? AND is_read = 0 AND strftime('%s', created_at) * 1000 > ? ORDER BY created_at DESC LIMIT 5"
        ).bind(userId, lastCheck).all();
        sse('notification', JSON.stringify({ count: result.cnt, notifications: newNotifs.results || [] }));
        // 有数据推送即视为活跃连接,重置心跳计时
        lastHeartbeat = Date.now();
      } else if (Date.now() - lastHeartbeat >= 15000) {
        // 空闲超过 15 秒发送心跳,防止代理/负载均衡器断开空闲连接
        sse('heartbeat', JSON.stringify({ time: Date.now() }));
        lastHeartbeat = Date.now();
      }

      lastCheck = Date.now();
    } catch { /* ignore */ }
  }, 3000);

  c.req.raw.signal.addEventListener('abort', () => {
    clearInterval(pollTimer);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
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
  const id = parseInt(c.req.param('id') || '0');
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

// GET /notifications/preferences — 获取通知偏好
notifications.get('/preferences', authMiddleware, async (c) => {
  const user = c.get('user');
  const results = await c.env.DB.prepare(
    "SELECT setting_key, setting_value FROM user_settings WHERE user_id = ? AND setting_key LIKE ? ESCAPE '\\'"
  ).bind(user.userId, 'notify_%').all();

  const prefs: Record<string, string> = {};
  for (const row of results.results as any[]) {
    prefs[row.setting_key] = row.setting_value;
  }

  return c.json({ success: true, data: { preferences: prefs } });
});

// PUT /notifications/preferences — 更新通知偏好
notifications.put('/preferences', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { preferences } = body;

  if (!preferences || typeof preferences !== 'object') {
    return c.json({ success: false, error: { message: 'preferences object is required', code: 'BAD_REQUEST' } }, 400);
  }

  for (const [key, value] of Object.entries(preferences)) {
    if (!key.startsWith('notify_')) continue;
    const existing = await c.env.DB.prepare(
      'SELECT id FROM user_settings WHERE user_id = ? AND setting_key = ?'
    ).bind(user.userId, key).first();

    if (existing) {
      await c.env.DB.prepare(
        'UPDATE user_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND setting_key = ?'
      ).bind(String(value), user.userId, key).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)'
      ).bind(user.userId, key, String(value)).run();
    }
  }

  return c.json({ success: true, data: { message: 'Preferences saved' } });
});

export default notifications;
