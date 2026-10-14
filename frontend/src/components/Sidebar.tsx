import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useSettingsStore } from '../store/settings';
import { t } from '../i18n';
import {
  Home, Target, Swords, Trophy, BookOpen, GraduationCap,
  MessageSquare, PenSquare, Users, Mail, ListChecks,
  Ticket, Heart, FolderOpen, Bot, Shield, X, Megaphone,
  Code2, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { useSiteConfig } from '../hooks/useSiteConfig';
import './Sidebar.css';

const SIDEBAR_COLLAPSED_KEY = 'aurora.sidebar.collapsed';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  unreadMsg: number;
}

export default function Sidebar({ open, onClose, unreadMsg }: SidebarProps) {
  const { user } = useAuthStore();
  const perms = usePermissions();
  const config = useSiteConfig();
  const isAurora = config.site.theme === 'aurora';
  // 折叠状态挂载后再读 localStorage,避免 SSR 与客户端首帧不一致
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!isAurora) return;
    try {
      // 挂载后再读折叠偏好(首帧保持展开),避免 SSR 与客户端首渲染不一致
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') setCollapsed(true);
    } catch { /* ignore */ }
  }, [isAurora]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch { /* ignore */ }
      return next;
    });
  };

  const getImageUploadEnabled = useSettingsStore((s) => s.getImageUploadEnabled);
  const getUploadEnabled = useSettingsStore((s) => s.getUploadEnabled);
  const showMyFiles = user && (getImageUploadEnabled() || getUploadEnabled() || perms.canManageUploads);

  const getAIEnabled = useSettingsStore((s) => s.getAIEnabled);
  const getAIChatEnabled = useSettingsStore((s) => s.getAIChatEnabled);
  const showAI = user && (getAIEnabled() || perms.hasAllPermissions) && getAIChatEnabled();

  const mainNav = [
    { to: '/', icon: Home, label: t('nav.home'), end: true },
    { to: '/problems', icon: Target, label: t('nav.problems') },
    { to: '/matches', icon: Swords, label: t('nav.contests') },
    { to: '/rankings', icon: Trophy, label: t('nav.rankings') },
    { to: '/lists', icon: BookOpen, label: t('nav.lists') },
    { to: '/training', icon: GraduationCap, label: t('nav.training') },
    { to: '/discussions', icon: MessageSquare, label: t('nav.discussions') },
    { to: '/blogs', icon: PenSquare, label: t('nav.blogs') },
    { to: '/announcements', icon: Megaphone, label: t('nav.announcements') },
  ];

  const userNav = user ? [
    { to: '/submissions', icon: ListChecks, label: t('nav.submissions') },
    { to: '/teams', icon: Users, label: t('nav.teams') },
    { to: '/messages', icon: Mail, label: t('nav.messages'), badge: unreadMsg },
    { to: '/favorites', icon: Heart, label: t('nav.favorites') },
    { to: '/collections', icon: FolderOpen, label: t('nav.collections') },
    { to: '/tickets', icon: Ticket, label: t('nav.tickets') },
    ...(showMyFiles ? [{ to: '/my-files', icon: FolderOpen, label: t('common.myFiles') }] : []),
    ...(showAI ? [{ to: '/ai', icon: Bot, label: t('nav.ai') }] : []),
  ] : [];

  // 仪表盘对所有拥有任一管理权限的用户开放(与 AdminLayout 入口判定一致),
  // 而非仅限 admin / super_admin。这样仅拥有题目、工单等单项权限的用户
  // 也能从主侧边栏看到并进入管理后台仪表盘。
  const hasAnyAdminPermission =
    perms.hasAllPermissions ||
    perms.canManageContests ||
    perms.canManageProblems ||
    perms.canManageLists ||
    perms.canManageTickets ||
    perms.canManageUploads;

  const adminNav = hasAnyAdminPermission
    ? [{ to: '/admin/dashboard', icon: Shield, label: t('nav.admin') }]
    : [];

  const renderLink = (item: { to: string; icon: LucideIcon; label: string; end?: boolean; badge?: number }, onNavigate?: () => void) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}
        onClick={onNavigate}
        title={isAurora && collapsed ? item.label : undefined}
      >
        <Icon size={16} />
        <span className="sidebar-link-label">{item.label}</span>
        {item.badge !== undefined && item.badge > 0 && (
          <span className="sidebar-badge">{item.badge > 99 ? '99+' : item.badge}</span>
        )}
      </NavLink>
    );
  };

  return (
    <aside className={`sidebar${open ? ' open' : ''}${isAurora && collapsed ? ' collapsed' : ''}`}>
      {isAurora && (
        <div className="sidebar-brand">
          <NavLink
            to="/"
            className="sidebar-brand-link"
            onClick={onClose}
            title={collapsed ? config.site.name : undefined}
          >
            {config.site.icon === 'default' ? (
              <span className="sidebar-brand-mark"><Code2 size={17} /></span>
            ) : (
              <img src={config.site.icon} alt="" className="sidebar-brand-img" />
            )}
            <span className="sidebar-brand-name">{config.site.name}</span>
          </NavLink>
        </div>
      )}
      <div className="sidebar-header">
        <button className="sidebar-close" onClick={onClose} aria-label={t('nav.closeMenu')}>
          <X size={18} />
        </button>
      </div>
      <nav className="sidebar-nav">
        <div className="sidebar-group">
          {mainNav.map((item) => renderLink(item, onClose))}
        </div>
        {userNav.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t('nav.personal')}</div>
            {userNav.map((item) => renderLink(item, onClose))}
          </div>
        )}
        {adminNav.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t('nav.adminGroup')}</div>
            {adminNav.map((item) => renderLink(item, onClose))}
          </div>
        )}
      </nav>
      {isAurora && (
        <div className="sidebar-footer">
          <button
            className="sidebar-collapse-btn"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            aria-expanded={!collapsed}
            title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
      )}
    </aside>
  );
}
