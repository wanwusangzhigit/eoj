import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { usePermissions } from '../../hooks/usePermissions';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import {
  Users, FileText, Send, CheckCircle, Swords, BookOpen, Ticket,
  Clock, Activity, BarChart3, TrendingUp, Code2,
} from 'lucide-react';
import '../Admin.css';

function DailyTrendChart({ data }: { data: { day: string; count: number; accepted: number }[] }) {
  if (!data || data.length === 0) return null;
  const maxVal = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="chart-section">
      <h2 className="admin-section-title">
        <TrendingUp size={18} />
        近7日提交趋势
      </h2>
      <div className="bar-chart">
        {data.map((d) => {
          const totalH = (d.count / maxVal) * 100;
          const acH = (d.accepted / maxVal) * 100;
          const label = d.day.slice(5); // MM-DD
          return (
            <div key={d.day} className="bar-column">
              <div className="bar-value">{d.count}</div>
              <div className="bar-stack">
                <div className="bar-fill bar-accepted" style={{ height: `${Math.max(acH, 1)}%` }} title={`AC: ${d.accepted}`} />
                <div className="bar-fill bar-total" style={{ height: `${Math.max(totalH - acH, 0)}%` }} title={`Total: ${d.count}`} />
              </div>
              <div className="bar-label">{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LangDistChart({ data }: { data: { language: string; count: number }[] }) {
  if (!data || data.length === 0) return null;
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  return (
    <div className="chart-section">
      <h2 className="admin-section-title">
        <Code2 size={18} />
        语言分布
      </h2>
      <div className="lang-dist">
        {data.map((d, i) => (
          <div key={d.language} className="lang-row">
            <span className="lang-name">{d.language}</span>
            <div className="lang-bar-track">
              <div className="lang-bar-fill" style={{ width: `${(d.count / total) * 100}%`, background: COLORS[i % COLORS.length] }} />
            </div>
            <span className="lang-count">{d.count}</span>
            <span className="lang-pct">{Math.round((d.count / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegistrationTrendChart({ data }: { data: { day: string; count: number }[] }) {
  if (!data || data.length === 0) return null;
  const maxVal = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="chart-section">
      <h2 className="admin-section-title">
        <Users size={18} />
        近14日注册趋势
      </h2>
      <div className="bar-chart">
        {data.map((d) => (
          <div key={d.day} className="bar-column">
            <div className="bar-value">{d.count}</div>
            <div className="bar-stack">
              <div className="bar-fill bar-accepted" style={{ height: `${Math.max((d.count / maxVal) * 100, 1)}%` }} />
            </div>
            <div className="bar-label">{d.day.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyACChart({ data }: { data: { week: string; count: number; accepted: number }[] }) {
  if (!data || data.length === 0) return null;
  const maxVal = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="chart-section">
      <h2 className="admin-section-title">
        <Activity size={18} />
        近8周提交趋势
      </h2>
      <div className="bar-chart">
        {data.map((d) => {
          const totalH = (d.count / maxVal) * 100;
          const acH = (d.accepted / maxVal) * 100;
          const label = d.week.slice(2); // YY-WW → WW
          return (
            <div key={d.week} className="bar-column">
              <div className="bar-value">{d.count}</div>
              <div className="bar-stack">
                <div className="bar-fill bar-accepted" style={{ height: `${Math.max(acH, 1)}%` }} title={`AC: ${d.accepted}`} />
                <div className="bar-fill bar-total" style={{ height: `${Math.max(totalH - acH, 0)}%` }} title={`Total: ${d.count}`} />
              </div>
              <div className="bar-label">{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActiveUsersChart({ data }: { data: { day: string; count: number }[] }) {
  if (!data || data.length === 0) return null;
  const maxVal = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="chart-section">
      <h2 className="admin-section-title">
        <Users size={18} />
        近14日活跃用户
      </h2>
      <div className="bar-chart">
        {data.map((d) => (
          <div key={d.day} className="bar-column">
            <div className="bar-value">{d.count}</div>
            <div className="bar-stack">
              <div className="bar-fill bar-accepted" style={{ height: `${Math.max((d.count / maxVal) * 100, 1)}%` }} />
            </div>
            <div className="bar-label">{d.day.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const perms = usePermissions();
  useDocumentTitle(t('admin.dashboard'));
  const [stats, setStats] = useState<any>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.getAdminStats();
      setStats(data);
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
  }, [fetchStats]);

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
        <div className="stat-card">
          <div className="stat-icon-wrapper blue">
            <Users size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.active_users_24h ?? '-'}</div>
            <div className="stat-label">{t('admin.activeUsers24h')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper purple">
            <Users size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.active_users_7d ?? '-'}</div>
            <div className="stat-label">{t('admin.activeUsers7d')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper green">
            <Users size={24} />
          </div>
          <div className="stat-info">
            <div className="stat-number">{stats?.active_users_30d ?? '-'}</div>
            <div className="stat-label">{t('admin.activeUsers30d')}</div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="dashboard-charts">
        <DailyTrendChart data={stats?.daily_trend || []} />
        <LangDistChart data={stats?.language_distribution || []} />
        <RegistrationTrendChart data={stats?.registration_trend || []} />
        <WeeklyACChart data={stats?.weekly_trend || []} />
        <ActiveUsersChart data={stats?.active_trend || []} />
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
