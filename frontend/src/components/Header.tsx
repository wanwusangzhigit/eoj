import { useNavigate, Link, NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { t } from '../i18n';
import { LogOut, User, Code2, Menu, Sun, Moon, Mail, Search } from 'lucide-react';
import NotificationBell from './NotificationBell';
import { useSiteConfig } from '../hooks/useSiteConfig';
import './Header.css';

interface HeaderProps {
  onMenuClick: () => void;
  unreadMsg: number;
}

export default function Header({ onMenuClick, unreadMsg }: HeaderProps) {
  const { user, logout } = useAuthStore();
  const config = useSiteConfig();
  const { theme, toggleTheme } = useThemeStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <header className="header">
      <div className="header-inner">
        <button
          className="header-menu-btn"
          onClick={onMenuClick}
          aria-label={t('nav.openMenu')}
        >
          <Menu size={20} />
        </button>

        <NavLink to="/" className="header-logo">
          {config.site.icon === 'default' ? <Code2 size={22} /> : <img src={config.site.icon} alt={config.site.name} className="header-logo-img" />}
          <span>{config.site.name}</span>
        </NavLink>

        <form
          className="header-search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = (new FormData(e.currentTarget).get('q') as string || '').trim();
            if (q) navigate(`/problems?search=${encodeURIComponent(q)}`);
          }}
        >
          <Search size={14} />
          <input name="q" placeholder={t('common.search')} />
        </form>

        <div className="header-actions">
          <button
            className="header-action-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
            aria-label={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {user && (
            <Link to="/messages" className="header-action-btn" title={t('nav.messages')} aria-label={t('nav.messages')}>
              <Mail size={16} />
              {unreadMsg > 0 && <span className="header-badge">{unreadMsg > 99 ? '99+' : unreadMsg}</span>}
            </Link>
          )}
          {user && <NotificationBell />}
          {user ? (
            <div className="user-menu">
              <Link to="/profile" className="user-info">
                {user.avatar_url && (
                  <img src={user.avatar_url} alt={user.username} className="user-avatar" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <span className="user-name">{user.username}</span>
              </Link>
              <button className="header-action-btn" onClick={handleLogout} title={t('nav.logout')} aria-label={t('nav.logout')}>
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <Link to="/login" className="header-login-btn">
              <User size={14} />
              {t('nav.login')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
