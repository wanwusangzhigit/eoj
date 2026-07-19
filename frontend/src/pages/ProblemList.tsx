import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { Search, Tag, Clock, MemoryStick, Filter, CheckCircle, AlertCircle } from 'lucide-react';
import { DIFFICULTY_COLORS, DIFFICULTIES } from '../constants';
import RatingBadge from '../components/RatingBadge';
import { t } from '../i18n';
import { useToastStore } from '../store/toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './ProblemList.css';

export default function ProblemList() {
  const { user } = useAuthStore();
  const [problems, setProblems] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({});
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [solvedProblems, setSolvedProblems] = useState<Set<number>>(new Set());
  const [attemptedProblems, setAttemptedProblems] = useState<Set<number>>(new Set());
  useDocumentTitle(t('problemList.title'));

  useEffect(() => {
    fetchProblems();
    if (user) {
      fetchUserProgress();
    }
    fetchTags();
  }, [page, debouncedSearch, selectedTag, selectedDifficulty, user]);

  const fetchTags = async () => {
    try {
      const data = await api.getProblemTags();
      setAllTags(data.tags);
    } catch {
      // fallback: extract from current page results
    }
  };

  const fetchProblems = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getProblems({
        page,
        pageSize: 20,
        search: debouncedSearch || undefined,
        tag: selectedTag || undefined,
        difficulty: selectedDifficulty || undefined,
      });
      setProblems(data.problems);
      setPagination(data.pagination);
    } catch (e: any) {
      useToastStore().addToast('error', t('common.loadError'));
      console.error('Failed to fetch problems:', e);
      setError(e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const fetchUserProgress = async () => {
    try {
      const solved = await api.getUserSolved();
      const solvedIds = new Set(solved.problems.map((p: any) => p.id));
      setSolvedProblems(solvedIds);

      const submissions = await api.getSubmissions({ pageSize: 100 });
      const attemptedIds = new Set(
        submissions.submissions
          .filter((s: any) => !solvedIds.has(s.problem_id))
          .map((s: any) => s.problem_id)
      );
      setAttemptedProblems(attemptedIds);
    } catch (e) {
      useToastStore().addToast('error', t('common.error'));
      console.error('Failed to fetch user progress:', e);
    }
  };

  const getProblemStatus = (problemId: number) => {
    if (solvedProblems.has(problemId)) return 'accepted';
    if (attemptedProblems.has(problemId)) return 'attempted';
    return 'none';
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedSearch(search);
    setPage(1);
  };

  // Debounce search input
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setSelectedTag('');
    setSelectedDifficulty('');
    setPage(1);
  };

  return (
    <div className="problem-list-page">
      <div className="page-header">
        <h1>{t('problemList.title')}</h1>
        <form className="search-bar" onSubmit={handleSearch}>
          <Search size={16} />
          <input
            type="text"
            placeholder={t('problemList.searchPlaceholder')}
            name="problem_search"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
      </div>

      <div className="filters">
        <div className="difficulty-filter">
          <Filter size={14} />
          <span className="filter-label">{t('problemList.difficulty')}:</span>
          <select
            className="filter-select"
            value={selectedDifficulty}
            onChange={(e) => { setSelectedDifficulty(e.target.value); setPage(1); }}
          >
            <option value="">{t('problemList.allDifficulty')}</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {allTags.length > 0 && (
          <div className="tag-filter">
            <Tag size={14} />
            {selectedTag ? (
              <button className="tag-chip active" onClick={() => { setSelectedTag(''); setPage(1); }}>
                {selectedTag} ×
              </button>
            ) : (
              allTags.map((tag) => (
                <button key={tag} className="tag-chip" onClick={() => { setSelectedTag(tag); setPage(1); }}>
                  {tag}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {(selectedTag || selectedDifficulty || debouncedSearch) && (
        <button className="clear-filters-btn" onClick={clearFilters}>
          {t('problemList.clearFilters')}
        </button>
      )}

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchProblems}>{t('common.retry')}</button>
        </div>
      )}

      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>{t('problemList.loadingProblems')}</p>
        </div>
      ) : error ? null : problems.length === 0 ? (
        <div className="empty">{t('problemList.noProblemsFound')}</div>
      ) : (
        <div className="problem-table">
          <div className="problem-table-header">
            <span className="col-status">{t('problemList.status')}</span>
            <span className="col-id">#</span>
            <span className="col-title">{t('problemList.titleCol')}</span>
            <span className="col-difficulty">{t('problemList.difficulty')}</span>
            <span className="col-tags">{t('problemList.tags')}</span>
            <span className="col-submissions">{t('problemList.submissions')}</span>
            <span className="col-rate">{t('problemList.passRate')}</span>
            <span className="col-limit">{t('problemList.limits')}</span>
          </div>
          {problems.map((problem, index) => {
            const status = getProblemStatus(problem.id);
            const displayId = (pagination.page - 1) * pagination.pageSize + index + 1;
            const rateLevel = problem.pass_rate != null
              ? (problem.pass_rate >= 0.6 ? 'high' : problem.pass_rate >= 0.3 ? 'medium' : 'low')
              : '';
            const ratePct = problem.pass_rate != null ? Math.round(problem.pass_rate * 100) : null;
            return (
              <Link
                key={problem.id}
                to={`/problems/${problem.slug}`}
                className={`problem-row ${status}`}
                data-difficulty={problem.difficulty || ''}
              >
                <span className="col-status">
                  {status === 'accepted' && <CheckCircle size={16} className="status-icon accepted" />}
                  {status === 'attempted' && <AlertCircle size={16} className="status-icon attempted" />}
                </span>
                <span className="col-id">{displayId}</span>
                <span className="col-title">{problem.title}</span>
                <span className="col-difficulty">
                  {problem.rating && problem.rating >= 800 ? (
                    <RatingBadge rating={problem.rating} size="sm" />
                  ) : (
                    <span style={{ color: DIFFICULTY_COLORS[problem.difficulty] || 'var(--text-secondary)' }}>
                      {problem.difficulty}
                    </span>
                  )}
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
                <span className="col-submissions">{problem.submission_count || 0}</span>
                <span className="col-rate">
                  {ratePct !== null ? (
                    <>
                      <span className="pass-rate-bar">
                        <span
                          className={`pass-rate-fill ${rateLevel}`}
                          style={{ width: `${ratePct}%` }}
                        />
                      </span>
                      <span className={`pass-rate-text ${rateLevel}`}>{ratePct}%</span>
                    </>
                  ) : (
                    <span className="pass-rate-text">-</span>
                  )}
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
            );
          })}
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
