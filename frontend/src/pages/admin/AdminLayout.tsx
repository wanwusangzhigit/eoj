import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { usePermissions } from '../../hooks/usePermissions';
import { t } from '../../i18n';
import {
  BarChart3, Plus, FileText, ClipboardList, Users, Swords,
  Ticket, BookOpen, Megaphone, Settings, Bot, FolderOpen,
  Database, Menu, X, FileSearch, ShieldBan, GraduationCap, ShieldAlert,
  FileCheck, Flag, PenSquare, Mail, Newspaper,
} from 'lucide-react';
import '../Admin.css';

interface SidebarLink {
  to: string;
  icon: React.ReactNode;
  label: string;
  permission: 'all' | 'contest_admin' | 'problem_admin' | 'ticket_admin' | 'list_admin' | 'upload_admin' | 'super_admin';
}

const sidebarLinks: SidebarLink[] = [
  { to: 'dashboard', icon: <BarChart3 size={18} />, label: t('admin.dashboard'), permission: 'all' },
  { to: 'create-problem', icon: <Plus size={18} />, label: t('admin.createProblem'), permission: 'problem_admin' },
  { to: 'problems', icon: <FileText size={18} />, label: t('admin.problemManagement'), permission: 'problem_admin' },
  { to: 'testcases', icon: <ClipboardList size={18} />, label: t('admin.addTestcases'), permission: 'problem_admin' },
  { to: 'users', icon: <Users size={18} />, label: t('admin.userManagement'), permission: 'all' },
  { to: 'contests', icon: <Swords size={18} />, label: t('admin.contestManagement'), permission: 'contest_admin' },
  { to: 'tickets', icon: <Ticket size={18} />, label: t('admin.ticketManagement'), permission: 'ticket_admin' },
  { to: 'lists', icon: <BookOpen size={18} />, label: t('admin.listManagement'), permission: 'list_admin' },
  { to: 'training', icon: <GraduationCap size={18} />, label: t('training.title'), permission: 'list_admin' },
  { to: 'blogs', icon: <PenSquare size={18} />, label: t('admin.blogManagement'), permission: 'super_admin' },
  { to: 'teams', icon: <Users size={18} />, label: t('admin.teamManagement'), permission: 'super_admin' },
  { to: 'messages', icon: <Mail size={18} />, label: t('admin.messageManagement'), permission: 'super_admin' },
  { to: 'plagiarism', icon: <ShieldAlert size={18} />, label: t('plagiarism.title'), permission: 'contest_admin' },
  { to: 'solution-review', icon: <FileCheck size={18} />, label: t('review.title'), permission: 'problem_admin' },
  { to: 'reports', icon: <Flag size={18} />, label: t('reports.title'), permission: 'problem_admin' },
  { to: 'announcement', icon: <Megaphone size={18} />, label: t('admin.announcementManagement'), permission: 'super_admin' },
  { to: 'ads', icon: <Newspaper size={18} />, label: t('admin.adsManagement'), permission: 'super_admin' },
  { to: 'settings', icon: <Settings size={18} />, label: t('admin.siteSettings'), permission: 'super_admin' },
  { to: 'models', icon: <Bot size={18} />, label: t('admin.aiModels'), permission: 'super_admin' },
  { to: 'uploads', icon: <FolderOpen size={18} />, label: t('admin.uploadManagement'), permission: 'upload_admin' },
  { to: 'sql', icon: <Database size={18} />, label: t('admin.sqlEditor'), permission: 'super_admin' },
  { to: 'audit-logs', icon: <FileSearch size={18} />, label: t('admin.auditLogs'), permission: 'super_admin' },
  { to: 'bans', icon: <ShieldBan size={18} />, label: t('admin.banManagement'), permission: 'super_admin' },
];

export default function AdminLayout() {
  const { user } = useAuthStore();
  const perms = usePermissions();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!user || (!perms.hasAllPermissions && !perms.canManageContests && !perms.canManageProblems && !perms.canManageLists && !perms.canManageTickets && !perms.canManageUploads)) {
    return (
      <div className="empty-page">
        <h2>{t('admin.accessDenied')}</h2>
      </div>
    );
  }

  const canSeeLink = (link: SidebarLink) => {
    if (link.permission === 'all') {
      // Dashboard always visible to any admin; users only to hasAllPermissions
      if (link.to === 'users') return perms.hasAllPermissions;
      return true;
    }
    if (link.permission === 'super_admin') return perms.hasAllPermissions;
    if (link.permission === 'contest_admin') return perms.canManageContests;
    if (link.permission === 'problem_admin') return perms.canManageProblems;
    if (link.permission === 'ticket_admin') return perms.canManageTickets;
    if (link.permission === 'list_admin') return perms.canManageLists;
    if (link.permission === 'upload_admin') return perms.canManageUploads;
    return false;
  };

  const visibleLinks = sidebarLinks.filter(canSeeLink);

  return (
    <div className="admin-layout">
      <button
        className="admin-sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      <aside className={`admin-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="admin-sidebar-inner">
          <div className="admin-sidebar-title">{t('admin.title')}</div>
          {visibleLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end
              className={({ isActive }) => `admin-sidebar-link${isActive ? ' active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              {link.icon}
              {link.label}
            </NavLink>
          ))}
        </div>
      </aside>
      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
