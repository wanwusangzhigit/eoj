import { useState, useEffect } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { useSettingsStore } from '../store/settings';
import { t } from '../i18n';
import { api } from '../api/client';
import { LogOut, User, Shield, Code2, ListChecks, Trophy, Target, Heart, Menu, X, Sun, Moon, Swords, Ticket, BookOpen, MessageSquare, Home, FolderOpen, Bot, GraduationCap, Users, PenSquare, Mail } from 'lucide-react';
import NotificationBell from './NotificationBell';
import { usePermissions } from '../hooks/usePermissions';
import { useSiteConfig } from '../hooks/useSiteConfig';
import './Header.css';
export default function Header() {
  const { user, logout } = useAuthStore();
  const perms = usePermissions();
  const config = useSiteConfig();
  const { theme, toggleTheme } = useThemeStore();
  const getImageUploadEnabled = useSettingsStore((s) => s.getImageUploadEnabled);
  const getUploadEnabled = useSettingsStore((s) => s.getUploadEnabled);
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadMsg, setUnreadMsg] = useState(0);

  const showMyFiles = user && (getImageUploadEnabled() || getUploadEnabled() || perms.canManageUploads);

  const getAIEnabled = useSettingsStore((s) => s.getAIEnabled);
  const getAIChatEnabled = useSettingsStore((s) => s.getAIChatEnabled);
  const showAI = user && (getAIEnabled() || perms.hasAllPermissions) && getAIChatEnabled();

  // Poll unread messages count
  useEffect(() => {
    if (!user) return;
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

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <header className="header">
      <div className="header-inner">
        <NavLink to="/" className="header-logo">
          {config.site.icon === 'default' ? <Code2 size={24} /> : <img src={config.site.icon} alt={config.site.name} className="header-logo-img" />}
          <span>{config.site.name}</span>
        </NavLink>

        <nav className="header-nav">
          <div className="nav-links">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Home size={16} />
              {t('nav.home')}
            </NavLink>
            <NavLink to="/problems" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Target size={16} />
              {t('nav.problems')}
            </NavLink>
            <NavLink to="/contests" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Swords size={16} />
              {t('nav.contests')}
            </NavLink>
            <NavLink to="/rankings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Trophy size={16} />
              {t('nav.rankings')}
            </NavLink>
            <NavLink to="/lists" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <BookOpen size={16} />
              {t('nav.lists')}
            </NavLink>
            <NavLink to="/training" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <GraduationCap size={16} />
              {t('nav.training')}
            </NavLink>
            <NavLink to="/discussions/all" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <MessageSquare size={16} />
              {t('nav.discussions')}
            </NavLink>
            <NavLink to="/blogs" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <PenSquare size={16} />
              {t('nav.blogs')}
            </NavLink>
            {user && (
              <NavLink to="/teams" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Users size={16} />
                {t('nav.teams')}
              </NavLink>
            )}
            {user && (
              <NavLink to="/messages" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Mail size={16} />
                {t('nav.messages')}
                {unreadMsg > 0 && <span className="nav-unread-pill">{unreadMsg > 99 ? '99+' : unreadMsg}</span>}
              </NavLink>
            )}
            {user && (
              <NavLink to="/submissions" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <ListChecks size={16} />
                {t('nav.submissions')}
              </NavLink>
            )}
            {user && (
              <NavLink to="/tickets" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Ticket size={16} />
                {t('nav.tickets')}
              </NavLink>
            )}
            {user && (
              <NavLink to="/favorites" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Heart size={16} />
                {t('nav.favorites')}
              </NavLink>
            )}
            {showMyFiles && (
              <NavLink to="/my-files" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <FolderOpen size={16} />
                {t('common.myFiles')}
              </NavLink>
            )}
            {showAI && (
              <NavLink to="/ai" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Bot size={16} />
                {t('nav.ai')}
              </NavLink>
            )}
            {perms.hasAllPermissions && (
              <NavLink to="/admin/dashboard" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Shield size={16} />
                {t('nav.admin')}
              </NavLink>
            )}
          </div>
        </nav>

        <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label={mobileMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}>
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {mobileMenuOpen ? (
          <div className="mobile-nav">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
              <Home size={16} /> {t('nav.home')}
            </NavLink>
            <NavLink to="/problems" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
              <Target size={16} /> {t('nav.problems')}
            </NavLink>
            <NavLink to="/contests" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
              <Swords size={16} /> {t('nav.contests')}
            </NavLink>
            <NavLink to="/rankings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
              <Trophy size={16} /> {t('nav.rankings')}
            </NavLink>
            <NavLink to="/lists" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
              <BookOpen size={16} /> {t('nav.lists')}
            </NavLink>
            <NavLink to="/training" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
              <GraduationCap size={16} /> {t('nav.training')}
            </NavLink>
            <NavLink to="/discussions/all" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
              <MessageSquare size={16} /> {t('nav.discussions')}
            </NavLink>
            <NavLink to="/blogs" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
              <PenSquare size={16} /> {t('nav.blogs')}
            </NavLink>
            {user && (
              <NavLink to="/teams" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
                <Users size={16} /> {t('nav.teams')}
              </NavLink>
            )}
            {user && (
              <NavLink to="/messages" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
                <Mail size={16} /> {t('nav.messages')}
                {unreadMsg > 0 && <span className="nav-unread-pill">{unreadMsg > 99 ? '99+' : unreadMsg}</span>}
              </NavLink>
            )}
            {user && (
              <NavLink to="/submissions" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
                <ListChecks size={16} /> {t('nav.submissions')}
              </NavLink>
            )}
            {user && (
              <NavLink to="/tickets" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
                <Ticket size={16} /> {t('nav.tickets')}
              </NavLink>
            )}
            {user && (
              <NavLink to="/favorites" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
                <Heart size={16} /> {t('nav.favorites')}
              </NavLink>
            )}
            {showMyFiles && (
              <NavLink to="/my-files" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
                <FolderOpen size={16} /> {t('common.myFiles')}
              </NavLink>
            )}
            {showAI && (
              <NavLink to="/ai" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
                <Bot size={16} /> {t('nav.ai')}
              </NavLink>
            )}
            {perms.hasAllPermissions && (
              <NavLink to="/admin/dashboard" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={() => setMobileMenuOpen(false)}>
                <Shield size={16} /> {t('nav.admin')}
              </NavLink>
            )}
          </div>
        ) : null}

        <div className="header-actions">
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
            aria-label={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {user && (
            <Link to="/messages" className="header-msg-btn" title={t('nav.messages')} aria-label={t('nav.messages')}>
              <Mail size={18} />
              {unreadMsg > 0 && <span className="msg-unread-badge">{unreadMsg > 99 ? '99+' : unreadMsg}</span>}
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
              <button className="btn-icon" onClick={handleLogout} title={t('nav.logout')} aria-label={t('nav.logout')}>
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn btn-primary btn-sm">
              <User size={16} />
              {t('nav.login')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
