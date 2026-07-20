import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { MessageSquare, Eye, Clock, ChevronRight, Trash2, Edit3, Send, Pin } from 'lucide-react';
import { renderMarkdown } from '../utils/markdown';
import { t } from '../i18n';
import { useToastStore } from '../store/toast';
import ImageUploadButton from '../components/ImageUploadButton';
import './DiscussionDetail.css';

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
  return new Date(dateStr).toLocaleString();
};

export default function DiscussionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);

  const [discussion, setDiscussion] = useState<any>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [editContent, setEditContent] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  const replyEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    fetchDiscussion();
  }, [id]);

  const fetchDiscussion = async () => {
    setLoading(true);
    try {
      const data = await api.getDiscussion(Number(id));
      setDiscussion(data.discussion);
      setReplies(data.replies || []);
    } catch (e: any) {
      addToast('error', t('common.loadError'));
      console.error('Failed to fetch discussion:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async () => {
    if (!id || !replyContent.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.createDiscussionReply(Number(id), replyContent.trim());
      setReplyContent('');
      fetchDiscussion();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
      console.error('Failed to reply:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDiscussion = async () => {
    if (!id) return;
    if (!window.confirm(t('discussions.deleteConfirm'))) return;
    try {
      await api.deleteDiscussion(Number(id));
      navigate('/discussions');
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
      console.error('Failed to delete discussion:', e);
    }
  };

  const handleDeleteReply = async (replyId: number) => {
    if (!id || !replyId) return;
    if (!window.confirm(t('discussions.deleteReplyConfirm'))) return;
    try {
      await api.deleteDiscussionReply(Number(id), replyId);
      fetchDiscussion();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
      console.error('Failed to delete reply:', e);
    }
  };

  const startEditing = () => {
    if (!discussion) return;
    setEditTitle(discussion.title);
    setEditCategory(discussion.category);
    setEditContent(discussion.content);
    setIsEditing(true);
  };

  const handleEditSubmit = async () => {
    if (!id || !editTitle.trim() || !editContent.trim() || editSubmitting) return;
    setEditSubmitting(true);
    try {
      await api.updateDiscussion(Number(id), {
        title: editTitle.trim(),
        category: editCategory,
        content: editContent.trim(),
      });
      setIsEditing(false);
      fetchDiscussion();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
      console.error('Failed to update discussion:', e);
    } finally {
      setEditSubmitting(false);
    }
  };

  const isOwner = user && discussion && (user.id === discussion.user_id);
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  if (loading) {
    return (
      <div className="discussion-detail-page">
        <div className="discussions-empty">
          <MessageSquare size={40} />
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!discussion) {
    return (
      <div className="discussion-detail-page">
        <div className="empty-container">
          <h2>{t('submissionDetail.notFound')}</h2>
          <Link to="/discussions" className="btn btn-primary">{t('discussions.backToDiscussions')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="discussion-detail-page">
      <div className="breadcrumb">
        <Link to="/discussions">{t('discussions.title')}</Link>
        <ChevronRight size={14} />
        <span>{discussion.title}</span>
      </div>

      <div className="discussion-info-card">
        <div className="discussion-info-header">
          <div className="discussion-info-title-section">
            <MessageSquare size={22} className="discussion-detail-icon" />
            <h1 className="discussion-detail-title">{discussion.title}</h1>
          </div>
          <div className="discussion-detail-badges">
            {discussion.is_pinned && (
              <span className="discussion-pin-badge">
                <Pin size={12} />
                {t('discussions.pinned')}
              </span>
            )}
            <span className={CATEGORY_BADGE_CLASS[discussion.category] || 'discussion-category-badge general'}>
              {getCategoryLabel(discussion.category)}
            </span>
          </div>
        </div>

        <div className="discussion-meta">
          <span className="meta-item">
            {discussion.username || discussion.user_id}
          </span>
          <span className="meta-item">
            <Clock size={14} />
            {formatDate(discussion.created_at)}
          </span>
          <span className="meta-item">
            <Eye size={14} />
            {discussion.view_count ?? 0} {t('discussions.views')}
          </span>
        </div>

        {!isEditing ? (
          <>
            <div
              className="discussion-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(discussion.content) }}
            />

            {(isOwner || isAdmin) && (
              <div className="discussion-actions">
                {isOwner && (
                  <button className="action-btn" onClick={startEditing}>
                    <Edit3 size={14} />
                    {t('common.edit')}
                  </button>
                )}
                <button className="action-btn danger" onClick={handleDeleteDiscussion}>
                  <Trash2 size={14} />
                  {t('common.delete')}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="edit-form">
            <div className="form-row">
              <label>{t('discussions.titleField')}</label>
              <input
                className="form-input"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>{t('discussions.category')}</label>
              <select
                className="form-select"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
              >
                <option value="question">{t('discussions.question')}</option>
                <option value="share">{t('discussions.share')}</option>
                <option value="general">{t('discussions.general')}</option>
              </select>
            </div>
            <div className="form-row">
              <label>{t('discussions.contentField')}</label>
              <textarea
                className="form-textarea"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
              <div style={{marginTop:'4px'}}>
                <ImageUploadButton onInsert={(md) => setEditContent(prev => prev + (prev ? '\n' : '') + md)} />
              </div>
            </div>
            <div className="edit-form-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setIsEditing(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleEditSubmit}
                disabled={editSubmitting || !editTitle.trim() || !editContent.trim()}
              >
                {editSubmitting ? t('discussions.save') : t('common.save')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="replies-section">
        <h3>{t('discussions.replies')} ({replies.length})</h3>
        {replies.length === 0 ? (
          <div className="no-replies">{t('discussions.noReplies')}</div>
        ) : (
          <div className="replies-list">
            {replies.map((reply: any, idx: number) => {
              const isReplyOwner = user && (user.id === reply.user_id);
              const canDeleteReply = isReplyOwner || isAdmin;
              return (
                <div key={reply.id || idx} className="reply-item">
                  <div className="reply-header">
                    <span className="reply-author">
                      {reply.username || reply.user_id}
                    </span>
                    <span className="reply-date">
                      <Clock size={12} />
                      {formatDate(reply.created_at)}
                    </span>
                    {canDeleteReply && (
                      <div className="reply-actions">
                        <button
                          className="reply-delete-btn"
                          onClick={() => handleDeleteReply(reply.id)}
                        >
                          <Trash2 size={12} />
                          {t('common.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                  <div
                    className="reply-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(reply.content) }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {user ? (
          <div className="reply-form">
            <textarea
              className="reply-textarea"
              placeholder={t('discussions.replyPlaceholder')}
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={3}
            />
            <div style={{display:'flex',gap:'8px',alignItems:'center',marginTop:'8px'}}>
              <ImageUploadButton onInsert={(md) => setReplyContent(prev => prev + (prev ? '\n' : '') + md)} />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleReply}
                disabled={submitting || !replyContent.trim()}
              >
                <Send size={14} />
                {submitting ? t('discussions.replying') : t('discussions.reply')}
              </button>
            </div>
          </div>
        ) : (
          <div className="reply-login-hint">
            <Link to="/login">{t('discussions.loginRequired')}</Link>
          </div>
        )}
      </div>
      <div ref={replyEndRef} />
    </div>
  );
}
