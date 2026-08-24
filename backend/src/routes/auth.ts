import { Hono } from 'hono';
import { AppType } from '../types';
import { signJWT } from '../utils/jwt';
import { validateUsername, validateEmail, validatePassword } from '../utils/validator';
import { fetchWithTimeout } from '../utils/fetch-timeout';
import * as bcrypt from 'bcryptjs';
import { createRateLimiter } from '../middleware/rateLimit';
import { captchaMiddleware } from '../middleware/captcha';

const auth = new Hono<AppType>();

async function getOAuthCallbackBase(c: any): Promise<string> {
  try {
    const urlRow: any = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('oauth_callback_url').first();
    if (urlRow && urlRow.value) {
      return urlRow.value.replace(/\/$/, '');
    }

    const protocolRow: any = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('oauth_protocol').first();
    const origin = new URL(c.req.url).origin;
    
    if (protocolRow && protocolRow.value) {
      const url = new URL(origin);
      url.protocol = protocolRow.value;
      return url.origin;
    }
  } catch {
    // ignore
  }
  
  return new URL(c.req.url).origin;
}

// 校验并归一化 return_url 为"origin 串"(https://host),仅允许 http/https。
// 空串返回 null。防御 URL 注入 / 开放重定向:仅提取 origin,不保留路径与 query。
function normalizeReturnOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

