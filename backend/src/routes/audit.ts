import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { recordAuditLog } from '../middleware/audit';

const audit = new Hono<AppType>();

// ── Audit Logs ──

// GET /audit/logs - List audit logs (paginated, filterable)
audit.get('/logs', authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const search = c.req.query('search') || '';
  const action = c.req.query('action') || '';
  const ipFilter = c.req.query('ip') || '';
  const offset = (page - 1) * pageSize;

  let countQuery = 'SELECT COUNT(*) as total FROM audit_logs WHERE 1=1';
  let dataQuery = 'SELECT * FROM audit_logs WHERE 1=1';
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (search) {
    countQuery += ' AND (username LIKE ? OR ip LIKE ? OR device_fingerprint LIKE ? OR action LIKE ?)';
    dataQuery += ' AND (username LIKE ? OR ip LIKE ? OR device_fingerprint LIKE ? OR action LIKE ?)';
    const like = `%${search}%`;
    binds.push(like, like, like, like);
    countBinds.push(like, like, like, like);
  }

  if (action) {
    countQuery += ' AND action LIKE ?';
    dataQuery += ' AND action LIKE ?';
    binds.push(`%${action}%`);
    countBinds.push(`%${action}%`);
  }

  if (ipFilter) {
    countQuery += ' AND ip = ?';
    dataQuery += ' AND ip = ?';
    binds.push(ipFilter);
    countBinds.push(ipFilter);
  }

  dataQuery += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(dataQuery).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      logs: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// ── Banned IPs ──

// GET /audit/banned-ips - List banned IPs
audit.get('/banned-ips', authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM banned_ips').first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    'SELECT b.*, u.username as banned_by_username FROM banned_ips b LEFT JOIN users u ON b.banned_by = u.id ORDER BY b.created_at DESC LIMIT ? OFFSET ?'
  ).bind(pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      bans: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /audit/banned-ips - Ban an IP
audit.post('/banned-ips', authMiddleware, adminMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { ip, reason } = body;

  if (!ip || typeof ip !== 'string') {
    return c.json({ success: false, error: { message: 'IP address is required', code: 'BAD_REQUEST' } }, 400);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO banned_ips (ip, reason, banned_by) VALUES (?, ?, ?)'
    ).bind(ip.trim(), reason || '', user.userId).run();

    await recordAuditLog(c, `ban_ip: ${ip}`, user.userId, user.username);
    return c.json({ success: true, data: { message: 'IP banned' } }, 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: { message: 'IP already banned', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to ban IP', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// DELETE /audit/banned-ips/:id - Unban an IP
audit.delete('/banned-ips/:id', authMiddleware, adminMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  const existing = await c.env.DB.prepare('SELECT ip FROM banned_ips WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Ban not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare('DELETE FROM banned_ips WHERE id = ?').bind(id).run();
  await recordAuditLog(c, `unban_ip: ${(existing as any).ip}`, user.userId, user.username);
  return c.json({ success: true, data: { message: 'IP unbanned' } });
});

// ── Banned Devices ──

// GET /audit/banned-devices - List banned devices
audit.get('/banned-devices', authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM banned_devices').first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(
    'SELECT b.*, u.username as banned_by_username FROM banned_devices b LEFT JOIN users u ON b.banned_by = u.id ORDER BY b.created_at DESC LIMIT ? OFFSET ?'
  ).bind(pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      bans: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// POST /audit/banned-devices - Ban a device
audit.post('/banned-devices', authMiddleware, adminMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { device_fingerprint, reason } = body;

  if (!device_fingerprint || typeof device_fingerprint !== 'string') {
    return c.json({ success: false, error: { message: 'Device fingerprint is required', code: 'BAD_REQUEST' } }, 400);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO banned_devices (device_fingerprint, reason, banned_by) VALUES (?, ?, ?)'
    ).bind(device_fingerprint.trim(), reason || '', user.userId).run();

    await recordAuditLog(c, `ban_device: ${device_fingerprint.substring(0, 20)}`, user.userId, user.username);
    return c.json({ success: true, data: { message: 'Device banned' } }, 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: { message: 'Device already banned', code: 'CONFLICT' } }, 409);
    }
    return c.json({ success: false, error: { message: 'Failed to ban device', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// DELETE /audit/banned-devices/:id - Unban a device
audit.delete('/banned-devices/:id', authMiddleware, adminMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') || '0');

  const existing = await c.env.DB.prepare('SELECT device_fingerprint FROM banned_devices WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ success: false, error: { message: 'Ban not found', code: 'NOT_FOUND' } }, 404);
  }

  await c.env.DB.prepare('DELETE FROM banned_devices WHERE id = ?').bind(id).run();
  await recordAuditLog(c, `unban_device: ${(existing as any).device_fingerprint?.substring(0, 20)}`, user.userId, user.username);
  return c.json({ success: true, data: { message: 'Device unbanned' } });
});

export default audit;
