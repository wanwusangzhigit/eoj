import { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { ThumbsUp, Eye, MessageSquare, Plus, ChevronRight, ArrowLeft, Clock, Code, AlertCircle } from 'lucide-react';
import ImageUploadButton from '../components/ImageUploadButton';
import Captcha from '../components/Captcha';
import type { CaptchaHandle } from '../components/Captcha';
import { t } from '../i18n';
import { useToastStore } from '../store/toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './Solutions.css';

const LANGUAGE_NAMES: Record<string, string> = {
  cpp: 'C++',
  c: 'C',
  python: 'Python',
  java: 'Java',
  javascript: 'JS',
  go: 'Go',
  rust: 'Rust',
  other: 'Other',
};

export default function Solutions() {
  const SORT_OPTIONS = [
    { value: 'newest', label: t('solutions.newest') },
    { value: 'popular', label: t('solutions.popular') },
  ];

  const LANGUAGE_OPTIONS = [
    { value: '', label: t('problemDetail.selectLanguage') },
    { value: 'cpp', label: 'C++' },
    { value: 'c', label: 'C' },
    { value: 'python', label: 'Python' },
    { value: 'java', label: 'Java' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'go', label: 'Go' },
    { value: 'rust', label: 'Rust' },
    { value: 'other', label: t('solutions.other') },
  ];
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();

  const problemId = Number(searchParams.get('problem_id'));
  const problemTitle = searchParams.get('problem_title') || '';

  const [solutions, setSolutions] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({});
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('newest');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formLanguage, setFormLanguage] = useState('');
  const [formContent, setFormContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [captchaUuid, setCaptchaUuid] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const captchaRef = useRef<CaptchaHandle>(null);
  useDocumentTitle(t('solutions.title'));

  useEffect(() => {
    if (problemId) fetchSolutions();
  }, [problemId, page, sort]);

  const fetchSolutions = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getSolutions({
        problem_id: problemId,
        page,
        pageSize: 10,
        sort,
      });
      setSolutions(data.solutions);
      setPagination(data.pagination);
    } catch (e) {
      useToastStore().addToast('error', t('common.loadError'));
      console.error('Failed to fetch solutions:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formContent.trim() || submitting) return;

    setSubmitting(true);
    setFormError('');
    try {
      await api.createSolution({
        problem_id: problemId,
        title: formTitle.trim(),
        content: formContent.trim(),
        language: formLanguage || undefined,
        captcha_uuid: captchaUuid,
        captcha_answer: captchaAnswer,
      });
      setShowForm(false);
      setFormTitle('');
      setFormLanguage('');
      setFormContent('');
      fetchSolutions();
    } catch (e: any) {
      setFormError(e.message || t('common.error'));
      if (e.message?.includes('CAPTCHA')) {
        captchaRef.current?.refresh();
      }
    } finally {
      setSubmitting(false);
    }
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

  if (!problemId) {
    return (
      <div className="solutions-page">
        <div className="solutions-empty-state">
          <Code size={48} className="empty-icon" />
          <h2>{t('solutions.noSolutions')}</h2>
          <p>{t('solutions.loginRequired')}</p>
          <Link to="/problems" className="btn btn-primary btn-sm">
            <ArrowLeft size={14} />
            {t('problemDetail.backToProblems')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="solutions-page">
      <div className="solutions-header">
        <div className="solutions-title-section">
          <Link to={`/problems/${problemId}`} className="solutions-back-btn">
            <ArrowLeft size={18} />
          </Link>
          <div className="solutions-title-info">
            <h1 className="page-title">{t('solutions.title')}</h1>
            {problemTitle && (
              <span className="solutions-problem-name">{problemTitle}</span>
            )}
          </div>
        </div>
        {user && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus size={14} />
            {t('solutions.writeSolution')}
          </button>
        )}
      </div>

      {showForm && (
        <div className="solutions-form-card">
          <div className="solutions-form-header">
            <Code size={20} className="form-icon" />
            <h2>{t('solutions.writeSolution')}</h2>
          </div>

          {formError && <div className="form-error">{formError}</div>}

          <form onSubmit={handleSubmit} className="solutions-form">
            <div className="form-group">
              <label>{t('solutions.titleField')}</label>
              <input
                type="text"
                className="form-input"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder={t('solutions.titlePlaceholder')}
                required
                maxLength={200}
              />
            </div>

            <div className="form-group">
              <label>{t('solutions.language')}</label>
              <select
                className="form-select"
                value={formLanguage}
                onChange={(e) => setFormLanguage(e.target.value)}
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>{t('solutions.contentField')}</label>
              <textarea
                className="form-textarea"
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder={t('solutions.contentPlaceholder')}
                required
                rows={10}
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
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setShowForm(false);
                  setFormError('');
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={submitting || !formTitle.trim() || !formContent.trim()}
              >
                {submitting ? t('solutions.creating') : t('solutions.submit')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="solutions-toolbar">
        <div className="solutions-sort">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`filter-btn ${sort === opt.value ? 'active' : ''}`}
              onClick={() => { setSort(opt.value); setPage(1); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="solutions-count">
          {`${pagination.total || 0} ${t('solutions.title')}`}
        </span>
      </div>

      {loading ? (
        <div className="solutions-loading">
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
        <div className="solutions-empty-state">
          <MessageSquare size={48} className="empty-icon" />
          <h2>{t('solutions.noSolutions')}</h2>
          <p>{t('solutions.noSolutionsDesc')}</p>
          {user && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowForm(true)}
            >
              <Plus size={14} />
              {t('solutions.writeSolution')}
            </button>
          )}
        </div>
      ) : (
        <div className="solutions-list">
          {solutions.map((solution) => (
            <Link
              key={solution.id}
              to={`/solutions/${solution.id}`}
              className="solution-card"
            >
              <div className="solution-card-main">
                <div className="solution-card-header">
                  <h3 className="solution-title">{solution.title}</h3>
                  {solution.language && (
                    <span className="solution-language-badge">
                      <Code size={12} />
                      {LANGUAGE_NAMES[solution.language] || solution.language}
                    </span>
                  )}
                </div>
                <div className="solution-card-meta">
                  <span className="solution-author">{solution.username || solution.author}</span>
                  <span className="solution-dot">·</span>
                  <span className="solution-date">
                    <Clock size={12} />
                    {formatRelativeTime(solution.created_at)}
                  </span>
                </div>
              </div>
              <div className="solution-card-stats">
                <span className="solution-stat" title={t('solutions.likes')}>
                  <ThumbsUp size={14} />
                  {solution.vote_count || 0}
                </span>
                <span className="solution-stat" title={t('solutions.views')}>
                  <Eye size={14} />
                  {solution.view_count || 0}
                </span>
              </div>
              <ChevronRight size={16} className="solution-arrow" />
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
