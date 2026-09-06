import { Context, Next } from 'hono';
import { AppType, CountResult } from '../types';

export async function rateLimitMiddleware(c: Context<AppType>, next: Next) {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }

  const key = `submit:${user.userId}`;
  const windowMs = 60_000;
  const maxRequests = 10;

  try {
    // Use D1 for rate limiting (works across Workers instances)
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries and count recent submissions
    await c.env.DB.prepare(
      "DELETE FROM rate_limits WHERE created_at < ?"
    ).bind(windowStart).run();

    const result = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM rate_limits WHERE key = ? AND created_at >= ?"
    ).bind(key, windowStart).first();

    const count = (result as any)?.count || 0;

    if (count >= maxRequests) {
      return c.json({
        success: false,
        error: {
          message: 'Rate limit exceeded: max 10 submissions per minute',
          code: 'RATE_LIMITED'
        }
      }, 429);
    }

    // Record this request
    await c.env.DB.prepare(
      "INSERT INTO rate_limits (key, created_at) VALUES (?, ?)"
    ).bind(key, now).run();

    await next();
  } catch (e) {
    // On rate limiter failure, fail CLOSED to prevent bypass attacks
    console.error('Rate limit error:', e);
    return c.json({
      success: false,
      error: {
        message: 'Rate limit check unavailable. Please try again later.',
        code: 'RATE_LIMIT_UNAVAILABLE'
      }
    }, 503);
  }
}

export function createRateLimiter(prefix: string, maxRequests: number, windowMs: number) {
  return async (c: Context<AppType>, next: Next) => {
    const user = c.get('user');
    // For unauthenticated routes (login/register), rate-limit by BOTH the
    // client IP and the device fingerprint, so proxy-rotating attackers
    // cannot bypass the limit by changing IP while keeping one fingerprint.
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const fingerprint = c.req.header('x-device-fingerprint') || '';
    const keys = user
      ? [`${prefix}:${user.userId}`]
      : [`${prefix}:ip:${ip}`, fingerprint ? `${prefix}:fp:${fingerprint}` : ''].filter(Boolean);
    const now = Date.now();
    const windowStart = now - windowMs;
    try {
      await c.env.DB.prepare("DELETE FROM rate_limits WHERE created_at < ?").bind(windowStart).run();
      // Every dimension key must be under the limit.
      let over = false;
      for (const k of keys) {
        const result = await c.env.DB.prepare("SELECT COUNT(*) as count FROM rate_limits WHERE key = ? AND created_at >= ?").bind(k, windowStart).first();
        const count = (result as any)?.count || 0;
        if (count >= maxRequests) {
          over = true;
          break;
        }
      }
      if (over) {
        return c.json({ success: false, error: { message: `Rate limit exceeded`, code: 'RATE_LIMITED' } }, 429);
      }
      for (const k of keys) {
        await c.env.DB.prepare("INSERT INTO rate_limits (key, created_at) VALUES (?, ?)").bind(k, now).run();
      }
      await next();
    } catch (e) {
      // Fail CLOSED on error to prevent bypassing rate limits
      console.error('Rate limit error:', e);
      return c.json({
        success: false,
        error: { message: 'Rate limit check unavailable. Please try again later.', code: 'RATE_LIMIT_UNAVAILABLE' }
      }, 503);
    }
  };
}
