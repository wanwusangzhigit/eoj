import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const settings = new Hono<AppType>();

// 可写 settings key 白名单:仅允许管理员通过 PUT /settings 修改已知配置项,
// 防止误写/篡改内部关键项(如 seed_done、settings 缓存键等)。
// 该列表与前端管理页(AdminSettings/AdminAnnouncement/AdminAds)及后端各路由使用的 key 对齐。
const WRITABLE_SETTINGS = new Set([
  // 通用
  'registration_open', 'email_required', 'email_suffixes',
  'action_timeout', 'upload_enabled', 'image_upload_enabled',
  'announcement',
  // 主题定制(主题色,空 = 使用默认)
  'theme_accent',
  // 广告位
  'ads_client_id', 'ads_enabled',
  'ads_slot_home_top', 'ads_slot_home_top_enabled',
  'ads_slot_home_side', 'ads_slot_home_side_enabled',
  'ads_slot_problem_side', 'ads_slot_problem_side_enabled',
  'ads_slot_blog_top', 'ads_slot_blog_top_enabled',
  'ads_slot_blog_side', 'ads_slot_blog_side_enabled',
  // 团队限制
  'team_max_problems', 'team_max_time_limit', 'team_max_memory_limit',
  'team_max_testcase_size', 'team_max_testcase_count', 'team_max_total_testcase_size',
  'team_allow_spj',
  // AI
  'ai_enabled', 'ai_chat_enabled', 'ai_completion_enabled',
  'ai_provider', 'ai_api_key', 'ai_base_url', 'ai_model',
  'ai_system_prompt', 'ai_system_prompt_version', 'ai_max_tokens',
  'ai_temperature', 'ai_allowed_models', 'ai_models_config',
  // OAuth
  'oauth_protocol', 'oauth_callback_url',
  'cors_origins',
  // 验证码
  'captcha_enabled', 'captcha_strength', 'captcha_type',
  'captcha_register', 'captcha_login', 'captcha_submit',
  'captcha_blog', 'captcha_discussion', 'captcha_solution',
]);

// GET /settings - Get all public settings (no auth required)
settings.get('/', async (c) => {
  // Check if we have a cached response
  const cacheKey = 'settings:all';
  const cached = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(cacheKey).first().catch(() => null);
  
  const results = await c.env.DB.prepare('SELECT key, value FROM settings').all();
  const data: Record<string, string> = {};
  for (const row of results.results as any[]) {
    // Never expose API keys publicly
    if (row.key === 'ai_api_key') continue;
    data[row.key] = row.value;
  }

  // Cache settings in the response for a short time (s-maxage for CDN, max-age for browser)
  c.header('Cache-Control', 'public, max-age=60, s-maxage=120');
  return c.json({ success: true, data });
});

// GET /settings/stats - 站点统计(公开,无鉴权;供首页等展示站点规模)
// 注意:该静态路由必须注册在 GET /:key 之前,否则会被参数路由捕获
settings.get('/stats', async (c) => {
  const [
    problemCount, userCount, submissionCount, todaySubmissions,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM problems').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM submissions').first(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM submissions WHERE date(created_at) = date('now')").first(),
  ]);

  c.header('Cache-Control', 'public, max-age=60, s-maxage=120');
  return c.json({
    success: true,
    data: {
      problems: (problemCount as any)?.count || 0,
      users: (userCount as any)?.count || 0,
      submissions: (submissionCount as any)?.count || 0,
      today_submissions: (todaySubmissions as any)?.count || 0,
    },
  });
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
    // 仅允许修改白名单内的配置项;非白名单 key(如 seed_done、缓存键)直接跳过
    if (typeof key !== 'string' || typeof value !== 'string' || !WRITABLE_SETTINGS.has(key)) {
      continue;
    }
    // ai_api_key 空字符串视为"不修改":GET /settings 出于安全不会返回该 key,
    // 前端表单里它永远是空,直接写回会覆盖掉已配置的 AI 密钥
    if (key === 'ai_api_key' && value === '') {
      continue;
    }
    await c.env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
    ).bind(key, value, value).run();
  }

  return c.json({ success: true, data: { message: 'Settings updated' } });
});

export default settings;
