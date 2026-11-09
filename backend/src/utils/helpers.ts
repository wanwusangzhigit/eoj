/**
 * 安全的整数解析:无效输入(空串、非数字、NaN、Infinity)返回 fallback。
 *
 * 用于所有 `c.req.param('id')` 和某些 `c.req.query(...)` 解析场景,
 * 避免 `parseInt(undefined|string) → NaN` 被绑定到 D1 时触发意外错误或空查询。
 *
 * 与原生 parseInt 的区别:
 *   - 严格只接受纯数字字符串(允许前导/后置空白,允许前导 + / -)
 *   - 拒绝 "123abc" 这种部分解析(parseInt 会返回 123,这里返回 fallback)
 *
 * 例:
 *   safeParseInt('42')        → 42
 *   safeParseInt('  42  ')    → 42
 *   safeParseInt('123abc')    → 0(fallback)
 *   safeParseInt(undefined)   → 0
 *   safeParseInt('', 5)       → 5
 *   safeParseInt('-1')        → -1(留给调用方判断范围)
 */
export function safeParseInt(raw: unknown, fallback: number = 0): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.trunc(raw) : fallback;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return fallback;
    // 严格整数:可选符号 + 纯数字,允许最大 16 位(超出 Number.MAX_SAFE_INTEGER 时退化)
    if (!/^[+-]?\d{1,16}$/.test(trimmed)) return fallback;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export const LANGUAGE_EXT: Record<string, string> = {
  python: 'py',
  cpp: 'cpp',
  java: 'java',
  javascript: 'js',
  c: 'c',
  go: 'go',
  rust: 'rs',
};

export function getLanguageExt(language: string): string {
  return LANGUAGE_EXT[language] || 'txt';
}

export function jsonResponse<T>(data: T, status = 200) {
  return Response.json(data, { status });
}

export function paginate(page: number, pageSize: number, total: number) {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
  };
}

/**
 * Parse a `limit` query parameter with both lower AND upper bounds.
 * Used by endpoints that take `?limit=N` directly (e.g. rankings).
 *
 * Fixes audit finding H-9: `Math.min(50, parseInt(...))` had no lower bound,
 * so `?limit=-1` (SQLite treats as "no limit") and `?limit=abc` (NaN)
 * both bypassed pagination and returned the entire table.
 *
 * Returns `fallback` when the input is missing or unparsable.
 */
export function parseLimit(raw: string | undefined | null, opts: { min: number; max: number; fallback: number }): number {
  const parsed = parseInt((raw ?? '').toString() || String(opts.fallback));
  if (!Number.isFinite(parsed)) return opts.fallback;
  return Math.min(opts.max, Math.max(opts.min, parsed));
}

/**
 * Parse page/pageSize from query params with sensible defaults and bounds.
 */
export function escapeLikeWildcard(input: string): string {
  // Escape backslashes FIRST, then wildcards. Otherwise crafted input like
  // `\%` keeps a literal backslash that un-escapes `%`/`_` in the SQL LIKE.
  const escapedBackslashes = input.replace(/\\/g, '\\\\');
  return escapedBackslashes.replace(/[%_]/g, '\\$&');
}

export function parsePagination(
  query: { page?: string; pageSize?: string },
  defaultPageSize = 20,
  maxPageSize = 50,
): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, parseInt(query.page || '1'));
  const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(query.pageSize || String(defaultPageSize))));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

/**
 * Hash a PII value (IP address, device fingerprint) for storage in audit logs
 * and ban tables. Returns `sha256(prefix:value)` hex-encoded, prefixed with
 * the original first N characters so operators can still cluster by
 * network /24 or vendor without recovering the full identifier.
 *
 * Fixes audit finding H-14/H-16: plaintext PII in audit_logs / banned_ips
 * enabled deanonymization joins once the DB is exfiltrated. The `_hash`
 * columns store the SHA-256 of the full value; the legacy plaintext columns
 * are retained for back-compat with historical rows but new writes prefer
 * the hash column.
 *
 * Examples:
 *   hashPii('192.168.1.10', { prefixLen: 0 })  → 'sha256:a91f...'
 *   hashPii('192.168.1.10', { prefixLen: 2 })  → '19.2sha256:a91f...' (network slice preserved)
 *   hashPii('')                                 → ''
 *   hashPii('unknown')                          → 'unsha256:...'   (literal sentinel still recognizable)
 */
export async function hashPii(
  value: string,
  opts: { prefixLen?: number } = {},
): Promise<string> {
  if (!value) return '';
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const prefixLen = opts.prefixLen ?? 0;
  if (prefixLen <= 0) return `sha256:${hex}`;
  // Take prefix chars (collapsing runs so '192.16' doesn't leak full octets),
  // then mark the boundary with a sentinel so the hash part is unambiguous.
  const prefix = value.replace(/[^a-zA-Z0-9]/g, '').slice(0, prefixLen);
  return `${prefix}~sha256:${hex}`;
}
