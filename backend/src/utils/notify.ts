/**
 * 通知发送工具：在各个模块中复用。
 * 用法：await sendNotification(c.env.DB, userId, 'mention', '有人回复了你', '点击查看', '/discussions/1');
 */
export async function sendNotification(
  db: D1Database,
  userId: number,
  type: string,
  title: string,
  content: string = '',
  link: string = ''
): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO notifications (user_id, type, title, content, link) VALUES (?, ?, ?, ?, ?)'
    ).bind(userId, type, title, content, link).run();
  } catch (e) {
    // 通知失败不应阻塞主流程，仅记录日志
    console.error('Failed to send notification:', e);
  }
}

export const NotificationType = {
  MENTION: 'mention',
  FOLLOW: 'follow',
  MESSAGE: 'message',
  CONTEST: 'contest',
  SOLUTION_REVIEW: 'solution_review',
  REPORT: 'report',
  SYSTEM: 'system',
} as const;
