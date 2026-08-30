import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { Heart, Clock, MemoryStick, AlertCircle } from 'lucide-react';
import { DIFFICULTY_COLORS } from '../constants';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './Favorites.css';

export default function Favorites() {
  const { user } = useAuthStore();
  const [problems, setProblems] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  useDocumentTitle(t('favorites.title'));

  const fetchFavorites = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getFavorites({ page, pageSize: 20 });
      setProblems(data.problems);
      setPagination(data.pagination || { totalPages: 1, total: data.problems.length });
    } catch (e) {
      console.error('Failed to fetch favorites:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFavorites();
    }
  }, [user, fetchFavorites]);

  if (!user) {
    return (
      <div className="empty-page">
        <h2>{t('favorites.pleaseLogin')}</h2>
        <Link to="/login" className="btn btn-primary">
          {t('login.login')}
        </Link>
      </div>
    );
  }

  return (
    <div className="favorites-page">
      <div className="page-header">
        <h1><Heart size={24} className="header-icon" /> {t('favorites.title')}</h1>
      </div>

      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>{t('favorites.loadingFavorites')}</p>
        </div>
      ) : loadError ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchFavorites}>{t('common.retry')}</button>
        </div>
      ) : problems.length === 0 ? (
        <div className="empty-state">
          <Heart size={48} className="empty-icon" />
          <p>{t('favorites.noFavorites')}</p>
          <Link to="/" className="btn btn-primary btn-sm">
            {t('favorites.browseProblems')}
          </Link>
        </div>
      ) : (
        <div className="favorites-table">
          <div className="favorites-table-header">
            <span className="col-id">#</span>
            <span className="col-title">{t('problemList.titleCol')}</span>
            <span className="col-difficulty">{t('problemList.difficulty')}</span>
            <span className="col-tags">{t('problemList.tags')}</span>
            <span className="col-limit">{t('problemList.limits')}</span>
          </div>
          {problems.map((problem) => (
            <Link
              key={problem.id}
              to={`/problems/${problem.slug}`}
              className="favorite-row"
            >
              <span className="col-id">{problem.id}</span>
              <span className="col-title">{problem.title}</span>
              <span
                className="col-difficulty"
                style={{ color: DIFFICULTY_COLORS[problem.difficulty] }}
              >
                {problem.difficulty}
              </span>
              <span className="col-tags">
                {(() => {
                  try {
                    return JSON.parse(problem.tags || '[]').map((t: string) => (
                      <span key={t} className="tag-chip small">{t}</span>
                    ));
                  } catch {
                    return null;
                  }
                })()}
              </span>
              <span className="col-limit">
                <span className="limit-item">
                  <Clock size={12} /> {problem.time_limit}ms
                </span>
                <span className="limit-item">
                  <MemoryStick size={12} /> {problem.memory_limit}MB
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="pagination">
          <button
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('common.previous')}
          </button>
          <span className="page-info">
            {t('common.page').replace('{0}', String(page)).replace('{1}', String(pagination.totalPages))}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  );
}
