import { useEffect, useRef } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { parseContestTimeToMs } from '../utils/contestTime';
import { t } from '../i18n';

/**
 * Custom hook: 检查即将开始的比赛并发送浏览器通知
 * 每分钟检查一次，在比赛开始前5分钟和开始时发送通知
 */
const NOTIFIED_KEYS = 'contest_notified';

function getNotified(): Set<number> {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEYS);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function markNotified(id: number) {
  const set = getNotified();
  set.add(id);
  localStorage.setItem(NOTIFIED_KEYS, JSON.stringify([...set]));
}

export function useContestNotifications() {
  const { user } = useAuthStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) return;

    // 请求通知权限
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const checkContests = async () => {
      try {
        const data = await api.getContests({ status: 'upcoming', pageSize: 10 });
        const now = Date.now();

        for (const contest of (data.contests || [])) {
          const startTime = parseContestTimeToMs(contest.start_time);
          const diff = startTime - now;
          const notified = getNotified();

          // 已通知过则跳过
          if (notified.has(contest.id)) continue;

          // 比赛即将开始（5分钟内）
          if (diff > 0 && diff <= 5 * 60 * 1000) {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(t('contests.notificationStarting'), {
                body: t('contests.notificationStartingBody')
                  .replace('{0}', contest.title)
                  .replace('{1}', String(Math.ceil(diff / 60000))),
                icon: '/favicon.svg',
              });
              markNotified(contest.id);
            }
          }

          // 比赛已经开始
          if (diff <= 0) {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(t('contests.notificationStarted'), {
                body: t('contests.notificationStartedBody').replace('{0}', contest.title),
                icon: '/favicon.svg',
              });
              markNotified(contest.id);
            }
          }
        }
      } catch {
        // 忽略错误
      }
    };

    // 首次检查
    checkContests();

    // 每分钟检查一次
    timerRef.current = setInterval(checkContests, 60000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [user]);
}

export default useContestNotifications;