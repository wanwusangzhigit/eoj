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
