import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { List, Search, User, Hash, PlusCircle, AlertCircle } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './ProblemLists.css';

export default function ProblemLists() {
  const [lists, setLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  useDocumentTitle(t('lists.title'));

  const fetchLists = useCallback(async () => {
    try {
      const data = await api.getProblemLists({
        search: search || undefined,
      });
      setLists(data.lists);
      setLoadError(false);
    } catch (e) {
      console.error('Failed to fetch problem lists:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLists();
  }, [fetchLists]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  return (
    <div className="problem-lists-page">
      <div className="lists-header">
        <div className="lists-title-section">
          <List size={28} className="title-icon" />
          <h1 className="page-title">{t('lists.title')}</h1>
        </div>
        <Link to="/lists/new" className="btn btn-primary btn-sm">
          <PlusCircle size={14} />
          {t('lists.createList')}
        </Link>
        <form className="search-bar" onSubmit={handleSearch}>
          <Search size={16} />
          <input
            type="text"
            placeholder={t('lists.search')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : loadError ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); setLoadError(false); fetchLists(); }}>{t('common.retry')}</button>
        </div>
      ) : lists.length === 0 ? (
        <EmptyState
          icon={List}
          title={t('lists.noLists')}
        />
      ) : (
        <div className="lists-grid">
          {lists.map((list) => (
            <Link
              key={list.id}
              to={`/lists/${list.id}`}
              className="list-card"
            >
              <div className="list-card-header">
                <List size={18} className="list-card-icon" />
                <h3 className="list-card-title">{list.title}</h3>
              </div>
              <p className="list-card-description">
                {list.description || ''}
              </p>
              <div className="list-card-footer">
                <span className="list-card-stat">
                  <Hash size={14} />
                  {t('lists.problemCount')}: {list.problem_count ?? 0}
                </span>
                <span className="list-card-stat">
                  <User size={14} />
                  {list.creator || list.username || ''}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
