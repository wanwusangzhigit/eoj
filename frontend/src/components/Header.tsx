import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { useSettingsStore } from '../store/settings';
import { t } from '../i18n';
import { api } from '../api/client';
import { useSiteConfig } from '../hooks/useSiteConfig';
import {
  LogOut, User, Shield, Code2, ListChecks, Trophy, Target, Heart,
  Menu, X, Sun, Moon, Swords, Ticket, BookOpen, MessageSquare, Home,
  FolderOpen, Bot, GraduationCap, Users, PenSquare, Mail, Search,
  FileText, MessageCircle, ExternalLink,
} from 'lucide-react';
import NotificationBell from './NotificationBell';
import { usePermissions } from '../hooks/usePermissions';
import './Header.css';

interface HeaderProps {
  onMenuClick?: () => void;
  unreadMsg?: number;
}

interface SearchSuggestion {
  type: 'problem' | 'user' | 'blog' | 'discussion';
  id: number;
  title: string;
  subtitle: string;
  url: string;
  avatar_url?: string;
}

// ── Search suggestion icon helper ──
function SuggestionIcon({ type }: { type: string }) {
  switch (type) {
    case 'problem': return <FileText size={14} />;
    case 'user': return <User size={14} />;
    case 'blog': return <PenSquare size={14} />;
    case 'discussion': return <MessageCircle size={14} />;
    default: return <Search size={14} />;
  }
}

