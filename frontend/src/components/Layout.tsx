import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from './Header';
import Toast from './Toast';
import { useThemeStore } from '../store/theme';
import { useSettingsStore } from '../store/settings';
import { useSiteConfig } from '../hooks/useSiteConfig';
import { t } from '../i18n';
import './Layout.css';

// 页脚内置的站内链接（独立于 site-config 中的外部 links）
const FOOTER_INTERNAL_LINKS = [
  { to: '/privacy', label: 'privacy.title' },
  { to: '/terms', label: 'terms.title' },
  { to: '/contact', label: 'contact.title' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { theme } = useThemeStore();
  const config = useSiteConfig();
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return (
    <div className="layout">
      <Header />
      <main className="main-content">
        {children}
      </main>
      {config.footer.enabled && (
        <footer className="site-footer">
          <div className="footer-inner">
            {config.footer.text && (
              <div className="footer-text" dangerouslySetInnerHTML={{ __html: config.footer.text }} />
            )}
            {!config.footer.text && (
              <div className="footer-text">
                &copy; {new Date().getFullYear()} {config.site.name}
              </div>
            )}
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
      )}
      <Toast />
    </div>
  );
}
