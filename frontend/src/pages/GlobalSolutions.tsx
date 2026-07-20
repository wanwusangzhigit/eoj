import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ThumbsUp, Eye, BookOpen, Clock, Code, AlertCircle } from 'lucide-react';
import { t } from '../i18n';
import { useToastStore } from '../store/toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './GlobalSolutions.css';

const LANGUAGE_BADGE: Record<string, string> = {
  cpp: 'C++',
  c: 'C',
  python: 'Python',
  java: 'Java',
  javascript: 'JS',
  go: 'Go',
  rust: 'Rust',
  other: 'Other',
};

const SORT_OPTIONS = [
  { value: 'newest' },
  { value: 'popular' },
];

export default function GlobalSolutions() {
  const addToast = useToastStore((s) => s.addToast);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [solutions, setSolutions] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pagination, setPagination] = useState<any>({});
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  useDocumentTitle(t('solutions.title'));

  const fetchSolutions = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = {
        page,
        pageSize: 10,
        sort,
      };
      if (search.trim()) {
        params.problem_title = search.trim();
      }
      const data = await api.getSolutions(params);
      setSolutions(data.solutions || []);
      setPagination(data.pagination || {});
    } catch (e) {
      addToast('error', t('common.loadError'));
      console.error('Failed to fetch solutions:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSolutions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sort, search]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  const formatRelativeTime = (dateStr: string) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t('common.justNow');
    if (minutes < 60) return t('common.minutesAgo').replace('{0}', String(minutes));
    if (hours < 24) return t('common.hoursAgo').replace('{0}', String(hours));
    if (days < 30) return t('common.daysAgo').replace('{0}', String(days));
    return formatDate(dateStr);
  };

  return (
    <div className="global-solutions-page">
      <div className="global-solutions-header">
        <div className="global-solutions-title-section">
          <BookOpen size={28} className="title-icon" />
          <h1>{t('solutions.title')}</h1>
        </div>
      </div>

      <div className="global-solutions-toolbar">
        <form className="global-solutions-search" onSubmit={handleSearch}>
          <input
            type="text"
            className="global-solutions-search-input"
            placeholder={t('common.search')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm">
            {t('common.search')}
          </button>
        </form>
        <div className="global-solutions-sort">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`filter-btn ${sort === opt.value ? 'active' : ''}`}
              onClick={() => { setSort(opt.value); setPage(1); }}
            >
              {opt.value === 'newest' ? t('solutions.newest') : t('solutions.popular')}
            </button>
          ))}
          <span className="global-solutions-count">
            {t('solutions.totalCount').replace('{0}', String(pagination.total || 0))}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="global-solutions-loading">
          <div className="loading-spinner" />
          <span>{t('common.loading')}</span>
        </div>
      ) : loadError ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchSolutions}>{t('common.retry')}</button>
        </div>
      ) : solutions.length === 0 ? (
        <div className="global-solutions-empty">
          <Code size={48} className="empty-icon" />
          <h2>{t('solutions.noSolutions')}</h2>
          <p>{t('solutions.noSolutionsDesc')}</p>
        </div>
      ) : (
        <div className="global-solutions-list">
          {solutions.map((solution) => (
            <Link
              key={solution.id}
              to={`/solutions/${solution.id}`}
              className="global-solution-card"
            >
              <div className="global-solution-card-main">
                <div className="global-solution-card-header">
                  <h3 className="global-solution-title">{solution.title}</h3>
                  {solution.language && (
                    <span className="global-solution-language-badge">
                      <Code size={12} />
                      {LANGUAGE_BADGE[solution.language] || solution.language}
                    </span>
                  )}
                </div>
                <div className="global-solution-card-meta">
                  {solution.problem_title && (
                    <>
                      <Link
                        to={`/problems/${solution.problem_id}`}
                        className="global-solution-problem-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <BookOpen size={12} />
                        {solution.problem_title}
                      </Link>
                      <span className="global-solution-dot">·</span>
                    </>
                  )}
                  <span className="global-solution-author">{solution.username || solution.author}</span>
                  <span className="global-solution-dot">·</span>
                  <span className="global-solution-date">
                    <Clock size={12} />
                    {formatRelativeTime(solution.created_at)}
                  </span>
                </div>
              </div>
              <div className="global-solution-card-stats">
                <span className="global-solution-stat" title={t('solutions.votes')}>
                  <ThumbsUp size={14} />
                  {solution.vote_count || 0}
                </span>
                <span className="global-solution-stat" title={t('solutions.views')}>
                  <Eye size={14} />
                  {solution.view_count || 0}
                </span>
              </div>
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