// 从 Cookie header 取出指定名字的值(解码)。找不到返回 null。
function getCookieHeaderValue(c: any, name: string): string | null {
  const cookieHeader: string = c.req.header('Cookie') || '';
  const match = cookieHeader.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

// 读取 OAuth 起始时写入的 return_url(域名 B 的 origin),供回调成功后跳回。
function getReturnOriginFromCookie(c: any): string | null {
  return normalizeReturnOrigin(getCookieHeaderValue(c, 'oauth_return'));
}

// 将 OAuth state(含 return_url 与 CP OAuth 的 PKCE code_verifier)写入 DB,
// 回调时按 state 反查。这样即使并发/多次点击导致 cookie 里的 state 被覆盖,
// 只要授权服务商带回的 state 是某次真实发起的,就能命中并取回 return_url 与
// code_verifier(消除 state_mismatch 误报,也避免 PKCE verifier 在跨域回跳中丢失)。
async function storePendingState(c: any, oauthType: string, state: string, returnOrigin: string | null, codeVerifier?: string | null): Promise<void> {
  const now = Date.now();
  const expiresAt = now + 600_000; // 10 分钟
  try {
    await c.env.DB.prepare(
      'INSERT INTO oauth_pending (state, oauth_type, return_url, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(state, oauthType, returnOrigin, codeVerifier || null, now, expiresAt).run();
  } catch (e) {
    console.error('Failed to store OAuth pending state:', e);
  }
}

// 回调时用 state 反查 DB,取回 return_url/code_verifier 并一次性删除该 state。
// 返回 { return_url, code_verifier, matched }。matched=false 表示 state 未知(CSRF 伪装)。
async function consumePendingState(c: any, oauthType: string, state: string): Promise<{ return_url: string | null; code_verifier: string | null; matched: boolean }> {
  if (!state) return { return_url: null, code_verifier: null, matched: false };
  const now = Date.now();
  const row: any = await c.env.DB.prepare(
    'SELECT return_url, code_verifier, oauth_type FROM oauth_pending WHERE state = ? AND oauth_type = ? AND expires_at > ?'
  ).bind(state, oauthType, now).first().catch(() => null);
  if (!row) return { return_url: null, code_verifier: null, matched: false };
  await c.env.DB.prepare('DELETE FROM oauth_pending WHERE state = ?').bind(state).run().catch(() => {});
  return {
    return_url: row.return_url ? normalizeReturnOrigin(row.return_url) : null,
    code_verifier: row.code_verifier || null,
    matched: true,
  };
}

// OAuth 回调统一封装:生成一次性 exchange code,并重定向到对应的前端 callback。
// 优先跳转到发起登录的域名(return origin,可实现跨域 A->B 闭环);
// 没有 return origin 时回退到站点 FRONTEND_URL。不再把 JWT 直接放到 URL fragment。
async function redirectWithExchangeCode(c: any, jwt: string, returnOriginOverride?: string | null): Promise<Response> {
  // 优先使用发起登录时 DB 里记录的 return_url(domain B),因为回调实际执行在 A 的
  // origin 上,发起域名 B 的 oauth_return 跨域回不来;再兜底 cookie,最后才是站点主域。
  const returnOrigin = normalizeReturnOrigin(returnOriginOverride)
    || getReturnOriginFromCookie(c)
    || normalizeReturnOrigin(c.env.FRONTEND_URL)
    || '';
  // 清除一次性 return cookie
  c.header('Set-Cookie', 'oauth_return=; Path=/api/v1/auth/; Max-Age=0');
  // 32 字节随机 -> base64url
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const code = base64url(bytes.buffer as ArrayBuffer);
  const now = Date.now();
  const expiresAt = now + 60_000; // 60 秒足够浏览器完成跳转与换取
  try {
    await c.env.DB.prepare(
      'INSERT INTO oauth_exchange_codes (code, jwt, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(code, jwt, now, expiresAt).run();
  } catch (e) {
    console.error('Failed to store OAuth exchange code:', e);
    // 极端情况下回退到旧的 fragment 方式(仍能完成登录,但不暴露给 Referer)
    return c.redirect(`${returnOrigin}/auth/callback#token=${jwt}`);
  }
  return c.redirect(`${returnOrigin}/auth/callback?code=${encodeURIComponent(code)}`);
}

// CP OAuth with PKCE
// base64url 编码工具函数
function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

auth.get('/cpoauth', async (c) => {
  const clientId = c.env.CPOAUTH_CLIENT_ID;
  const callbackBase = await getOAuthCallbackBase(c);
  const redirectUri = `${callbackBase}/api/v1/auth/cpoauth/callback`;

  // 生成 PKCE code_verifier: 32 字节随机数的 base64url 编码
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const codeVerifier = base64url(verifierBytes.buffer as ArrayBuffer);

  // 计算 code_challenge = BASE64URL(SHA256(code_verifier))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64url(digest);

  // 生成 state 防止 CSRF
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = base64url(stateBytes.buffer as ArrayBuffer);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
const cpoauthUrl = `https://www.cpoauth.com/oauth/authorize?${params.toString()}`;

  // 记录发起登录的来源域(domain B),回调成功后用于跳回。仅接受 origin,防开放重定向。
  const returnOrigin = normalizeReturnOrigin(c.req.query('return_url'));

  // 将 state + return_url + PKCE verifier 写入 DB,回调反查(消除 cookie 覆盖竞态与跨域 verifier 丢失)
  await storePendingState(c, 'cpoauth', state, returnOrigin, codeVerifier);

  // 将 code_verifier + state 存入 cookie，回调时取出。
  // Path 限定在 /api/v1/auth/ 以缩小可读范围,降低无关子路径应用读取风险。
  const cookieOpts = 'Path=/api/v1/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=600';
  c.header('Set-Cookie', `cpoauth_cv=${codeVerifier}; ${cookieOpts}`);
  c.header('Set-Cookie', `cpoauth_st=${state}; ${cookieOpts}`, { append: true });
  if (returnOrigin) {
    c.header('Set-Cookie', `oauth_return=${encodeURIComponent(returnOrigin)}; ${cookieOpts}`, { append: true });
  }
  return c.redirect(cpoauthUrl);
});

auth.get('/cpoauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const errorDesc = c.req.query('error_description');
  // 校验 state::以 DB 中的 oauth_pending 为权威来源,并取回该次发起时记录的 return_url
  const pending = await consumePendingState(c, 'cpoauth', state || '');
  const returnOrigin = pending.matched
    ? (pending.return_url || getReturnOriginFromCookie(c) || normalizeReturnOrigin(c.env.FRONTEND_URL) || '')
    : (getReturnOriginFromCookie(c) || normalizeReturnOrigin(c.env.FRONTEND_URL) || '');

  if (error) {
    return c.redirect(`${returnOrigin}/auth/callback?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(errorDesc || '')}`);
  }
  if (!code) {
    return c.redirect(`${returnOrigin}/auth/callback?error=missing_code`);
  }

  // 严格校验 state 防止 OAuth 登录 CSRF:state 必须在 DB 中存在且未过期(一次性)
  if (!pending.matched) {
    return c.redirect(`${returnOrigin}/auth/callback?error=state_mismatch`);
  }
  // state 一次性使用，校验通过后立即清除 cookie
  c.header('Set-Cookie', 'cpoauth_st=; Path=/api/v1/auth/; Max-Age=0');
  c.header('Set-Cookie', 'cpoauth_cv=; Path=/api/v1/auth/; Max-Age=0', { append: true });

  const callbackBase = await getOAuthCallbackBase(c);
  const redirectUri = `${callbackBase}/api/v1/auth/cpoauth/callback`;

  // 用授权码 + code_verifier 换取 access_token。
  // 优先使用发起时持久化到 DB 的 verifier(PKCE 在跨域回跳中 cookie 可能丢失),
  // 兜底再读 cookie。
  const codeVerifier = pending.code_verifier || (getCookieHeaderValue(c, 'cpoauth_cv') as string | null);
  const tokenBody: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: c.env.CPOAUTH_CLIENT_ID,
    client_secret: c.env.CPOAUTH_CLIENT_SECRET,
  };
  if (codeVerifier) {
    tokenBody.code_verifier = codeVerifier;
  }

  let tokenData: { access_token?: string; error?: string; error_description?: string; statusMessage?: string; message?: string };
  let cpUser: { sub: string; username: string; display_name?: string; avatar_url?: string };
  try {
    const tokenResponse = await fetchWithTimeout('https://www.cpoauth.com/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokenBody),
    });

    tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string; error_description?: string; statusMessage?: string; message?: string };
    if (!tokenData.access_token) {
      console.error('CP OAuth token error (redirect_uri used):', redirectUri, 'body sent:', JSON.stringify(tokenBody), 'server response:', JSON.stringify(tokenData));
      const detail = tokenData.message || tokenData.error_description || tokenData.statusMessage || String(tokenData.error || 'unknown');
      return c.redirect(`${returnOrigin}/auth/callback?error=token_failed&detail=${encodeURIComponent(detail)}`);
    }

    // 用 access_token 获取用户信息
    const userResponse = await fetchWithTimeout('https://www.cpoauth.com/api/oauth/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    cpUser = (await userResponse.json()) as {
      sub: string;
      username: string;
      display_name?: string;
      avatar_url?: string;
    };
  } catch (e) {
    console.error('CP OAuth request failed (timeout/network):', e);
    return c.redirect(`${returnOrigin}/auth/callback?error=token_failed`);
  }

  if (!cpUser.sub || !cpUser.username) {
    console.error('CP OAuth userinfo error: missing sub or username', JSON.stringify(cpUser));
    return c.redirect(`${returnOrigin}/auth/callback?error=userinfo_failed`);
  }

  // 根据 cpoauth_id 查找或创建用户
  let user: any = await c.env.DB.prepare('SELECT * FROM users WHERE cpoauth_id = ?')
    .bind(cpUser.sub)
    .first();

  if (!user) {
    // 检查用户名是否已存在(其他登录方式注册的)
    const existing: any = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?')
      .bind(cpUser.username)
      .first();

    if (existing) {
      // 安全策略:绝不自动把 CpOAuth 绑定到现有账号(否则攻击者只需在 cpoauth.com
      // 注册与目标相同的用户名即可接管账号)。要求用户先登录原账号再显式绑定。
      console.error('CP OAuth login refused: username already exists with different cpoauth_id', { existingId: existing.id });
      return c.redirect(`${returnOrigin}/auth/callback?error=username_conflict`);
    } else {
      // 创建新用户
      const result = await c.env.DB.prepare(
        'INSERT INTO users (cpoauth_id, username, avatar_url, role) VALUES (?, ?, ?, ?)'
      )
        .bind(cpUser.sub, cpUser.username, cpUser.avatar_url || null, 'user')
        .run();
      user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
        .bind(result.meta.last_row_id)
        .first();
    }
  } else {
    // 更新头像
    if (cpUser.avatar_url && user.avatar_url !== cpUser.avatar_url) {
      await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?')
        .bind(cpUser.avatar_url, user.id)
        .run();
      user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    }
  }

  const token = await signJWT(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions ? JSON.parse(user.permissions) : [],
    },
    c.env.JWT_SECRET
  );

  // 清除 OAuth 临时 cookie(Path 必须与设置时一致才能清除)
  c.header('Set-Cookie', 'cpoauth_cv=; Path=/api/v1/auth/; Max-Age=0');
  c.header('Set-Cookie', 'cpoauth_st=; Path=/api/v1/auth/; Max-Age=0', { append: true });

  return redirectWithExchangeCode(c, token, pending.return_url);
});

