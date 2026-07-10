import { Context, Next } from 'hono';
import { AppType } from '../types';

/**
 * Extract client IP from request headers (Cloudflare provides CF-Connecting-IP)
 */
export function getClientIP(c: Context<AppType>): string {
  return c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Real-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
}

/**
 * Extract device fingerprint from custom header (set by frontend)
 */
export function getDeviceFingerprint(c: Context<AppType>): string {
  return c.req.header('X-Device-Fingerprint') || '';
}

/**
 * Record an audit log entry
 */
export async function recordAuditLog(
  c: Context<AppType>,
  action: string,
  userId?: number,
  username?: string
): Promise<void> {
  try {
    const ip = getClientIP(c);
    const deviceFingerprint = getDeviceFingerprint(c);
    const method = c.req.method;
    const path = c.req.path;
    const userAgent = c.req.header('User-Agent') || '';

    // Don't log health checks or static assets
    if (path === '/api/v1/health' || path.startsWith('/__')) return;

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, username, ip, device_fingerprint, page, action, method, path, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      userId || null,
      username || null,
      ip,
      deviceFingerprint,
      path,
      action,
      method,
      path,
      userAgent.substring(0, 500) // Truncate long user agents
    ).run();
  } catch {
    // Audit logging should never block the request
  }
}

/**
 * Audit middleware - records request and extracts user info if authenticated
 */
export async function auditMiddleware(c: Context<AppType>, next: Next) {
  await next();

  // After handler executes, record the audit log
  try {
    const user = c.get('user');
    const method = c.req.method;
    const path = c.req.path;

    // Only audit write operations and significant reads
    const shouldAudit = method !== 'GET' ||
      path.includes('/auth/') ||
      path.includes('/admin/');

    if (shouldAudit) {
      const action = `${method} ${path}`;
      await recordAuditLog(c, action, user?.userId, user?.username);
    }
  } catch {
    // Never block the request due to audit failure
  }
}

/**
 * IP/Device ban check middleware - blocks requests from banned IPs or devices
 * Super admins (role='super_admin' or userId=1) are exempt to prevent lockout
 */
export async function banCheckMiddleware(c: Context<AppType>, next: Next) {
  const ip = getClientIP(c);
  const deviceFingerprint = getDeviceFingerprint(c);

  // Try to authenticate the user; if they are super admin, skip ban checks
  let isSuperAdmin = false;
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const { verifyJWT } = await import('../utils/jwt');
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      if (payload && (payload.role === 'super_admin' || payload.userId === 1)) {
        isSuperAdmin = true;
      }
    } catch { /* invalid token, proceed with ban checks */ }
  }

  if (isSuperAdmin) {
    await next();
    return;
  }

  // Check banned IPs
  try {
    if (ip !== 'unknown') {
      const bannedIP = await c.env.DB.prepare(
        'SELECT id FROM banned_ips WHERE ip = ?'
      ).bind(ip).first();

      if (bannedIP) {
        return c.json({ success: false, error: { message: 'Access denied: IP is banned', code: 'IP_BANNED' } }, 403);
      }
    }
  } catch { /* ignore DB errors */ }

  // Check banned devices
  try {
    if (deviceFingerprint) {
      const bannedDevice = await c.env.DB.prepare(
        'SELECT id FROM banned_devices WHERE device_fingerprint = ?'
      ).bind(deviceFingerprint).first();

      if (bannedDevice) {
        return c.json({ success: false, error: { message: 'Access denied: device is banned', code: 'DEVICE_BANNED' } }, 403);
      }
    }
  } catch { /* ignore DB errors */ }

  await next();
}
