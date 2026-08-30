import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import * as bcrypt from 'bcryptjs';

const codeShares = new Hono<AppType>();

const shareCreateLimiter = createRateLimiter('code_share', 20, 60_000);

function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, '0')).join('');
}

// POST /shares — 创建代码分享(基于提交 ID 或直接提供代码,可选密码保护)
codeShares.post('/', authMiddleware, shareCreateLimiter, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { submission_id, title, expires_in_hours, password } = body;

  if (!submission_id) {
    return c.json({ success: false, error: { message: 'submission_id is required', code: 'BAD_REQUEST' } }, 400);
  }

  // 密码可选:设置后访问需输入密码(最长 64 位,仅存哈希)
  let passwordHash: string | null = null;
  if (password !== undefined && password !== null && String(password) !== '') {
    if (String(password).length > 64) {
      return c.json({ success: false, error: { message: 'Password too long (max 64)', code: 'BAD_REQUEST' } }, 400);
    }
    passwordHash = bcrypt.hashSync(String(password), 10);
  }

  // 只允许分享自己的提交(管理员除外)
  const submission: any = await c.env.DB.prepare(
    'SELECT id, user_id, source_code, language FROM submissions WHERE id = ?'
  ).bind(parseInt(submission_id)).first();
  if (!submission) {
    return c.json({ success: false, error: { message: 'Submission not found', code: 'NOT_FOUND' } }, 404);
  }
  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;
  if (submission.user_id !== user.userId && !isAdmin) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  const expiresInHours = parseInt(expires_in_hours) || 0;
  let expiresAt: string | null = null;
  if (expiresInHours > 0) {
    expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
  }

  const token = generateToken();
  await c.env.DB.prepare(
    'INSERT INTO code_shares (token, user_id, submission_id, code, language, title, expires_at, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    token,
    user.userId,
    submission.id,
    submission.source_code || '',
    submission.language || '',
    title && String(title).trim() ? String(title).trim().substring(0, 100) : 'Code Share',
    expiresAt,
    passwordHash
  ).run();

  return c.json({
    success: true,
    data: {
      token,
      url: `/shares/${token}`,
      expires_at: expiresAt,
    },
  }, 201);
});

// GET /shares/:token — 查看分享(公开只读)
codeShares.get('/:token', async (c) => {
  const token = c.req.param('token');
  const row: any = await c.env.DB.prepare(
    `SELECT cs.id, cs.token, cs.code, cs.language, cs.title, cs.created_at, cs.expires_at, cs.submission_id, cs.password_hash,
            u.username
     FROM code_shares cs JOIN users u ON cs.user_id = u.id
     WHERE cs.token = ?`
  ).bind(token).first();

  if (!row) {
    return c.json({ success: false, error: { message: 'Share not found', code: 'NOT_FOUND' } }, 404);
  }

  // 过期检查
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return c.json({ success: false, error: { message: 'Share has expired', code: 'GONE' } }, 410);
  }

  // 密码保护:需校验通过才返回代码内容
  const hasPassword = !!row.password_hash;
  let passwordOk = true;
  if (hasPassword) {
    const provided = c.req.query('password') || '';
    passwordOk = provided !== '' && bcrypt.compareSync(provided, row.password_hash);
    if (!passwordOk) {
      return c.json({
        success: true,
        data: {
          share: {
            token: row.token,
            code: '',
            language: row.language,
            title: row.title,
            username: row.username,
            submission_id: row.submission_id,
            created_at: row.created_at,
            expires_at: row.expires_at,
          },
          requires_password: true,
        },
      });
    }
  }

  return c.json({
    success: true,
    data: {
      share: {
        token: row.token,
        code: row.code,
        language: row.language,
        title: row.title,
        username: row.username,
        submission_id: row.submission_id,
        created_at: row.created_at,
        expires_at: row.expires_at,
      },
      requires_password: hasPassword && passwordOk ? true : false,
    },
  });
});