export default function Header({ onMenuClick, unreadMsg = 0 }: HeaderProps) {
  const { user, logout } = useAuthStore();
  const perms = usePermissions();
  const config = useSiteConfig();
  const { theme, toggleTheme } = useThemeStore();
  const getImageUploadEnabled = useSettingsStore((s) => s.getImageUploadEnabled);
  const getUploadEnabled = useSettingsStore((s) => s.getUploadEnabled);
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isLuogu = config.site.theme === 'luogu';
  const isHydro = config.site.theme === 'hydro';
  const headerStyleClass = isHydro ? 'header-hydro' : 'header-default';

  const showMyFiles = user && (getImageUploadEnabled() || getUploadEnabled() || perms.canManageUploads);
  const getAIEnabled = useSettingsStore((s) => s.getAIEnabled);
  const getAIChatEnabled = useSettingsStore((s) => s.getAIChatEnabled);
  const showAI = user && (getAIEnabled() || perms.hasAllPermissions) && getAIChatEnabled();

  // Poll unread messages count (only for default theme, luogu theme gets it from Layout)
  const [localUnread, setLocalUnread] = useState(0);
  const effectiveUnread = isLuogu ? (unreadMsg || 0) : localUnread;

  // ── Search suggestions ──
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    try {
      const res = await api.searchSuggestions(q);
      setSuggestions(res.suggestions || []);
    } catch { setSuggestions([]); }
  }, []);

  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => fetchSuggestions(value), 250);
  }, [fetchSuggestions]);

  const handleSearchSubmit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed) navigate(`/problems?search=${encodeURIComponent(trimmed)}`);
    setShowSuggestions(false);
    setSearchQuery('');
  };

  const handleSuggestionClick = (url: string) => {
    navigate(url);
    setShowSuggestions(false);
    setSearchQuery('');
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Real-time unread count via SSE, fallback to polling ──
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!user || isLuogu) return;

    // Try SSE first (faster, real-time)
    let sseConnected = false;
    const token = useAuthStore.getState().token;
    if (token) {
      try {
        const es = new EventSource(`/api/v1/notifications/stream?token=${token}`);
        es.addEventListener('notification', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (data.count !== undefined) setLocalUnread(data.count);
          } catch { /* ignore */ }
        });
        es.addEventListener('connected', () => { sseConnected = true; });
        es.onerror = () => { es.close(); };
        sseRef.current = es;
      } catch { /* SSE not supported */ }
    }

    // Fallback polling: if SSE hasn't connected within 3s, start polling
    const fallbackTimer = setTimeout(() => {
      if (sseConnected) return;
      const fetchUnread = async () => {
        try {
          const data = await api.getUnreadMessagesCount();
          setLocalUnread(data.count || 0);
        } catch { /* ignore */ }
      };
      fetchUnread();
      const timer = setInterval(fetchUnread, 30000);
      // Store timer on the ref so cleanup can access it
      (sseRef as any).pollTimer = timer;
    }, 3000);

    return () => {
      clearTimeout(fallbackTimer);
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      if ((sseRef as any).pollTimer) clearInterval((sseRef as any).pollTimer);
    };
  }, [user, isLuogu]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  /* ═══════════════════════════════════════════════════
     Luogu-style header: simplified, hamburger + sidebar
     ═══════════════════════════════════════════════════ */
  if (isLuogu) {
    return (
      <header className="header header-luogu">
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

          <div className="header-search-wrapper" ref={searchRef}>
            <form
              className="header-search"
              onSubmit={(e) => {
                e.preventDefault();
                handleSearchSubmit(searchQuery);
              }}
            >
              <Search size={14} />
              <input
                name="q"
                placeholder={t('common.search')}
                value={searchQuery}
                onChange={(e) => { handleSearchInput(e.target.value); setShowSuggestions(true); }}
                onFocus={() => { if (suggestions.length) setShowSuggestions(true); }}
              />
            </form>
            {showSuggestions && suggestions.length > 0 && (
              <div className="search-suggestions">
                {suggestions.map((s) => (
                  <div key={`${s.type}-${s.id}`} className="search-suggestion-item" onClick={() => handleSuggestionClick(s.url)}>
                    <span className="suggestion-icon"><SuggestionIcon type={s.type} /></span>
                    <span className="suggestion-title">{s.title}</span>
                    <span className="suggestion-subtitle">{s.subtitle}</span>
                    <ExternalLink size={12} className="suggestion-go" />
                  </div>
                ))}
                <div className="search-suggestion-more" onClick={() => handleSearchSubmit(searchQuery)}>
                  <Search size={12} />
                  搜索全部 &quot;{searchQuery}&quot;
                </div>
              </div>
            )}
          </div>

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
                {effectiveUnread > 0 && <span className="header-badge">{effectiveUnread > 99 ? '99+' : effectiveUnread}</span>}
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

  /* ═══════════════════════════════════════════════════
     Default-style header: full horizontal nav
     ═══════════════════════════════════════════════════ */
  return (
    <header className={`header ${headerStyleClass}`}>
      <div className="header-inner">
        <NavLink to="/" className="header-logo">
          {config.site.icon === 'default' ? <Code2 size={24} /> : <img src={config.site.icon} alt={config.site.name} className="header-logo-img" />}
          <span>{config.site.name}</span>
        </NavLink>

        <nav className="header-nav">
          <div className="nav-links">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Home size={16} />{t('nav.home')}
            </NavLink>
            <NavLink to="/problems" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Target size={16} />{t('nav.problems')}
            </NavLink>
            <NavLink to="/contests" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Swords size={16} />{t('nav.contests')}
            </NavLink>
            <NavLink to="/rankings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Trophy size={16} />{t('nav.rankings')}
            </NavLink>
            <NavLink to="/training" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <GraduationCap size={16} />{t('nav.training')}
            </NavLink>
            <NavLink to="/discussions/all" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <MessageSquare size={16} />{t('nav.discussions')}
            </NavLink>
            <NavLink to="/blogs" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <PenSquare size={16} />{t('nav.blogs')}
            </NavLink>
            {user && (
              <NavLink to="/teams" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Users size={16} />{t('nav.teams')}
              </NavLink>
            )}
            {user && (
              <NavLink to="/submissions" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <ListChecks size={16} />{t('nav.submissions')}
              </NavLink>
            )}
            {user && (
              <NavLink to="/favorites" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Heart size={16} />{t('nav.favorites')}
              </NavLink>
            )}
            {showMyFiles && (
              <NavLink to="/my-files" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <FolderOpen size={16} />{t('common.myFiles')}
              </NavLink>
            )}
            {showAI && (
              <NavLink to="/ai" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Bot size={16} />{t('nav.ai')}
              </NavLink>
            )}
            {perms.hasAllPermissions && (
              <NavLink to="/admin/dashboard" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                <Shield size={16} />{t('nav.admin')}
              </NavLink>
            )}
          </div>
        </nav>

        {/* Global Search Bar with Suggestions */}
        <div className="header-search-wrapper" ref={searchRef}>
          <Search size={14} className="header-search-icon" />
          <input
            type="text"
            className="header-search-input"
            placeholder="搜索题目、用户、博客..."
            value={searchQuery}
            onChange={(e) => { handleSearchInput(e.target.value); setShowSuggestions(true); }}
            onFocus={() => { if (suggestions.length) setShowSuggestions(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearchSubmit(searchQuery);
              }
            }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="search-suggestions">
              {suggestions.map((s) => (
                <div key={`${s.type}-${s.id}`} className="search-suggestion-item" onClick={() => handleSuggestionClick(s.url)}>
                  <span className="suggestion-icon"><SuggestionIcon type={s.type} /></span>
                  <span className="suggestion-title">{s.title}</span>
                  <span className="suggestion-subtitle">{s.subtitle}</span>
                  <ExternalLink size={12} className="suggestion-go" />
                </div>
              ))}
              <div className="search-suggestion-more" onClick={() => handleSearchSubmit(searchQuery)}>
                <Search size={12} />
                搜索全部 &quot;{searchQuery}&quot;
              </div>
            </div>
          )}
        </div>

        <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label={mobileMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}>
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <div className="header-actions">
          <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')} aria-label={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {user ? (
            <>
              <Link to="/messages" className="header-msg-btn" title={t('nav.messages')} aria-label={t('nav.messages')}>
                <Mail size={16} />
                {effectiveUnread > 0 && <span className="msg-unread-badge">{effectiveUnread > 99 ? '99+' : effectiveUnread}</span>}
              </Link>
              <NotificationBell />
              <div className="user-menu">
                <Link to="/profile" className="user-info">
                  {user.avatar_url && <img src={user.avatar_url} alt={user.username} className="user-avatar" />}
                  <span className="user-name">{user.username}</span>
                </Link>
                <button className="btn-icon" onClick={handleLogout} title={t('nav.logout')} aria-label={t('nav.logout')}>
                  <LogOut size={16} />
                </button>
              </div>
            </>
          ) : (
            <Link to="/login" className="btn btn-primary btn-sm">
              <User size={14} />
              {t('nav.login')}
            </Link>
          )}
        </div>

        {mobileMenuOpen && (
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
                {effectiveUnread > 0 && <span className="nav-unread-pill">{effectiveUnread > 99 ? '99+' : effectiveUnread}</span>}
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
        )}
      </div>
    </header>
  );
}