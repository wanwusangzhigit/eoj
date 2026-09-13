// 比赛时间解析与状态计算的共享工具(contests.ts / submissions.ts 共用)

// Parse contest time strings into millisecond timestamps in a timezone-safe way.
// Handles DB time formats like "YYYY-MM-DD HH:MM:SS" (treated as UTC)
export function parseContestTimeToMs(t: any): number {
  if (!t) return NaN;
  let s = String(t);
  // If format is like "2024-01-01 12:00:00" (no timezone), treat as UTC by converting to ISO-like with Z
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  }
  // Otherwise rely on JS Date parsing (ISO strings with timezone will work)
  return new Date(s).getTime();
}

// 按当前时间动态计算比赛状态(不依赖可能过期的 contest.status 静态字段)
export function effectiveContestStatus(contest: any): 'upcoming' | 'running' | 'ended' {
  const now = Date.now();
  const start = parseContestTimeToMs(contest.start_time);
  const end = parseContestTimeToMs(contest.end_time);
  if (!isFinite(start) || !isFinite(end)) return 'upcoming';
  if (now >= start && now < end) return 'running';
  if (now >= end) return 'ended';
  return 'upcoming';
}

// 判定用户是否为比赛主办方/管理员(用于私有比赛可见性与权限校验)
export function isContestAdmin(user: any): boolean {
  if (!user) return false;
  return user.role === 'admin'
    || user.role === 'super_admin'
    || user.userId === 1
    || (Array.isArray(user.permissions) && user.permissions.includes('contest_admin'));
}

/**
 * 判定用户是否拥有"全站"管理员权限(role=admin/super_admin 或 userId=1)。
 *
 * 审计 #H-7: 此前 isContestAdmin() 把持有 contest_admin permission 的用户
 * 也视为全站管理员,在 submissions.ts 中被用作"是否可读他人提交源代码"
 * 的判定,导致 contest_admin 能读全站任何人的源代码。这里引入语义清晰的
 * isSiteAdmin(),它仅承认真正的全站管理员;contest_admin 只是"针对某些
 * 比赛的运营权限",不应越过自己负责的比赛边界。
 *
 * 需要按比赛粒度判断时调用 isContestOrganizer(user, contest)。
 */
export function isSiteAdmin(user: any): boolean {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'super_admin' || user.userId === 1;
}

// 计算封榜相关参数。
// 比赛进行中且已进入冻结期(freeze_minutes 内)时返回 boardFrozen=true,
// 并以 ISO 字符串形式返回应使用的提交时间窗口上界(冻结时为冻结时刻,否则为比赛结束时刻)。
export function computeFreezeWindow(contest: any): {
  boardFrozen: boolean;
  rankingEndIso: string;
  freezeStartIso: string | null;
} {
  const nowMs = Date.now();
  const endMs = parseContestTimeToMs(contest.end_time);
  const freezeMinutes = parseInt(contest.freeze_minutes) || 0;
  const freezeStartMs = freezeMinutes > 0 ? endMs - freezeMinutes * 60000 : null;
  const boardFrozen =
    effectiveContestStatus(contest) === 'running'
    && freezeStartMs !== null
    && nowMs >= freezeStartMs;
  const rankingEndMs = boardFrozen && freezeStartMs !== null ? freezeStartMs : endMs;
  return {
    boardFrozen,
    rankingEndIso: isFinite(rankingEndMs) ? new Date(rankingEndMs).toISOString() : new Date(endMs).toISOString(),
    freezeStartIso: freezeStartMs !== null && isFinite(freezeStartMs) ? new Date(freezeStartMs).toISOString() : null,
  };
}
