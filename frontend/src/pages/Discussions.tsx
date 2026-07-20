import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { MessageSquare, Eye, Plus, Pin, Clock, Tag, AlertCircle } from 'lucide-react';
import ImageUploadButton from '../components/ImageUploadButton';
import Captcha from '../components/Captcha';
import type { CaptchaHandle } from '../components/Captcha';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToastStore } from '../store/toast';
import './Discussions.css';

const CATEGORY_OPTIONS = ['all', 'question', 'share', 'general'] as const;
const SORT_OPTIONS = ['newest', 'active'] as const;

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  question: 'discussion-category-badge question',
  share: 'discussion-category-badge share',
  general: 'discussion-category-badge general',
};

const getCategoryLabel = (category: string) => {
  if (category === 'question') return t('discussions.question');
  if (category === 'share') return t('discussions.share');
  return t('discussions.general');
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString();
};

export default function Discussions() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);

  const problemId = searchParams.get('problem_id');
  const problemTitle = searchParams.get('problem_title');

  const [discussions, setDiscussions] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [page, setPage] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState('general');
  const [formContent, setFormContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [captchaUuid, setCaptchaUuid] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const captchaRef = useRef<CaptchaHandle>(null);
  useDocumentTitle(t('discussions.title'));

  useEffect(() => {
    fetchDiscussions();
  }, [categoryFilter, sortBy, page, problemId]);

  const fetchDiscussions = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const params: any = {
        page,
        pageSize: 20,
        sort: sortBy,
      };
      if (categoryFilter !== 'all') {
        params.category = categoryFilter;
      }
      if (problemId) {
        params.problem_id = problemId;
      }
      const data = await api.getDiscussions(params);
      setDiscussions(data.discussions || []);
      setPagination(data.pagination || null);
    } catch (e) {
      console.error('Failed to fetch discussions:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDiscussion = async () => {
    if (!formTitle.trim() || !formContent.trim() || submitting) return;
    setSubmitting(true);
    try {
      const data: any = {
        title: formTitle.trim(),
        category: formCategory,
        content: formContent.trim(),
        captcha_uuid: captchaUuid,
        captcha_answer: captchaAnswer,
      };
      if (problemId) {
        data.problem_id = Number(problemId);
      }
      const result = await api.createDiscussion(data);
      setShowForm(false);
      setFormTitle('');
      setFormCategory('general');
      setFormContent('');
      navigate(`/discussions/${result.id}`);
    } catch (e: any) {
      console.error('Failed to create discussion:', e);
      if (e.message?.includes('CAPTCHA')) {
        captchaRef.current?.refresh();
      }
      addToast('error', e.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const pinnedDiscussions = discussions.filter((d: any) => d.is_pinned);
  const normalDiscussions = discussions.filter((d: any) => !d.is_pinned);

  const renderDiscussionCard = (discussion: any) => (
    <Link
      key={discussion.id}
      to={`/discussions/${discussion.id}`}
      className={`discussion-card${discussion.is_pinned ? ' pinned' : ''}`}
    >
      <div className="discussion-card-stats">
        <span className="discussion-stat">
          <MessageSquare size={14} className="discussion-stat-icon" />
          {discussion.reply_count ?? 0}
        </span>
        <span className="discussion-stat">
          <Eye size={14} className="discussion-stat-icon" />
          {discussion.view_count ?? 0}
        </span>
      </div>
      <div className="discussion-card-body">
        <div className="discussion-card-header">
          {discussion.is_pinned && (
            <span className="discussion-pin-badge">
              <Pin size={10} />
              {t('discussions.pinned')}
            </span>
          )}
          <h3 className="discussion-card-title">{discussion.title}</h3>
          <span className={CATEGORY_BADGE_CLASS[discussion.category] || 'discussion-category-badge general'}>
            {getCategoryLabel(discussion.category)}
          </span>
        </div>
        <div className="discussion-card-footer">
          <span className="discussion-author">{discussion.username || discussion.user_id}</span>
          <span className="discussion-date">
            <Clock size={12} />
            {formatDate(discussion.created_at)}
          </span>
        </div>
      </div>
    </Link>
  );

  return (
    <div className="discussions-page">
      <div className="discussions-header">
        <div className="discussions-title-section">
          <MessageSquare size={28} className="title-icon" />
          <h1>{t('discussions.title')}</h1>
          {problemTitle && (
            <span className="discussions-problem-badge">
              <Tag size={12} />
              <Link to={`/problems/${problemId}`}>{problemTitle}</Link>
            </span>
          )}
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            if (!user) {
              navigate('/login');
              return;
            }
            setShowForm(!showForm);
          }}
        >
          <Plus size={14} />
          {t('discussions.newDiscussion')}
        </button>
      </div>

      {showForm && (
        <div className="new-discussion-form">
          <h3>{t('discussions.createDiscussion')}</h3>
          <div className="form-row">
            <label>{t('discussions.titleLabel')}</label>
            <input
              className="form-input"
              type="text"
              placeholder={t('discussions.titlePlaceholder')}
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>{t('discussions.categoryLabel')}</label>
            <select
              className="form-select"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value)}
            >
              <option value="question">{t('discussions.question')}</option>
              <option value="share">{t('discussions.share')}</option>
              <option value="general">{t('discussions.general')}</option>
            </select>
          </div>
          <div className="form-row">
            <label>{t('discussions.contentLabel')}</label>
            <textarea
              className="form-textarea"
              placeholder={t('discussions.contentPlaceholder')}
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
            />
            <div style={{marginTop:'4px'}}>
              <ImageUploadButton onInsert={(md) => setFormContent(prev => prev + (prev ? '\n' : '') + md)} />
            </div>
          </div>
          <Captcha
            ref={captchaRef}
            onCaptchaReady={({ uuid }) => setCaptchaUuid(uuid)}
            onCaptchaChange={(answer) => setCaptchaAnswer(answer)}
            captchaAnswer={captchaAnswer}
          />
          <div className="form-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowForm(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreateDiscussion}
              disabled={submitting || !formTitle.trim() || !formContent.trim()}
            >
              {submitting ? t('discussions.creating') : t('discussions.submit')}
            </button>
          </div>
        </div>
      )}

      <div className="discussions-filters">
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
        <div className="discussions-empty">
          <div className="discussions-empty-icon">
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
        <div className="discussions-empty">
          <div className="discussions-empty-icon">
            <MessageSquare size={40} />
          </div>
          <p>{t('discussions.noDiscussions')}</p>
        </div>
      ) : (
        <>
          <div className="discussions-list">
            {pinnedDiscussions.map(renderDiscussionCard)}
            {normalDiscussions.map(renderDiscussionCard)}
          </div>

          {pagination && pagination.total_pages > 1 && (
            <div className="discussions-pagination">
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