// GET /shares/:token/image — 把分享代码渲染为图片(SVG→PNG,便于分享)
codeShares.get('/:token/image', async (c) => {
  const token = c.req.param('token');
  const row: any = await c.env.DB.prepare(
    'SELECT id, token, code, language, title, username, password_hash, expires_at FROM code_shares WHERE token = ?'
  ).bind(token).first();

  if (!row) {
    return c.json({ success: false, error: { message: 'Share not found', code: 'NOT_FOUND' } }, 404);
  }

  // 过期检查
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return c.json({ success: false, error: { message: 'Share has expired', code: 'GONE' } }, 410);
  }

  // 密码保护:与 GET 端点逻辑一致,必须校验通过后才返回内容(图片里包含完整代码)
  if (row.password_hash) {
    const provided = c.req.query('password') || '';
    const ok = provided !== '' && bcrypt.compareSync(provided, row.password_hash);
    if (!ok) {
      return c.json({ success: false, error: { message: 'Password required', code: 'PASSWORD_REQUIRED' } }, 401);
    }
  }

  // 简单语法高亮:仅高亮注释/字符串/关键字,不做完整分词(避免 SVG 注入)
  const escXml = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const code = (row.code || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ');
  const lines = code.split('\n').slice(0, 200); // 最多渲染 200 行

  const lineH = 22;
  const padX = 24;
  const padY = 20;
  const headerH = 44;
  const width = 760;
  const lineNumW = 52;
  const height = padY * 2 + headerH + lines.length * lineH;

  let body = '';
  (lines as string[]).forEach((line: string, idx: number) => {
    const y = padY + headerH + idx * lineH + 16;
    const escaped = escXml(line);
    body += `<text x="${padX + lineNumW - 12}" y="${y}" text-anchor="end" font-family="monospace" font-size="12" fill="#5c6370">${idx + 1}</text>`;
    // 简易高亮:行内注释(// 或 #)、字符串
    let colored = '';
    const commentIdx = Math.max(line.indexOf('//'), line.indexOf('#'));
    if (commentIdx >= 0) {
      colored += `<tspan fill="#d8dee9">${escaped.slice(0, commentIdx)}</tspan>`;
      colored += `<tspan fill="#5c6370">${escaped.slice(commentIdx)}</tspan>`;
    } else {
      colored = `<tspan fill="#d8dee9">${escaped || ' '}</tspan>`;
    }
    body += `<text x="${padX + lineNumW}" y="${y}" font-family="monospace" font-size="13" xml:space="preserve">${colored}</text>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#282c34"/>
  <rect x="0" y="0" width="${width}" height="${headerH}" fill="#21252b"/>
  <circle cx="${padX + 10}" cy="${headerH / 2}" r="6" fill="#ff5f56"/>
  <circle cx="${padX + 28}" cy="${headerH / 2}" r="6" fill="#ffbd2e"/>
  <circle cx="${padX + 46}" cy="${headerH / 2}" r="6" fill="#27c93f"/>
  <text x="${padX + 64}" y="${headerH / 2 + 5}" font-family="sans-serif" font-size="12" fill="#abb2bf">${escXml(row.title || 'Code Share')} · ${escXml(row.language || '')}</text>
  ${body}
</svg>`;

  const { svgToPng } = await import('../utils/captcha');
  const pngBytes = await svgToPng(svg);
  const pngBuffer = pngBytes.slice().buffer as ArrayBuffer;

  c.header('Content-Type', 'image/png');
  c.header('Content-Disposition', `attachment; filename="share-${token}.png"`);
  c.header('Cache-Control', 'no-store');
  return c.body(pngBuffer);
});

// DELETE /shares/:token — 删除分享(仅创建者或管理员)
codeShares.delete('/:token', authMiddleware, async (c) => {
  const user = c.get('user');
  const token = c.req.param('token');

  const row: any = await c.env.DB.prepare('SELECT id, user_id FROM code_shares WHERE token = ?').bind(token).first();
  if (!row) {
    return c.json({ success: false, error: { message: 'Share not found', code: 'NOT_FOUND' } }, 404);
  }
  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;
  if (row.user_id !== user.userId && !isAdmin) {
    return c.json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } }, 403);
  }

  await c.env.DB.prepare('DELETE FROM code_shares WHERE id = ?').bind(row.id).run();
  return c.json({ success: true, data: { message: 'Share deleted' } });
});

export default codeShares;
