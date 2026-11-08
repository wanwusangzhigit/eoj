import { Context, Next } from 'hono';
import { AppType } from '../types';

/**
 * 概率性清理过期限流记录:每次请求以 1% 概率执行 DELETE。
 * 用 Math.random() 抽样而非每次都删,避免高并发场景下每请求都触发的写锁竞争。
 * 即便不清理,SELECT 仍然只统计 created_at >= windowStart 的活记录,过期数据不影响判断准确性,
 * 只是占用一点磁盘空间(每次清理大约 1000 行时才会触发,实际增长很慢)。
 */
async function maybePrune(c: { env: AppType['Bindings'] }, windowStart: number): Promise<void> {
  if (Math.random() >= 0.01) return;
  try {
    // 分批删除以减少单次写锁持有时间(SQLite 单条 DELETE 也有锁,但限量后释放更快)
    await c.env.DB.prepare('DELETE FROM rate_limits WHERE created_at < ? LIMIT 1000')
      .bind(windowStart).run();
  } catch (e) {
    console.error('Rate limit prune error:', e);
  }
}

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

    // 概率性清理(P1-5:不再每请求都全表 DELETE,改为 1% 概率分批清理)
    await maybePrune(c, windowStart);

    // Clean up old entries and count recent submissions
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
      // 概率性清理过期记录(P1-5:不再每请求都全表 DELETE)
      await maybePrune(c, windowStart);
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
