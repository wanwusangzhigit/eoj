import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Search, FileText, User, BookOpen, MessageSquare, Lightbulb, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToastStore } from '../store/toast';
import { t } from '../i18n';
import { highlightText } from '../utils/highlight';
import './Search.css';

const TYPE_TABS = ['all', 'problems', 'users', 'blogs', 'discussions', 'solutions'] as const;
type SearchType = (typeof TYPE_TABS)[number];

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const addToast = useToastStore((s) => s.addToast);
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [type, setType] = useState<SearchType>((searchParams.get('type') as SearchType) || 'all');
  const [results, setResults] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useDocumentTitle(t('search.title'));

  const runSearch = useCallback(async (q: string, searchType: string) => {
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.search(q.trim(), searchType);
      setResults(data.results || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      setError(e.message || t('common.error'));
      addToast('error', e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    const q = searchParams.get('q') || '';
    const t = (searchParams.get('type') as SearchType) || 'all';
    setQuery(q);
    setType(t);
    setPage(1);
    runSearch(q, t);
  }, [searchParams, runSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams({ q: query.trim(), type });
  };

  const switchType = (t: SearchType) => {
    setSearchParams({ q: query.trim(), type: t });
  };

  const getResultContent = (r: any) => {
    switch (r.type) {
      case 'problem':
        return (
          <div className="search-result">
            <div className="search-result-title"><FileText size={15} /> <Link to={r.url}>{highlightText(r.title, query)}</Link></div>
            <div className="search-result-meta">
              <span className="difficulty-badge" style={{ color: r.difficulty === 'Easy' ? '#3fb950' : r.difficulty === 'Medium' ? '#d29922' : '#f85149' }}>{r.difficulty}</span>
              <span>AC: {r.accepted_count ?? 0}</span>
            </div>
          </div>
        );
      case 'user':
        return (
          <div className="search-result">
            <div className="search-result-title"><User size={15} /> <Link to={r.url}>{highlightText(r.username, query)}</Link></div>
          </div>
        );
      case 'blog':
        return (
          <div className="search-result">
            <div className="search-result-title"><BookOpen size={15} /> <Link to={r.url}>{highlightText(r.title, query)}</Link></div>
            <div className="search-result-meta"><span>by {r.username}</span><span>{new Date(r.created_at).toLocaleDateString()}</span></div>
          </div>
        );
      case 'discussion':
        return (
          <div className="search-result">
            <div className="search-result-title"><MessageSquare size={15} /> <Link to={r.url}>{highlightText(r.title, query)}</Link></div>
            <div className="search-result-meta"><span>by {r.username}</span><span>{r.reply_count ?? 0} {t('search.replies')}</span></div>
          </div>
        );
      case 'solution':
        return (
          <div className="search-result">
            <div className="search-result-title"><Lightbulb size={15} /> <Link to={r.url}>{r.problem_title ? `[${highlightText(r.problem_title, query)}] ` : ''}{highlightText(r.title, query)}</Link></div>
            <div className="search-result-meta"><span>by {r.username}</span>{r.language && <span>{r.language}</span>}</div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="search-page">
      <div className="page-header">
        <h1><Search size={20} /> {t('search.title')}</h1>
        <form className="search-bar" onSubmit={handleSubmit}>
          <Search size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
          />
        </form>
      </div>

      <div className="search-tabs">
        {TYPE_TABS.map((t2) => (
          <button key={t2} className={`search-tab ${type === t2 ? 'active' : ''}`} onClick={() => switchType(t2)}>
            {t(`search.types.${t2}`)}
          </button>
        ))}
      </div>

      {error && <div className="error-banner"><AlertCircle size={16} /> {error}</div>}

      {loading ? (
        <div className="loading-container"><div className="loading-spinner"></div></div>
      ) : !query.trim() ? (
        <div className="empty">{t('search.hint')}</div>
      ) : results.length === 0 ? (
        <div className="empty">{t('search.noResults')}</div>
      ) : (
        <>
          <div className="search-summary">{t('search.totalResults').replace('{0}', String(total))}</div>
          <div className="search-results">
            {results.map((r, i) => (
              <div key={`${r.type}-${r.id}-${i}`} className="search-result-item">
                {getResultContent(r)}
              </div>
            ))}
          </div>
          {total > 10 && (
            <div className="pagination">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => { setPage(page - 1); setSearchParams({ q: query.trim(), type, page: String(page - 1) }); }}>
                <ChevronLeft size={14} />
              </button>
              <span>{page}</span>
              <button className="btn btn-secondary btn-sm" disabled={page * 10 >= total} onClick={() => { setPage(page + 1); setSearchParams({ q: query.trim(), type, page: String(page + 1) }); }}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