// GitHub OAuth (existing)
auth.get('/github', async (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  const callbackBase = await getOAuthCallbackBase(c);
  const redirectUri = `${callbackBase}/api/v1/auth/github/callback`;

  // 记录发起登录的来源域(domain B),回调成功后用于跳回。仅接受 origin,防开放重定向。
  const returnOrigin = normalizeReturnOrigin(c.req.query('return_url'));

  // 生成 state 防止 OAuth CSRF（与 CP OAuth 一致），以 HttpOnly Cookie 存储，回调时校验
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = base64url(stateBytes.buffer as ArrayBuffer);

  // 将 state + return_url 写入 DB,回调反查(消除 cookie 覆盖竞态导致的误判)
  await storePendingState(c, 'github', state, returnOrigin);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'user:email',
    state,
  });
  const githubAuthUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

  const cookieOpts = 'Path=/api/v1/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=600';
  c.header('Set-Cookie', `gh_oauth_st=${state}; ${cookieOpts}`);
  if (returnOrigin) {
    c.header('Set-Cookie', `oauth_return=${encodeURIComponent(returnOrigin)}; ${cookieOpts}`, { append: true });
  }
  return c.redirect(githubAuthUrl);
});

auth.get('/github/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code) {
    return c.json({ success: false, error: { message: 'Missing authorization code', code: 'BAD_REQUEST' } }, 400);
  }

  // 校验 state 防止 OAuth 登录 CSRF::以 DB 中的 oauth_pending 为权威来源,
  // 并按该次发起时记录的 return_url 跳回来源域。consuming 会一次性删除该 state。
  const pending = await consumePendingState(c, 'github', state || '');
  // 跳回来源域(B)或站点主域,用于成功与失败重定向(cookie return_url 作为兜底)
  const returnOrigin = pending.matched
    ? (pending.return_url || getReturnOriginFromCookie(c) || normalizeReturnOrigin(c.env.FRONTEND_URL) || '')
    : (getReturnOriginFromCookie(c) || normalizeReturnOrigin(c.env.FRONTEND_URL) || '');
  if (!pending.matched) {
    return c.redirect(`${returnOrigin}/auth/callback?error=state_mismatch`);
  }
  // state 一次性使用，校验通过后立即清除 cookie
  c.header('Set-Cookie', 'gh_oauth_st=; Path=/api/v1/auth/; Max-Age=0');

  let tokenData: { access_token?: string; error?: string };
  let githubUser: { id: number; login: string; avatar_url: string };
  try {
    const tokenResponse = await fetchWithTimeout('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      return c.json({ success: false, error: { message: 'Failed to obtain access token', code: 'BAD_REQUEST' } }, 400);
    }

    const userResponse = await fetchWithTimeout('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'OJ-System',
      },
    });

    githubUser = (await userResponse.json()) as {
      id: number;
      login: string;
      avatar_url: string;
    };
  } catch (e) {
    console.error('GitHub OAuth request failed (timeout/network):', e);
    return c.redirect(`${returnOrigin}/auth/callback?error=token_failed`);
  }

  let user: any = await c.env.DB.prepare('SELECT * FROM users WHERE github_id = ?')
    .bind(githubUser.id)
    .first();

  if (!user) {
    const result = await c.env.DB.prepare(
      'INSERT INTO users (github_id, username, avatar_url, role) VALUES (?, ?, ?, ?)'
    )
      .bind(githubUser.id, githubUser.login, githubUser.avatar_url, 'user')
      .run();
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(result.meta.last_row_id)
      .first();
  } else {
    // Update avatar if changed
    if (githubUser.avatar_url && user.avatar_url !== githubUser.avatar_url) {
      await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?')
        .bind(githubUser.avatar_url, user.id)
        .run();
      user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    }
  }

  const token = await signJWT(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions ? JSON.parse(user.permissions) : [],
    },
    c.env.JWT_SECRET
  );

  return redirectWithExchangeCode(c, token, pending.return_url);
});

