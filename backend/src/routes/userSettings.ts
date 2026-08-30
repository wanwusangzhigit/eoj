import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';

const userSettings = new Hono<AppType>();

// GET /user/settings — 获取当前用户的设置
userSettings.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const results = await c.env.DB.prepare(
    'SELECT setting_key, setting_value FROM user_settings WHERE user_id = ?'
  ).bind(user.userId).all();

  const settings: Record<string, string> = {};
  for (const row of results.results as any[]) {
    settings[row.setting_key] = row.setting_value;
  }

  return c.json({ success: true, data: { settings } });
});

// PUT /user/settings — 保存用户设置
userSettings.put('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { settings } = body;

  if (!settings || typeof settings !== 'object') {
    return c.json({ success: false, error: { message: 'settings object is required', code: 'BAD_REQUEST' } }, 400);
  }

  for (const [key, value] of Object.entries(settings)) {
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

  return c.json({ success: true, data: { message: 'Settings saved' } });
});

export default userSettings;