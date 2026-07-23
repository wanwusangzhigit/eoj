import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import Toast from './Toast';
import { useThemeStore } from '../store/theme';
import { useSettingsStore } from '../store/settings';
import { useAuthStore } from '../store/auth';
import { useSiteConfig } from '../hooks/useSiteConfig';
import { useContestNotifications } from '../hooks/useContestNotifications';
import { api } from '../api/client';
import { t } from '../i18n';
import './Layout.css';

const FOOTER_INTERNAL_LINKS = [
  { to: '/privacy', label: 'privacy.title' },
  { to: '/terms', label: 'terms.title' },
  { to: '/contact', label: 'contact.title' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { theme } = useThemeStore();
  const config = useSiteConfig();
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const { user } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadMsg, setUnreadMsg] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const isLuogu = config.site.theme === 'luogu';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme-style', config.site.theme);
  }, [theme, config.site.theme]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Poll unread messages (for luogu sidebar + default header)
  useEffect(() => {
    if (!user) {
      setUnreadMsg(0);
      return;
    }
    const fetchUnread = async () => {
      try {
        const data = await api.getUnreadMessagesCount();
        setUnreadMsg(data.count || 0);
      } catch { /* ignore */ }
    };
    fetchUnread();
    const timer = setInterval(fetchUnread, 30000);
    return () => clearInterval(timer);
  }, [user]);

  // Contest notifications
  useContestNotifications();

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        setShowShortcuts(v => !v);
      }
      if (e.key === 'Escape') {
        setShowShortcuts(false);
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="layout">
      <Header
        onMenuClick={() => setSidebarOpen((v) => !v)}
        unreadMsg={unreadMsg}
      />
      {isLuogu ? (
        <div className="layout-body">
          <Sidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            unreadMsg={unreadMsg}
          />
          {sidebarOpen && (
            <div
              className="sidebar-mask"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <main className="main-content">
            {children}
          </main>
        </div>
      ) : (
        <main className="main-content">
          {children}
        </main>
      )}
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-text footer-text-multi">
            <span>
              Build by <a href="https://github.com/wanwusangzhigit/eoj/" target="_blank" rel="noopener noreferrer">EOJ</a>
            </span>
            {config.contact.email && (
              <span>
                Contact: <a href={`mailto:${config.contact.email}`}>{config.contact.email}</a>
              </span>
            )}
            {config.footer.text && (
              <span className="footer-custom-text" dangerouslySetInnerHTML={{ __html: config.footer.text }} />
            )}
            {!config.footer.text && (
              <span>
                &copy; {new Date().getFullYear()} {config.site.name}
              </span>
            )}
          </div>
          <div className="footer-links">
            {FOOTER_INTERNAL_LINKS.map((link) => (
              <Link key={link.to} to={link.to}>
                {t(link.label)}
              </Link>
            ))}
            {config.footer.links.map((link, i) => (
              <a key={i} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.name}
              </a>
            ))}
          </div>
        </div>
      </footer>
      <Toast />

      {/* Keyboard Shortcuts Dialog */}
      {showShortcuts && (
        <div className="modal-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, padding: 20 }}>
            <h3 style={{ marginBottom: 16 }}>⌨️ 键盘快捷键</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <kbd style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 13, fontFamily: 'monospace' }}>?</kbd>
                <span>显示/隐藏快捷键</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <kbd style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 13, fontFamily: 'monospace' }}>Esc</kbd>
                <span>关闭弹窗/侧栏</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  <kbd style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 13, fontFamily: 'monospace' }}>Ctrl</kbd>
                  {' + '}
                  <kbd style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 13, fontFamily: 'monospace' }}>Enter</kbd>
                </span>
                <span>提交代码/表单</span>
              </div>
            </div>
            <button className="btn btn-primary btn-sm" style={{ marginTop: 16, width: '100%' }} onClick={() => setShowShortcuts(false)}>
              我知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}