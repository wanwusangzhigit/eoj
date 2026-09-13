import { Context, Next } from 'hono';
import { AppType, AuditLogRow } from '../types';
import { hashPii } from '../utils/helpers';

/**
 * Extract client IP from request headers (Cloudflare provides CF-Connecting-IP)
 *
 * 审计 #AU-1: 在非 Cloudflare 部署下 X-Real-IP / X-Forwarded-For 可被客户端伪造,
 * 但 CF-Workers 部署下 CF-Connecting-IP 由 CF 边缘强制写入,可信。
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
 * 上次清理 audit_logs 的 timestamp(进程内缓存,避免每请求都触发 DELETE)。
 * Workers 实例可能并发多个,每个实例各自按 ~10 分钟节奏清理,这对 D1 来说是可接受的
 * 重复 DELETE(IF EXISTS + 行已经不存在就 noop)。
 */
let lastAuditCleanupMs = 0;
const AUDIT_LOG_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 天
const AUDIT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;  // 每 10 分钟最多触发一次

async function maybeCleanupOldAuditLogs(db: D1Database): Promise<void> {
  const now = Date.now();
  if (now - lastAuditCleanupMs < AUDIT_CLEANUP_INTERVAL_MS) return;
  lastAuditCleanupMs = now;
  const cutoff = new Date(now - AUDIT_LOG_TTL_MS).toISOString();
  try {
    await db.prepare('DELETE FROM audit_logs WHERE created_at < ?').bind(cutoff).run();
  } catch { /* ignore cleanup failures */ }
}

/**
 * Record an audit log entry.
 *
 * 审计 #H-14/#H-16: ip 与 device_fingerprint 列直接写 SHA-256 哈希值(带可读前缀),
 * 让 DB 即使泄漏也无法直接还原原始 IP / 设备指纹。读取端(routes/audit.ts)在
 * 按查询参数过滤时,先用同样算法哈希查询字符串再比对。
 */
export async function recordAuditLog(
  c: Context<AppType>,
  action: string,
  userId?: number,
  username?: string
): Promise<void> {
  try {
    const rawIp = getClientIP(c);
    const rawFp = getDeviceFingerprint(c);
    const method = c.req.method;
    const path = c.req.path;
    const userAgent = c.req.header('User-Agent') || '';

    // Don't log health checks or static assets
    if (path === '/api/v1/health' || path.startsWith('/__')) return;

    // 哈希 PII:保留 2 字符可读前缀便于运维识别同 /24 网段;
    // 设备指纹无网段概念,prefixLen=0 全哈希。
    const ipHash = await hashPii(rawIp, { prefixLen: 2 });
    const fpHash = await hashPii(rawFp, { prefixLen: 0 });

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, username, ip, device_fingerprint, page, action, method, path, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      userId || null,
      username || null,
      ipHash,
      fpHash,
      path,
      action,
      method,
      path,
      userAgent.substring(0, 500) // Truncate long user agents
    ).run();

    // 惰性触发过期审计日志清理(90 天 TTL)
    await maybeCleanupOldAuditLogs(c.env.DB);
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
 *
 * 审计 #H-14: banned_ips.ip / banned_devices.device_fingerprint 现在存哈希值,
 * 这里检查时也必须先对当前请求 IP/指纹哈希后再比对。
 */
export async function banCheckMiddleware(c: Context<AppType>, next: Next) {
  const rawIp = getClientIP(c);
  const rawFp = getDeviceFingerprint(c);

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

  // 哈希后比对(banned_ips 与 banned_devices 已存哈希值)。
  // 用与 recordAuditLog 相同的 prefixLen,确保两边匹配语义一致。
  const ipHash = await hashPii(rawIp, { prefixLen: 2 });
  const fpHash = await hashPii(rawFp, { prefixLen: 0 });

  // Check banned IPs
  try {
    if (rawIp !== 'unknown') {
      const bannedIP = await c.env.DB.prepare(
        'SELECT id FROM banned_ips WHERE ip = ?'
      ).bind(ipHash).first();

      if (bannedIP) {
        return c.json({ success: false, error: { message: 'Access denied: IP is banned', code: 'IP_BANNED' } }, 403);
      }
    }
  } catch { /* ignore DB errors */ }

  // Check banned devices
  try {
    if (rawFp) {
      const bannedDevice = await c.env.DB.prepare(
        'SELECT id FROM banned_devices WHERE device_fingerprint = ?'
      ).bind(fpHash).first();

      if (bannedDevice) {
        return c.json({ success: false, error: { message: 'Access denied: device is banned', code: 'DEVICE_BANNED' } }, 403);
      }
    }
  } catch { /* ignore DB errors */ }

  await next();
}
