import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, ticketAdminMiddleware } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';

const tickets = new Hono<AppType>();

const ticketCreateLimiter = createRateLimiter('ticket_create', 10, 60_000);
const ticketReplyLimiter = createRateLimiter('ticket_reply', 20, 60_000);

// List tickets
tickets.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const status = c.req.query('status');
  const category = c.req.query('category');
  const offset = (page - 1) * pageSize;

  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;

  let query = 'SELECT t.*, u.username FROM tickets t JOIN users u ON t.user_id = u.id WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as total FROM tickets WHERE 1=1';
  const binds: any[] = [];
  const countBinds: any[] = [];

  // Non-admin users can only see their own tickets
  if (!isAdmin) {
    query += ' AND t.user_id = ?';
    countQuery += ' AND user_id = ?';
    binds.push(user.userId);
    countBinds.push(user.userId);
  }

  if (status) {
    query += ' AND t.status = ?';
    countQuery += ' AND status = ?';
    binds.push(status);
    countBinds.push(status);
  }

  if (category) {
    query += ' AND t.category = ?';
    countQuery += ' AND category = ?';
    binds.push(category);
    countBinds.push(category);
  }

  query += ' ORDER BY t.updated_at DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;
  const results = await c.env.DB.prepare(query).bind(...binds, pageSize, offset).all();

  return c.json({
    success: true,
    data: {
      tickets: results.results,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
  });
});

// Get ticket detail with replies
tickets.get('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);

  const ticket = await c.env.DB.prepare(
    'SELECT t.*, u.username FROM tickets t JOIN users u ON t.user_id = u.id WHERE t.id = ?'
  ).bind(id).first();

  if (!ticket) {
    return c.json({ success: false, error: { message: 'Ticket not found', code: 'NOT_FOUND' } }, 404);
  }

  // Non-admin users can only see their own tickets
  if (user.role !== 'admin' && (ticket as any).user_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const replies = await c.env.DB.prepare(
    'SELECT tr.*, u.username, u.role as user_role FROM ticket_replies tr JOIN users u ON tr.user_id = u.id WHERE tr.ticket_id = ? ORDER BY tr.created_at ASC'
  ).bind(id).all();

  return c.json({ success: true, data: { ticket, replies: replies.results } });
});

// Create ticket
tickets.post('/', authMiddleware, ticketCreateLimiter, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { title, content, category, priority } = body;

  if (!title || !content) {
    return c.json({ success: false, error: { message: 'title and content are required', code: 'BAD_REQUEST' } }, 400);
  }

  if (title.length > 200) {
    return c.json({ success: false, error: { message: 'title must be at most 200 characters', code: 'BAD_REQUEST' } }, 400);
  }

  if (content.length > 10000) {
    return c.json({ success: false, error: { message: 'content must be at most 10000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  const validCategories = ['bug', 'suggestion', 'question', 'other'];
  if (category && !validCategories.includes(category)) {
    return c.json({ success: false, error: { message: 'category must be one of: bug, suggestion, question, other', code: 'BAD_REQUEST' } }, 400);
  }

  const validPriorities = ['low', 'normal', 'high', 'urgent'];
  if (priority && !validPriorities.includes(priority)) {
    return c.json({ success: false, error: { message: 'priority must be one of: low, normal, high, urgent', code: 'BAD_REQUEST' } }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO tickets (user_id, title, content, category, priority) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.userId, title, content, category || 'question', priority || 'normal').run();

  const ticketId = result.meta.last_row_id;

  return c.json({ success: true, data: { id: ticketId, message: 'Ticket created' } }, 201);
});

// Reply to ticket
tickets.post('/:id/replies', authMiddleware, ticketReplyLimiter, async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id')!);
  const body = await c.req.json();
  const { content } = body;

  if (!content) {
    return c.json({ success: false, error: { message: 'content is required', code: 'BAD_REQUEST' } }, 400);
  }

  if (content.length > 10000) {
    return c.json({ success: false, error: { message: 'content must be at most 10000 characters', code: 'BAD_REQUEST' } }, 400);
  }

  const ticket = await c.env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
  if (!ticket) {
    return c.json({ success: false, error: { message: 'Ticket not found', code: 'NOT_FOUND' } }, 404);
  }

  // Non-admin users can only reply to their own tickets
  if (user.role !== 'admin' && (ticket as any).user_id !== user.userId) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare(
    'INSERT INTO ticket_replies (ticket_id, user_id, content) VALUES (?, ?, ?)'
  ).bind(id, user.userId, content).run();

  // Update ticket status
  const newStatus = (user.role === 'admin' || user.role === 'super_admin' || user.userId === 1) ? 'in_progress' : 'open';
  await c.env.DB.prepare(
    "UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newStatus, id).run();

  return c.json({ success: true, data: { message: 'Reply added' } }, 201);
});

// Update ticket status (admin only)
tickets.put('/:id/status', authMiddleware, ticketAdminMiddleware, async (c) => {
  const id = parseInt(c.req.param('id')!);
  const body = await c.req.json();
  const { status, priority } = body;

  const ticket = await c.env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
  if (!ticket) {
    return c.json({ success: false, error: { message: 'Ticket not found', code: 'NOT_FOUND' } }, 404);
  }

  const updates: string[] = [];
  const binds: any[] = [];

  if (status) {
    updates.push('status = ?');
    binds.push(status);
  }
  if (priority) {
    updates.push('priority = ?');
    binds.push(priority);
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    binds.push(id);
    await c.env.DB.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  }

  return c.json({ success: true, data: { message: 'Ticket updated' } });
});

export default tickets;
