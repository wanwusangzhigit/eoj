import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { api } from '../api/client';
import { t } from '../i18n';
import { useAuthStore } from '../store/auth';
import './NotificationBell.css';

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [recent, setRecent] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) return;
    fetchUnread();
    const timer = setInterval(fetchUnread, 30000);
    return () => clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (!open) return;
    fetchRecent();
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchUnread = async () => {
    try {
      const data = await api.getUnreadNotificationsCount();
      setUnread(data.count);
    } catch { /* ignore */ }
  };

  const fetchRecent = async () => {
    try {
      const data = await api.getNotifications({ pageSize: 5 });
      setRecent(data.notifications);
    } catch { /* ignore */ }
  };

  const handleBellClick = () => {
    setOpen((prev) => !prev);
  };

  const handleMarkAllRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.markAllNotificationsRead();
      setUnread(0);
      if (open) await fetchRecent();
    } catch { /* ignore */ }
  };

  const handleItemClick = async (n: any, e: React.MouseEvent) => {
    e.preventDefault();
    if (!n.is_read) {
      try {
        await api.markNotificationRead(n.id);
      } catch { /* ignore */ }
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

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

  return (
    <div className="notification-bell" ref={dropdownRef}>
      <button className="bell-button" onClick={handleBellClick} aria-label="Notifications">
        <Bell size={18} />
        {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-dropdown">
          <div className="bell-dropdown-header">
            <span>{t('notifications.title')}</span>
            {unread > 0 && (
              <button className="btn-text-sm" onClick={handleMarkAllRead}>
                <CheckCheck size={14} /> {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          <div className="bell-dropdown-body">
            {recent.length === 0 ? (
              <div className="bell-empty">{t('notifications.noNotifications')}</div>
            ) : (
              recent.map((n) => (
                <a
                  key={n.id}
                  href={n.link || '#'}
                  onClick={(e) => handleItemClick(n, e)}
                  className={`bell-item ${n.is_read ? 'read' : 'unread'}`}
                >
                  <span className="type-dot" style={{ background: typeColor(n.type) }} />
                  <div className="bell-item-content">
                    <div className="bell-item-title">{n.title}</div>
                    {n.content && <div className="bell-item-desc">{n.content}</div>}
                    <div className="bell-item-time">{new Date(n.created_at).toLocaleString()}</div>
                  </div>
                  {!n.is_read && <Check size={14} className="read-indicator" />}
                </a>
              ))
            )}
          </div>
          <div className="bell-dropdown-footer">
            <Link to="/notifications" onClick={() => setOpen(false)}>
              {t('notifications.viewAll')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
