import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Megaphone, Pin, Calendar, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { renderMarkdown } from '../utils/markdown';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { t } from '../i18n';
import './Announcements.css';

export default function Announcements() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const [search, setSearch] = useState(initialSearch);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useDocumentTitle(t('announcements.title'));

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAnnouncements({ page, pageSize: 10, search: search || undefined });
      setAnnouncements(data.announcements);
      setPagination(data.pagination);
      setError('');
    } catch (e: any) {
      setError(e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  return (
    <div className="announcements-page">
      <div className="page-header">
        <h1><Megaphone size={22} /> {t('announcements.title')}</h1>
        <form className="search-bar" onSubmit={handleSearch}>
          <Search size={16} />
          <input
            type="text"
            placeholder={t('announcements.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
      </div>

      {error && <div className="error-banner"><span>{error}</span></div>}

      {loading ? (
        <div className="loading-container"><div className="loading-spinner"></div></div>
      ) : announcements.length === 0 ? (
        <div className="empty">{t('announcements.noAnnouncements')}</div>
      ) : (
        <div className="announcement-list">
          {announcements.map((a) => (
            <div key={a.id} className={`announcement-card ${a.is_pinned ? 'pinned' : ''}`}>
              <div
                className="announcement-card-header"
                onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
              >
                {a.is_pinned === 1 && <Pin size={14} className="pin-icon" />}
                <h3>{a.title}</h3>
                <span className="announcement-date"><Calendar size={12} /> {new Date(a.created_at).toLocaleString()}</span>
              </div>
              {expandedId === a.id && (
                <div className="announcement-card-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.content || '') }} />
              )}
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
