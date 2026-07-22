import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { usePermissions } from '../../hooks/usePermissions';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import {
  Users, FileText, Send, TrendingUp, CheckCircle, Swords, BookOpen, Ticket,
  Clock, Activity,
} from 'lucide-react';
import '../Admin.css';

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const perms = usePermissions();
  useDocumentTitle(t('admin.dashboard'));
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const data = await api.getAdminStats();
      setStats(data);
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    }
  };

  if (!user || (!perms.hasAllPermissions && !perms.canManageContests && !perms.canManageProblems && !perms.canManageLists && !perms.canManageTickets && !perms.canManageUploads)) {
    return (
      <div className="empty-page">
        <h2>{t('admin.accessDenied')}</h2>
      </div>
    );
  }

  const submissionRate = stats && stats.submissions > 0
    ? Math.round((stats.accepted / stats.submissions) * 100) : 0;

  return (
    <div className="admin-dashboard">
      <div className="dashboard-header">
        <h1>
          <BarChart3 size={24} />
          {t('admin.dashboard')}
        </h1>
        <span className="dashboard-time">
          <Clock size={14} />
          {new Date().toLocaleString()}
        </span>
      </div>

      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-icon-wrapper blue">
            <Users size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.users ?? '-'}</div>
            <div className="stat-label">{t('admin.totalUsers')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper green">
            <FileText size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.problems ?? '-'}</div>
            <div className="stat-label">{t('admin.totalProblems')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper purple">
            <Send size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.submissions ?? '-'}</div>
            <div className="stat-label">{t('admin.totalSubmissions')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper orange">
            <Activity size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.today_submissions ?? '-'}</div>
            <div className="stat-label">{t('admin.todaySubmissions')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper green">
            <CheckCircle size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{submissionRate}%</div>
            <div className="stat-label">{t('admin.acceptRate')}</div>
            <div className="stat-bar">
              <div className="stat-bar-fill" style={{ width: `${submissionRate}%` }} />
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper blue">
            <Swords size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.contests ?? '-'}</div>
            <div className="stat-label">{t('admin.totalContests')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper purple">
            <BookOpen size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.lists ?? '-'}</div>
            <div className="stat-label">{t('admin.totalLists')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper orange">
            <Ticket size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.open_tickets ?? '-'}</div>
            <div className="stat-label">{t('admin.openTickets')}</div>
          </div>
        </div>
      </div>

      {stats?.recent_submissions && stats.recent_submissions.length > 0 && (
        <div className="admin-recent-section">
          <h2 className="admin-section-title">
            <Send size={18} />
            {t('admin.recentSubmissions')}
          </h2>
          <div className="admin-table-container">
            <div className="pm-table-header">
              <span className="pm-col pm-col-id">{t('common.id')}</span>
              <span className="pm-col pm-col-title">{t('admin.problemTitle')}</span>
              <span className="pm-col" style={{width:'100px'}}>{t('common.admin')}</span>
              <span className="pm-col" style={{width:'80px'}}>{t('admin.status')}</span>
              <span className="pm-col" style={{width:'80px'}}>{t('admin.language')}</span>
              <span className="pm-col" style={{width:'140px'}}>{t('admin.time')}</span>
            </div>
            {stats.recent_submissions.map((s: any) => (
              <a key={s.id} href={`/submissions/${s.id}`} className="pm-table-row" style={{textDecoration:'none',color:'inherit'}}>
                <span className="pm-col pm-col-id">{s.id}</span>
                <span className="pm-col pm-col-title">{s.title}</span>
                <span className="pm-col" style={{width:'100px',fontSize:'12px'}}>{s.username}</span>
                <span className="pm-col" style={{width:'80px'}}>
                  <span className={`badge ${s.status === 'accepted' ? 'badge-success' : s.status === 'pending' || s.status === 'judging' ? 'badge-info' : 'badge-error'}`}>
                    {s.status === 'accepted' ? 'AC' : s.status}
                  </span>
                </span>
                <span className="pm-col" style={{width:'80px',fontSize:'12px'}}>{s.language}</span>
                <span className="pm-col" style={{width:'140px',fontSize:'12px',color:'var(--text-secondary)'}}>
                  {new Date(s.created_at).toLocaleString()}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
