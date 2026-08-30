import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { MessageSquare, Eye, Pin, Clock, Tag, AlertCircle } from 'lucide-react';
import { t } from '../i18n';
import { useToastStore } from '../store/toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './GlobalDiscussions.css';

const CATEGORY_OPTIONS = ['all', 'question', 'share', 'general'] as const;
const SORT_OPTIONS = ['newest', 'active'] as const;

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  question: 'global-discussion-category-badge question',
  share: 'global-discussion-category-badge share',
  general: 'global-discussion-category-badge general',
};

const getCategoryLabel = (category: string) => {
  if (category === 'question') return t('discussions.question');
  if (category === 'share') return t('discussions.share');
  return t('discussions.general');
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString();
};

export default function GlobalDiscussions() {
  const addToast = useToastStore((s) => s.addToast);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [discussions, setDiscussions] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pagination, setPagination] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [page, setPage] = useState(1);
  useDocumentTitle(t('discussions.title'));

  const fetchDiscussions = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = {
        page,
        pageSize: 20,
        sort: sortBy,
      };
      if (categoryFilter !== 'all') {
        params.category = categoryFilter;
      }
      const data = await api.getDiscussions(params);
      setDiscussions(data.discussions || []);
      setPagination(data.pagination || null);
    } catch (e) {
      addToast('error', t('common.loadError'));
      console.error('Failed to fetch discussions:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDiscussions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, sortBy, page]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pinnedDiscussions = discussions.filter((d: any) => d.is_pinned);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalDiscussions = discussions.filter((d: any) => !d.is_pinned);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDiscussionCard = (discussion: any) => (
    <Link
      key={discussion.id}
      to={`/discussions/${discussion.id}`}
      className={`global-discussion-card${discussion.is_pinned ? ' pinned' : ''}`}
    >
      <div className="global-discussion-card-stats">
        <span className="global-discussion-stat">
          <MessageSquare size={14} className="global-discussion-stat-icon" />
          {discussion.reply_count ?? 0}
        </span>
        <span className="global-discussion-stat">
          <Eye size={14} className="global-discussion-stat-icon" />
          {discussion.view_count ?? 0}
        </span>
      </div>
      <div className="global-discussion-card-body">
        <div className="global-discussion-card-header">
          {discussion.is_pinned && (
            <span className="global-discussion-pin-badge">
              <Pin size={10} />
              {t('discussions.pinned')}
            </span>
          )}
          <h3 className="global-discussion-card-title">{discussion.title}</h3>
          <span className={CATEGORY_BADGE_CLASS[discussion.category] || 'global-discussion-category-badge general'}>
            {getCategoryLabel(discussion.category)}
          </span>
        </div>
        <div className="global-discussion-card-footer">
          {discussion.problem_title && (
            <>
              <Link
                to={`/problems/${discussion.problem_id}`}
                className="global-discussion-problem-link"
                onClick={(e) => e.stopPropagation()}
              >
                <Tag size={12} />
                {discussion.problem_title}
              </Link>
              <span className="global-discussion-dot">·</span>
            </>
          )}
          <span className="global-discussion-author">{discussion.username || discussion.user_id}</span>
          <span className="global-discussion-dot">·</span>
          <span className="global-discussion-date">
            <Clock size={12} />
            {formatDate(discussion.created_at)}
          </span>
        </div>
      </div>
    </Link>
  );

  return (
    <div className="global-discussions-page">
      <div className="global-discussions-header">
        <div className="global-discussions-title-section">
          <MessageSquare size={28} className="title-icon" />
          <h1>{t('discussions.title')}</h1>
        </div>
      </div>

      <div className="global-discussions-filters">
        <div className="filter-group">
          <Tag size={14} />
          <span className="filter-label">{t('discussions.category')}:</span>
          {CATEGORY_OPTIONS.map((cat) => (
            <button
              key={cat}
              className={`filter-btn ${categoryFilter === cat ? 'active' : ''}`}
              onClick={() => {
                setCategoryFilter(cat);
                setPage(1);
              }}
            >
              {cat === 'all' ? t('common.all') : getCategoryLabel(cat)}
            </button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">{t('discussions.sortBy')}:</span>
          {SORT_OPTIONS.map((sort) => (
            <button
              key={sort}
              className={`filter-btn ${sortBy === sort ? 'active' : ''}`}
              onClick={() => {
                setSortBy(sort);
                setPage(1);
              }}
            >
              {sort === 'newest' ? t('discussions.newest') : t('discussions.active')}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="global-discussions-empty">
          <div className="global-discussions-empty-icon">
            <MessageSquare size={40} />
          </div>
          <p>{t('common.loading')}</p>
        </div>
      ) : loadError ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchDiscussions}>{t('common.retry')}</button>
        </div>
      ) : discussions.length === 0 ? (
        <div className="global-discussions-empty">
          <div className="global-discussions-empty-icon">
            <MessageSquare size={40} />
          </div>
          <p>{t('discussions.noDiscussions')}</p>
        </div>
      ) : (
        <>
          <div className="global-discussions-list">
            {pinnedDiscussions.map(renderDiscussionCard)}
            {normalDiscussions.map(renderDiscussionCard)}
          </div>

          {pagination && pagination.total_pages > 1 && (
            <div className="global-discussions-pagination">
              <button
                className="pagination-btn"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t('common.previous')}
              </button>
              <span className="pagination-info">
                {t('common.page').replace('{0}', String(page)).replace('{1}', String(pagination.total_pages))}
              </span>
              <button
                className="pagination-btn"
                disabled={page >= pagination.total_pages}
                onClick={() => setPage(page + 1)}
              >
                {t('common.next')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