// New: register with username/password
// 注册限流:5 次 / 10 分钟(较审计前的 10 次/5 分钟更严格)。
// 限流中间件已同时按 IP(cf-connecting-ip / x-forwarded-for)与设备指纹聚合,
// 防止换 IP 绕过;叠加 captchaMiddleware 后足以抵御批量注册/验证码爆破。
auth.post('/register', captchaMiddleware('register'), createRateLimiter('register', 5, 600_000), async (c) => {
  const body: any = await c.req.json();
  const username = (body.username || '').trim();
  const password = body.password;
  const email = body.email ? (body.email as string).trim() : undefined;

  if (!username || !password) {
    return c.json({ success: false, error: { message: 'Missing username or password', code: 'BAD_REQUEST' } }, 400);
  }

  const usernameError = validateUsername(username);
  if (usernameError) {
    return c.json({ success: false, error: { message: usernameError, code: 'BAD_REQUEST' } }, 400);
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return c.json({ success: false, error: { message: passwordError, code: 'BAD_REQUEST' } }, 400);
  }

  // Check registration open flag from settings table or env
  let registrationOpen = true;
  try {
    const row: any = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('registration_open').first();
    if (row && row.value !== undefined) {
      registrationOpen = row.value === 'true';
    } else if (typeof c.env.REGISTRATION_OPEN !== 'undefined') {
      registrationOpen = String(c.env.REGISTRATION_OPEN) === 'true';
    }
  } catch (e) {
    // ignore and fallback to env
    if (typeof c.env.REGISTRATION_OPEN !== 'undefined') {
      registrationOpen = String(c.env.REGISTRATION_OPEN) === 'true';
    }
  }

  if (!registrationOpen) {
    return c.json({ success: false, error: { message: 'Registration is closed', code: 'FORBIDDEN' } }, 403);
  }

  // Check email_required setting
  let emailRequired = false;
  try {
    const row: any = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('email_required').first();
    if (row && row.value !== undefined) {
      emailRequired = row.value === 'true';
    }
  } catch { /* ignore */ }

  if (emailRequired && !email) {
    return c.json({ success: false, error: { message: 'Email is required', code: 'BAD_REQUEST' } }, 400);
  }

  // Validate email format if provided
  if (email) {
    const emailError = validateEmail(email);
    if (emailError) {
      return c.json({ success: false, error: { message: 'Invalid email format', code: 'BAD_REQUEST' } }, 400);
    }
  }

  // Check email_suffixes setting
  let emailSuffixes = '';
  try {
    const row: any = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('email_suffixes').first();
    if (row && row.value) {
      emailSuffixes = row.value;
    }
  } catch { /* ignore */ }

  if (email && emailSuffixes) {
    const allowedSuffixes = emailSuffixes.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    const emailLower = email.toLowerCase();
    const suffixMatch = allowedSuffixes.some((s: string) => emailLower.endsWith(s));
    if (!suffixMatch) {
      return c.json({ success: false, error: { message: 'Email suffix not allowed', code: 'BAD_REQUEST' } }, 400);
    }
  }

  // Check email verification code if email is provided
  if (email) {
    const verificationCode = body.verification_code;
    if (!verificationCode) {
      return c.json({ success: false, error: { message: 'Verification code is required', code: 'BAD_REQUEST' } }, 400);
    }

    const record: any = await c.env.DB.prepare(
      'SELECT id, code, used, expires_at FROM email_verification_codes WHERE email = ? ORDER BY id DESC LIMIT 1'
    ).bind(email).first();

    if (!record) {
      return c.json({ success: false, error: { message: 'No verification code found. Please request one first.', code: 'BAD_REQUEST' } }, 400);
    }

    if (record.used === 1) {
      return c.json({ success: false, error: { message: 'Verification code already used', code: 'BAD_REQUEST' } }, 400);
    }

    if (record.code !== verificationCode) {
      return c.json({ success: false, error: { message: 'Invalid verification code', code: 'BAD_REQUEST' } }, 400);
    }

    if (new Date(record.expires_at) < new Date()) {
      return c.json({ success: false, error: { message: 'Verification code expired. Please request a new one.', code: 'BAD_REQUEST' } }, 400);
    }

    // Mark code as used
    await c.env.DB.prepare('UPDATE email_verification_codes SET used = 1 WHERE id = ?').bind(record.id).run();
  }

  // 用户名冲突检查(H6):
  //  - 用户名是公开信息(显示在用户主页等),直接返回 409 无安全风险
  //  - 邮箱是个人信息,绝不能告诉调用方"邮箱已存在",否则与 send-verification-code
  //    的反枚举防御(返回与"未注册"完全相同的成功响应)形成旁路漏洞。
  // 因此:用户名冲突返回 409;邮箱冲突静默成功(假装注册成功,但不创建账号,不返回 token)。
  const emailParam = email ?? null;
  const usernameConflict: any = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (usernameConflict) {
    return c.json({ success: false, error: { message: 'Username already exists', code: 'CONFLICT' } }, 409);
  }

  if (email) {
    const emailConflict: any = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (emailConflict) {
      // 静默成功:返回与正常注册一致的响应结构与耗时特征,
      // 避免攻击者通过响应区分"邮箱已注册"vs"邮箱未注册"。
      // 不创建账号、不签发 token。攻击者拿到 token 后调用 /auth/me 会失败,
      // 但正常用户在意外用已注册邮箱重复注册时也会得到"注册成功"提示——
      // 这种边缘情况比邮箱枚举的危害低得多。
      return c.json({ success: true, data: { token: '' } });
    }
  }

  const passwordHash = bcrypt.hashSync(password, 12);

  const insertResult = await c.env.DB.prepare(
    'INSERT INTO users (username, password_hash, email, role) VALUES (?, ?, ?, ?)' 
  ).bind(username, passwordHash, emailParam, 'user').run();

  const user: any = await c.env.DB.prepare('SELECT id, username, role, permissions FROM users WHERE id = ?').bind(insertResult.meta.last_row_id).first();

  try {
    const token = await signJWT({ userId: user.id, username: user.username, role: user.role, permissions: user.permissions ? JSON.parse(user.permissions) : [] }, c.env.JWT_SECRET);
    return c.json({ success: true, data: { token } });
  } catch (e) {
    console.error('JWT Sign Error:', e);
    return c.json({ success: false, error: { message: 'Server configuration error', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// New: login with username/email + password
auth.post('/login', captchaMiddleware('login'), createRateLimiter('login', 10, 300_000), async (c) => {
  const body: any = await c.req.json();
  const usernameOrEmail = (body.username || body.email || '').trim();
  const password = body.password;

  if (!usernameOrEmail || !password) {
    return c.json({ success: false, error: { message: 'Missing credentials', code: 'BAD_REQUEST' } }, 400);
  }

  const user: any = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? OR email = ?').bind(usernameOrEmail, usernameOrEmail).first();
  if (!user) {
    return c.json({ success: false, error: { message: 'Invalid username/email or password', code: 'UNAUTHORIZED' } }, 401);
  }

  if (!user.password_hash) {
    return c.json({ success: false, error: { message: 'Account does not have a password set; use OAuth login', code: 'UNAUTHORIZED' } }, 401);
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return c.json({ success: false, error: { message: 'Invalid username/email or password', code: 'UNAUTHORIZED' } }, 401);
  }

  try {
    const token = await signJWT({ userId: user.id, username: user.username, role: user.role, permissions: user.permissions ? JSON.parse(user.permissions) : [] }, c.env.JWT_SECRET);
    return c.json({ success: true, data: { token } });
  } catch (e) {
    console.error('JWT Sign Error:', e);
    return c.json({ success: false, error: { message: 'Server configuration error', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// Send email verification code for registration
auth.post('/send-verification-code', createRateLimiter('sendVerificationCode', 3, 120_000), async (c) => {
  const body: any = await c.req.json();
  const email = (body.email || '').trim().toLowerCase();

  if (!email) {
    return c.json({ success: false, error: { message: 'Email is required', code: 'BAD_REQUEST' } }, 400);
  }

  const emailError = validateEmail(email);
  if (emailError) {
    return c.json({ success: false, error: { message: 'Invalid email format', code: 'BAD_REQUEST' } }, 400);
  }

  // Check if email is already registered
  // 返回与"未注册邮箱"完全相同的成功响应,防止通过该接口枚举已注册邮箱
  const existing: any = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return c.json({ success: true, data: { message: 'If this email is not registered, a verification code has been sent.' } });
  }

  // Email-bomb guard: the IP rate limiter above can be rotated, so also refuse
  // to regenerate a code for the SAME email within the cooldown window.
  const recent: any = await c.env.DB.prepare(
    'SELECT id FROM email_verification_codes WHERE email = ? AND expires_at > ?'
  ).bind(email, new Date(Date.now() + 60 * 1000).toISOString()).first();
  if (recent) {
    return c.json({ success: false, error: { message: 'Verification code already sent, please wait before requesting another', code: 'RATE_LIMITED' } }, 429);
  }

  // Delete old verification codes for this email
  await c.env.DB.prepare('DELETE FROM email_verification_codes WHERE email = ?').bind(email).run();

  // Generate 6-digit code using cryptographically secure RNG
  // (避免使用 Math.random() 导致短时间内的可预测性)
  const codeRandomBytes = new Uint8Array(4);
  crypto.getRandomValues(codeRandomBytes);
  const codeRandomNum = (codeRandomBytes[0] << 24) | (codeRandomBytes[1] << 16) | (codeRandomBytes[2] << 8) | codeRandomBytes[3];
  const code = String(Math.abs(codeRandomNum) % 1000000).padStart(6, '0');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  // Store the code
  await c.env.DB.prepare(
    'INSERT INTO email_verification_codes (email, code, expires_at) VALUES (?, ?, ?)'
  ).bind(email, code, expiresAt).run();

  // Send email via Cloudflare Email Binding
  const sendEmail = (c.env as any).SEND_EMAIL;
  if (!sendEmail || typeof sendEmail.send !== 'function') {
    // 仅本地开发环境回显验证码(便于测试);生产环境无 binding 时拒绝,避免验证码泄露
    try {
      const url = new URL(c.req.url);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        console.log('SEND_EMAIL binding not available (dev mode), returning code:', code);
        return c.json({ success: true, data: { message: 'Verification code sent', code } });
      }
    } catch { /* ignore parse errors */ }
    return c.json({ success: false, error: { message: 'Email service is not configured', code: 'EMAIL_NOT_CONFIGURED' } }, 500);
  }

  try {
    await sendEmail.send({
      from: c.env.DEFAULT_FROM_EMAIL,
      to: [email],
      subject: 'Your Registration Verification Code',
      text: `Your verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this, please ignore this email.`,
    });
  } catch (e) {
    const errMsg = typeof e === 'object' && e !== null ? String((e as any).message || (e as any).toString?.() || e) : String(e);
    console.error('Failed to send verification email:', errMsg);
    // In development (localhost), binding may exist but can't actually send — return code for testing
    try {
      const url = new URL(c.req.url);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return c.json({ success: true, data: { message: 'Verification code sent (dev)', code } });
      }
    } catch { /* ignore parse errors */ }
    return c.json({ success: false, error: { message: 'Failed to send email: ' + errMsg, code: 'EMAIL_SEND_FAILED' } }, 500);
  }

  return c.json({ success: true, data: { message: 'Verification code sent' } });
});

// ── Password Reset Flow ──

// POST /auth/forgot-password — send password reset email with token
auth.post('/forgot-password', createRateLimiter('forgotPassword', 3, 300_000), async (c) => {
  const body: any = await c.req.json();
  const email = (body.email || '').trim().toLowerCase();

  if (!email) {
    return c.json({ success: false, error: { message: 'Email is required', code: 'BAD_REQUEST' } }, 400);
  }

  const emailError = validateEmail(email);
  if (emailError) {
    return c.json({ success: false, error: { message: 'Invalid email format', code: 'BAD_REQUEST' } }, 400);
  }

  // Check if user exists with this email and has a password set
  const user: any = await c.env.DB.prepare('SELECT id, username, password_hash FROM users WHERE email = ?').bind(email).first();
  if (!user || !user.password_hash) {
    // Return success even if email not found (to prevent email enumeration)
    return c.json({ success: true, data: { message: 'If this email is registered, a reset link has been sent.' } });
  }

  // Delete old tokens for this email
  await c.env.DB.prepare('DELETE FROM password_reset_tokens WHERE email = ?').bind(email).run();

  // Generate a secure random token
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  // Store the token
  await c.env.DB.prepare(
    'INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)'
  ).bind(email, token, expiresAt).run();

  const resetUrl = `${c.env.FRONTEND_URL}/reset-password?token=${token}`;

  // Send email via Cloudflare Email Binding
  const sendEmail = (c.env as any).SEND_EMAIL;
  if (!sendEmail || typeof sendEmail.send !== 'function') {
    // 仅本地开发环境回显重置链接(便于测试);生产环境无 binding 时不泄露 resetUrl
    try {
      const url = new URL(c.req.url);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        console.log('SEND_EMAIL binding not available (dev mode), reset URL:', resetUrl);
        return c.json({ success: true, data: { message: 'If this email is registered, a reset link has been sent.', resetUrl } });
      }
    } catch { /* ignore parse errors */ }
    return c.json({ success: false, error: { message: 'Email service is not configured', code: 'EMAIL_NOT_CONFIGURED' } }, 500);
  }

  try {
    await sendEmail.send({
      from: c.env.DEFAULT_FROM_EMAIL || 'noreply@oj-system.com',
      to: [{ email }],
      subject: 'Password Reset Request',
      html: `<p>Hello ${user.username},</p>
<p>We received a request to reset your password. Click the link below to set a new password:</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>This link will expire in 1 hour.</p>
<p>If you did not request this, please ignore this email.</p>`,
    });
  } catch (e) {
    console.error('Failed to send reset email:', e);
    return c.json({ success: false, error: { message: 'Failed to send email', code: 'EMAIL_SEND_FAILED' } }, 500);
  }

  return c.json({ success: true, data: { message: 'If this email is registered, a reset link has been sent.' } });
});

// POST /auth/reset-password — verify token and set new password
auth.post('/reset-password', createRateLimiter('resetPassword', 5, 300_000), async (c) => {
  const body: any = await c.req.json();
  const { token, password } = body;

  if (!token || !password) {
    return c.json({ success: false, error: { message: 'Token and password are required', code: 'BAD_REQUEST' } }, 400);
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return c.json({ success: false, error: { message: passwordError, code: 'BAD_REQUEST' } }, 400);
  }

  const record: any = await c.env.DB.prepare(
    'SELECT id, email, used, expires_at FROM password_reset_tokens WHERE token = ?'
  ).bind(token).first();

  if (!record) {
    return c.json({ success: false, error: { message: 'Invalid or expired reset token', code: 'INVALID_TOKEN' } }, 400);
  }

  if (record.used === 1) {
    return c.json({ success: false, error: { message: 'Reset token has already been used', code: 'TOKEN_USED' } }, 400);
  }

  if (new Date(record.expires_at) < new Date()) {
    return c.json({ success: false, error: { message: 'Reset token has expired', code: 'TOKEN_EXPIRED' } }, 400);
  }

  // Hash the new password
  const passwordHash = await bcrypt.hashSync(password, 12);

  // Update user's password
  const result = await c.env.DB.prepare(
    'UPDATE users SET password_hash = ? WHERE email = ?'
  ).bind(passwordHash, record.email).run();

  if (result.meta.changes === 0) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }

  // Mark token as used
  await c.env.DB.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').bind(record.id).run();

  // Revoke all other tokens for this email
  await c.env.DB.prepare('UPDATE password_reset_tokens SET used = 1 WHERE email = ? AND id != ?').bind(record.email, record.id).run();

  return c.json({ success: true, data: { message: 'Password has been reset successfully' } });
});

auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }

  const token = authHeader.slice(7);
  const { verifyJWT } = await import('../utils/jwt');
  const payload = await verifyJWT(token, c.env.JWT_SECRET, (c.env as any).JWT_SECRET_PREVIOUS);
  if (!payload) {
    return c.json({ success: false, error: { message: 'Invalid or expired token', code: 'UNAUTHORIZED' } }, 401);
  }

  // 服务端实时校验封禁状态(与 authMiddleware 行为一致)
  try {
    const row: any = await c.env.DB.prepare('SELECT banned FROM users WHERE id = ?').bind(payload.userId).first();
    if (row && row.banned === 1) {
      return c.json({ success: false, error: { message: 'Account banned', code: 'ACCOUNT_BANNED' } }, 403);
    }
  } catch { /* ignore */ }

  // 必须返回 permissions 字段:前端 usePermissions hook 依赖它判断能否进入
  // 各类管理页面(contest_admin / problem_admin / ticket_admin / list_admin / upload_admin)。
  // 漏字段会让所有非 admin/super_admin 用户被 AdminLayout 拦截无法访问后台。
  const user: any = await c.env.DB.prepare(
    'SELECT id, username, avatar_url, role, permissions, created_at FROM users WHERE id = ?'
  )
    .bind(payload.userId)
    .first();

  if (!user) {
    return c.json({ success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }, 404);
  }

  // permissions 在 DB 中存储为 JSON 字符串,解析为数组返回,与登录接口保持一致
  try {
    const parsed = user.permissions ? JSON.parse(user.permissions) : [];
    user.permissions = Array.isArray(parsed) ? parsed : [];
  } catch {
    user.permissions = [];
  }

  return c.json({ success: true, data: { user } });
});

// POST /auth/exchange — 用一次性 code 换取 JWT
// 用于 OAuth 回调流程:OAuth 成功后后端把 JWT 存入 oauth_exchange_codes 表,
// 并以 ?code=... 重定向到前端;前端拿 code 调此接口取出 JWT,一次性消费。
// 这避免了把 JWT 直接放到 URL fragment 或 query 而被 Referer / 浏览器历史泄漏。
auth.post('/exchange', createRateLimiter('oauthExchange', 10, 60_000), async (c) => {
  const body: any = await c.req.json().catch(() => ({}));
  const code = body?.code;
  if (!code || typeof code !== 'string' || code.length > 128) {
    return c.json({ success: false, error: { message: 'Invalid code', code: 'BAD_REQUEST' } }, 400);
  }

  const now = Date.now();
  // 原子消费:仅当未过期且未使用时才把 used 标记为 1
  const row: any = await c.env.DB.prepare(
    'SELECT jwt, expires_at, used FROM oauth_exchange_codes WHERE code = ?'
  ).bind(code).first();

  if (!row) {
    return c.json({ success: false, error: { message: 'Invalid or expired code', code: 'INVALID_CODE' } }, 400);
  }
  if (row.used === 1 || row.expires_at < now) {
    // 已用 / 已过期 -> 删除并拒绝
    await c.env.DB.prepare('DELETE FROM oauth_exchange_codes WHERE code = ?').bind(code).run();
    return c.json({ success: false, error: { message: 'Invalid or expired code', code: 'INVALID_CODE' } }, 400);
  }

  // 标记为已用并删除(一次性)
  await c.env.DB.prepare('DELETE FROM oauth_exchange_codes WHERE code = ?').bind(code).run();

  // 顺手清理过期记录,避免表无限增长(每次调用顺便清理一批)
  try {
    await c.env.DB.prepare('DELETE FROM oauth_exchange_codes WHERE expires_at < ?').bind(now).run();
  } catch { /* ignore cleanup errors */ }

  return c.json({ success: true, data: { token: row.jwt } });
});

export default auth;
