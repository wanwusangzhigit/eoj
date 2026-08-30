import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { BookX, ChevronLeft, ChevronRight, RefreshCw, AlertCircle, TrendingUp } from 'lucide-react';
import { DIFFICULTY_COLORS } from '../constants';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { t } from '../i18n';
import './WrongProblems.css';

export default function WrongProblems() {
  const { user } = useAuthStore();
  const [problems, setProblems] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useDocumentTitle(t('wrongProblems.title'));

  const fetchWrong = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getWrongProblems({ page, pageSize: 20 });
      setProblems(data.problems);
      setPagination(data.pagination);
      setError('');
    } catch (e: any) {
      setError(e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchWrong();
  }, [fetchWrong]);

  if (!user) {
    return (
      <div className="wrong-problems-page">
        <div className="empty">
          <AlertCircle size={40} />
          <p>{t('wrongProblems.pleaseLogin')}</p>
          <Link to="/login" className="btn btn-primary btn-sm">{t('login.title')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wrong-problems-page">
      <div className="page-header">
        <h1><BookX size={22} /> {t('wrongProblems.title')}</h1>
        <button className="btn btn-secondary btn-sm" onClick={() => { setPage(1); fetchWrong(); }}>
          <RefreshCw size={14} /> {t('common.refresh')}
        </button>
      </div>

      {error && <div className="error-banner"><span>{error}</span></div>}

      {loading ? (
        <div className="loading-container"><div className="loading-spinner"></div></div>
      ) : problems.length === 0 ? (
        <div className="empty">
          <TrendingUp size={40} />
          <p>{t('wrongProblems.empty')}</p>
        </div>
      ) : (
        <div className="wrong-problem-list">
          {problems.map((p) => (
            <div key={p.id} className="wrong-problem-card">
              <div className="wrong-problem-main">
                <div className="wrong-problem-title">
                  <Link to={`/problems/${p.slug}`}>{p.title}</Link>
                </div>
                <div className="wrong-problem-meta">
                  <span className="difficulty-badge" style={{ color: DIFFICULTY_COLORS[p.difficulty] || undefined, borderColor: DIFFICULTY_COLORS[p.difficulty] || undefined }}>
                    {p.difficulty}
                  </span>
                  <span className="fail-count">
                    <AlertCircle size={12} /> {t('wrongProblems.failTimes').replace('{0}', String(p.fail_count))}
                  </span>
                  {p.last_submitted_at && (
                    <span className="last-time">{new Date(p.last_submitted_at).toLocaleString()}</span>
                  )}
                </div>
              </div>
              <Link to={`/problems/${p.slug}`} className="btn btn-primary btn-sm">
                {t('wrongProblems.redo')}
              </Link>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>{page} / {pagination.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
