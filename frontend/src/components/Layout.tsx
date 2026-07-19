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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

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

  return (
    <div className="layout">
      <Header
        onMenuClick={() => setSidebarOpen((v) => !v)}
        unreadMsg={unreadMsg}
      />
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
    </div>
  );
}
