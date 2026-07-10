import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { Bell, Check, CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToastStore } from '../store/toast';
import './Notifications.css';

const TYPES = ['all', 'mention', 'follow', 'message', 'contest', 'solution_review', 'report', 'system'];

const typeColor = (type: string) => {
  switch (type) {
    case 'mention': return '#6366f1';
    case 'follow': return '#52c41a';
    case 'message': return '#3498db';
    case 'contest': return '#ffc800';
    case 'solution_review': return '#ff7c00';
    case 'report': return '#fe2c55';
    default: return '#888';
  }
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('all');
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  useDocumentTitle(t('notifications.title'));

  useEffect(() => {
    fetchNotifications();
  }, [page, type]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const data = await api.getNotifications({
        page,
        pageSize: 20,
        type: type !== 'all' ? type : undefined,
      });
      setNotifications(data.notifications);
      setPagination(data.pagination);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = async (n: any) => {
    if (!n.is_read) {
      try {
        await api.markNotificationRead(n.id);
        setNotifications((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x))
        );
      } catch { /* ignore */ }
    }
    if (n.link) navigate(n.link);
  };

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: 1 })));
      addToast('success', t('notifications.markAllRead'));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="notifications-page">
      <div className="notifications-header">
        <h1>
          <Bell size={22} />
          {t('notifications.title')}
        </h1>
        <button className="btn btn-secondary btn-sm" onClick={handleMarkAllRead}>
          <CheckCheck size={14} />
          {t('notifications.markAllRead')}
        </button>
      </div>

      <div className="type-tabs">
        {TYPES.map((t_) => (
          <button
            key={t_}
            className={`type-tab ${type === t_ ? 'active' : ''}`}
            onClick={() => { setType(t_); setPage(1); }}
          >
            {t(`notifications.${t_}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : notifications.length === 0 ? (
        <div className="empty-state">
          <Bell size={48} />
          <p>{t('notifications.noNotifications')}</p>
        </div>
      ) : (
        <div className="notifications-list">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`notification-item ${n.is_read ? 'read' : 'unread'}`}
              onClick={() => handleItemClick(n)}
              role="button"
              tabIndex={0}
            >
              <span className="type-dot" style={{ background: typeColor(n.type) }} />
              <div className="notification-content">
                <div className="notification-title">{n.title}</div>
                {n.content && <div className="notification-desc">{n.content}</div>}
                <div className="notification-time">{new Date(n.created_at).toLocaleString()}</div>
              </div>
              {!n.is_read && <Check size={16} className="read-indicator" />}
            </div>
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn-icon-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>{t('common.page').replace('{0}', String(page)).replace('{1}', String(pagination.totalPages))}</span>
          <button className="btn-icon-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
