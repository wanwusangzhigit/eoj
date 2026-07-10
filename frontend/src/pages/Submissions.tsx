import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { Filter, Inbox, Search, LogIn, AlertCircle } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './Submissions.css';

export default function Submissions() {
  const { user } = useAuthStore();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({});
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [debouncedUserId, setDebouncedUserId] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useDocumentTitle(t('submissions.title'));

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  // Debounce user search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { setDebouncedUserId(userIdFilter); }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [userIdFilter]);

  useEffect(() => {
    if (user) fetchSubmissions();
  }, [user, page, statusFilter, languageFilter, debouncedUserId]);

  // Auto-refresh when there are pending/running submissions
  useEffect(() => {
    if (!user || loading) return;
    const hasPending = submissions.some(s => s.status === 'pending' || s.status === 'running');
    if (!hasPending) return;
    const timer = setInterval(() => {
      fetchSubmissions();
    }, 3000);
    return () => clearInterval(timer);
  }, [user, submissions, loading]);

  const fetchSubmissions = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getSubmissions({
        page,
        pageSize: 20,
        status: statusFilter || undefined,
        language: languageFilter || undefined,
        user_id: isAdmin && debouncedUserId ? debouncedUserId : undefined,
      });
      setSubmissions(data.submissions);
      setPagination(data.pagination);
    } catch (e) {
      console.error('Failed to fetch submissions:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="empty-page">
        <LogIn size={48} className="empty-icon" />
        <h2>{t('submissions.pleaseLogin')}</h2>
        <p className="empty-desc">{t('submissions.pleaseLoginDesc')}</p>
        <Link to="/login" className="btn btn-primary">
          {t('login.login')}
        </Link>
      </div>
    );
  }

  return (
    <div className="submissions-page">
      <div className="page-header">
        <h1>{t('submissions.title')}</h1>
        <div className="filter-bar">
          <Filter size={14} />
          {isAdmin && (
            <div className="user-search-input">
              <Search size={14} />
              <input
                type="text"
                placeholder={t('submissions.searchUser')}
                name="user_search"
                autoComplete="off"
                value={userIdFilter}
                onChange={(e) => { setUserIdFilter(e.target.value); setPage(1); }}
              />
            </div>
          )}
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">{t('submissions.allStatus')}</option>
            <option value="accepted">{t('status.accepted')}</option>
            <option value="wrong_answer">{t('status.wrong_answer')}</option>
            <option value="time_limit_exceeded">{t('status.time_limit_exceeded')}</option>
            <option value="memory_limit_exceeded">{t('status.memory_limit_exceeded')}</option>
            <option value="runtime_error">{t('status.runtime_error')}</option>
            <option value="compile_error">{t('status.compile_error')}</option>
            <option value="system_error">{t('status.system_error')}</option>
            <option value="pending">{t('status.pending')}</option>
            <option value="running">{t('status.running')}</option>
          </select>
          <select
            className="filter-select"
            value={languageFilter}
            onChange={(e) => { setLanguageFilter(e.target.value); setPage(1); }}
          >
            <option value="">{t('submissions.allLanguages')}</option>
            <option value="cpp">C++</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="javascript">JavaScript</option>
          </select>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message={t('submissions.loadingSubmissions')} />
      ) : loadError ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchSubmissions}>{t('common.retry')}</button>
        </div>
      ) : submissions.length === 0 ? (
        <EmptyState icon={Inbox} title={t('submissions.noSubmissions')} description={t('submissions.noSubmissionsDesc')} />
      ) : (
        <div className="submissions-table">
          <div className="submissions-table-header">
            <span className="col-id">#</span>
            {isAdmin && <span className="col-user">{t('submissions.user')}</span>}
            <span className="col-problem">{t('submissions.problem')}</span>
            <span className="col-lang">{t('submissions.language')}</span>
            <span className="col-status">{t('submissions.status')}</span>
            <span className="col-score">{t('submissions.score')}</span>
            <span className="col-time">{t('submissions.time')}</span>
            <span className="col-memory">{t('submissions.memory')}</span>
            <span className="col-date">{t('submissions.date')}</span>
          </div>
          {submissions.map((sub) => (
            <Link key={sub.id} to={`/submissions/${sub.id}`} className="submission-row">
              <span className="col-id">{sub.id}</span>
              {isAdmin && <span className="col-user">{sub.username}</span>}
              <span className="col-problem">{sub.problem_title}</span>
              <span className="col-lang">{sub.language}</span>
              <span className="col-status">
                <StatusBadge status={sub.status} />
              </span>
              <span className="col-score">{sub.score || '-'}</span>
              <span className="col-time">{sub.time_used ? `${sub.time_used}ms` : '-'}</span>
              <span className="col-memory">{sub.memory_used ? `${sub.memory_used}KB` : '-'}</span>
              <span className="col-date">{new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(sub.created_at))}</span>
            </Link>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('common.previous')}
          </button>
          <span className="page-info">{t('common.page').replace('{0}', String(page)).replace('{1}', String(pagination.totalPages))}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  );
}
