import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const settings = new Hono<AppType>();

// GET /settings - Get all public settings (no auth required)
settings.get('/', async (c) => {
  const results = await c.env.DB.prepare('SELECT key, value FROM settings').all();
  const data: Record<string, string> = {};
  for (const row of results.results as any[]) {
    // Never expose API keys publicly
    if (row.key === 'ai_api_key') continue;
    data[row.key] = row.value;
  }
  return c.json({ success: true, data });
});

// GET /settings/:key - Get a specific setting (no auth required)
settings.get('/:key', async (c) => {
  const key = c.req.param('key');
  // Never expose API keys publicly
  if (key === 'ai_api_key') {
    return c.json({ success: true, data: { value: '' } });
  }
  const result = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  if (!result) {
    return c.json({ success: true, data: { value: '' } });
  }
  return c.json({ success: true, data: { value: (result as any).value } });
});

// PUT /settings - Update settings (admin only)
settings.put('/', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json();
  if (!body || typeof body !== 'object') {
    return c.json({ success: false, error: { message: 'Request body must be an object', code: 'BAD_REQUEST' } }, 400);
  }

  const entries = Object.entries(body);
  if (entries.length === 0) {
    return c.json({ success: false, error: { message: 'No settings to update', code: 'BAD_REQUEST' } }, 400);
  }

  for (const [key, value] of entries) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      continue;
    }
    await c.env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
    ).bind(key, value, value).run();
  }

  return c.json({ success: true, data: { message: 'Settings updated' } });
});

export default settings;
