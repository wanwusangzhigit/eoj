import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { ThumbsUp, Eye, Clock, ChevronRight, ArrowLeft, Trash2, Edit3, Code, CheckCircle } from 'lucide-react';
import { renderMarkdown } from '../utils/markdown';
import { useToastStore } from '../store/toast';
import { t } from '../i18n';
import ImageUploadButton from '../components/ImageUploadButton';
import './SolutionDetail.css';

const LANGUAGES = ['C', 'C++', 'Java', 'Python', 'JavaScript', 'Go', 'Rust', 'TypeScript'];

export default function SolutionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { addToast } = useToastStore();

  const [solution, setSolution] = useState<any>(null);
  const [isVoted, setIsVoted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editLanguage, setEditLanguage] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchSolution();
  }, [id]);

  const fetchSolution = async () => {
    setLoading(true);
    try {
      const data = await api.getSolution(Number(id));
      setSolution(data.solution);
      setIsVoted(data.is_voted);
    } catch (e: any) {
      addToast('error', t('common.loadError'));
      console.error('Failed to fetch solution:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async () => {
    if (!user || voting) return;
    setVoting(true);
    try {
      const data = await api.voteSolution(Number(id));
      setIsVoted(data.is_voted);
      setSolution((prev: any) => prev ? { ...prev, vote_count: data.vote_count } : prev);
    } catch (e: any) {
      console.error('Failed to vote:', e);
      addToast('error', e.message || t('common.error'));
    } finally {
      setVoting(false);
    }
  };

  const handleEdit = () => {
    if (!solution) return;
    setEditTitle(solution.title);
    setEditLanguage(solution.language);
    setEditContent(solution.content);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditTitle('');
    setEditLanguage('');
    setEditContent('');
  };

  const handleSaveEdit = async () => {
    if (!id || saving) return;
    if (!editTitle.trim() || !editContent.trim()) {
      addToast('error', t('common.error'));
      return;
    }
    setSaving(true);
    try {
      await api.updateSolution(Number(id), {
        title: editTitle.trim(),
        language: editLanguage,
        content: editContent.trim(),
      });
      addToast('success', t('common.success'));
      setEditing(false);
      fetchSolution();
    } catch (e: any) {
      console.error('Failed to update solution:', e);
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id || deleting) return;
    setDeleting(true);
    try {
      await api.deleteSolution(Number(id));
      addToast('success', t('common.success'));
      navigate(-1);
    } catch (e: any) {
      console.error('Failed to delete solution:', e);
      addToast('error', e.message || t('common.error'));
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const isOwner = user && solution && user.id === solution.user_id;
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canEdit = isOwner;
  const canDelete = isOwner || isAdmin;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div className="solution-detail-page">
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (!solution) {
    return (
      <div className="solution-detail-page">
        <div className="empty-container">
          <h2>{t('common.noData')}</h2>
          <button className="back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="solution-detail-page">
      <div className="breadcrumb">
        <Link to="/problems">{t('nav.problems')}</Link>
        <ChevronRight size={14} />
        {solution.problem_slug && (
          <>
            <Link to={`/problems/${solution.problem_slug}`}>{solution.problem_title}</Link>
            <ChevronRight size={14} />
          </>
        )}
        <span>{solution.title}</span>
      </div>

      <button className="back-btn" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} />
        {t('common.back')}
      </button>

      <div className="solution-card">
        {editing ? (
          <div className="edit-form">
            <div className="form-group">
              <label>{t('solutions.titleField')}</label>
              <input
                className="form-input"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>{t('solutions.language')}</label>
              <select
                className="form-select"
                value={editLanguage}
                onChange={(e) => setEditLanguage(e.target.value)}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('solutions.contentField')}</label>
              <textarea
                className="form-textarea"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
              <div style={{marginTop:'4px'}}>
                <ImageUploadButton onInsert={(md) => setEditContent(prev => prev + (prev ? '\n' : '') + md)} />
              </div>
            </div>
            <div className="edit-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleCancelEdit}
                disabled={saving}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveEdit}
                disabled={saving || !editTitle.trim() || !editContent.trim()}
              >
                {saving ? t('common.loading') : (
                  <>
                    <CheckCircle size={14} />
                    {t('common.save')}
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="solution-header">
              <div className="solution-title-section">
                <h1 className="solution-title">{solution.title}</h1>
                <div className="solution-meta">
                  <span className="language-badge">
                    <Code size={13} />
                    {solution.language}
                  </span>
                  {solution.username && (
                    <span className="meta-item">
                      <Link to={`/users/${solution.username}`}>{solution.username}</Link>
                    </span>
                  )}
                  <span className="meta-item">
                    <Eye size={14} />
                    {solution.view_count ?? 0}
                  </span>
                  <span className="meta-item">
                    <Clock size={14} />
                    {formatDate(solution.created_at)}
                  </span>
                </div>
              </div>
              <div className="solution-actions">
                <button
                  className={`vote-btn ${isVoted ? 'voted' : ''}`}
                  onClick={handleVote}
                  disabled={!user || voting}
                >
                  <ThumbsUp size={16} />
                  {solution.vote_count ?? 0}
                </button>
                {canEdit && (
                  <button className="action-btn edit-btn" onClick={handleEdit}>
                    <Edit3 size={14} />
                    {t('common.edit')}
                  </button>
                )}
                {canDelete && (
                  <button
                    className="action-btn delete-btn"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 size={14} />
                    {t('common.delete')}
                  </button>
                )}
              </div>
            </div>

            {solution.problem_slug && (
              <div className="problem-link-section">
                <span className="link-label">{t('submissionDetail.problem')}:</span>
                <Link to={`/problems/${solution.problem_slug}`}>
                  {solution.problem_title || solution.problem_slug}
                </Link>
                <ChevronRight size={14} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
              </div>
            )}

            <div className="solution-content">
              <div
                className="markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(solution.content || '') }}
              />
            </div>
          </>
        )}
      </div>

      {showDeleteConfirm && (
        <div className="confirm-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t('common.delete')}</h3>
            <p>{t('solutions.deleteConfirm')}</p>
            <div className="confirm-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? t('common.loading') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
