// 比赛时间解析工具(与后端 utils/contest-time.ts 的 parseContestTimeToMs 保持一致)

// Parse contest time strings into millisecond timestamps in a timezone-safe way.
// Handles DB time formats like "YYYY-MM-DD HH:MM:SS" (treated as UTC)
export function parseContestTimeToMs(t: any): number {
  if (!t) return NaN;
  let s = String(t);
  // If format is like "2024-01-01 12:00:00" (no timezone), explicitly treat as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    // Parse components and construct UTC timestamp
    const [datePart, timePart] = s.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);
    // Use Date.UTC to ensure UTC interpretation
    return Date.UTC(year, month - 1, day, hour, minute, second);
  }
  // For ISO strings with timezone (ending with Z or +/-HH:MM), rely on JS Date parsing
  const ms = new Date(s).getTime();
  if (isNaN(ms)) {
    // Fallback: if parsing failed, assume UTC for non-ISO strings
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const parts = s.replace(/[-T:]/g, '-').split('-');
      if (parts.length >= 3) {
        return Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
      }
    }
  }
  return ms;
}

// 统一展示格式：先按 UTC 语义解析 (与状态判断一致),再按用户本地时区格式化
// 避免无时区字符串被浏览器按本地时区解析导致时区偏移
export function formatContestTime(t: any): string {
  const ms = parseContestTimeToMs(t);
  if (!isFinite(ms)) return t ? String(t) : '';
  // Always format in user's local time zone using standard localeString
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// 转 datetime-local 输入框的本地值 (用于创建/编辑比赛表单回填)
// Converts UTC timestamp to local datetime string for input type="datetime-local"
export function toLocalDatetimeString(dateStr: string): string {
  const ms = parseContestTimeToMs(dateStr);
  if (!isFinite(ms)) return '';
  const d = new Date(ms);
  // Create local ISO string without milliseconds, truncated to minutes
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}
