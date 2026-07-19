import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import CodeMirror from '@uiw/react-codemirror';
import ImageUploadButton from '../components/ImageUploadButton';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { useThemeStore } from '../store/theme';
import { useToastStore } from '../store/toast';
import StatusBadge from '../components/StatusBadge';
import { Send, Clock, MemoryStick, ChevronLeft, ChevronRight, Tag, Heart, CheckCircle, XCircle, AlertCircle, Users, BookOpen, MessageSquare, ThumbsUp, Eye, Plus, X, Sparkles, Flag } from 'lucide-react';
import { LANGUAGES, LANGUAGE_TEMPLATES } from '../constants';
import RatingBadge from '../components/RatingBadge';
import { renderMarkdown } from '../utils/markdown';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './ProblemDetail.css';

const DRAFT_KEY = (slug: string, lang: string) => `draft:${slug}:${lang}`;

export default function ProblemDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { theme } = useThemeStore();
  const [problem, setProblem] = useState<any>(null);
  const [sampleTestcases, setSampleTestcases] = useState<any[]>([]);
  const [language, setLanguage] = useState('python');
  const [sourceCode, setSourceCode] = useState(LANGUAGE_TEMPLATES.python);
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmissionId, setLastSubmissionId] = useState<number | null>(null);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<'none' | 'accepted' | 'attempted'>('none');
  const [stats, setStats] = useState<any>(null);
  const [recentSubmissions, setRecentSubmissions] = useState<any[]>([]);
  const [prevProblem, setPrevProblem] = useState<any>(null);
  const [nextProblem, setNextProblem] = useState<any>(null);
  useDocumentTitle(problem?.title);

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<'description' | 'solutions' | 'discussions'>('description');

  // ── Solutions state ──
  const [solutions, setSolutions] = useState<any[]>([]);
  const [solutionsPagination, setSolutionsPagination] = useState<any>({});
  const [solutionsPage, setSolutionsPage] = useState(1);
  const [solutionsSort, setSolutionsSort] = useState('newest');
  const [solutionsLoading, setSolutionsLoading] = useState(false);
  const [showSolutionForm, setShowSolutionForm] = useState(false);
  const [solutionFormTitle, setSolutionFormTitle] = useState('');
  const [solutionFormLanguage, setSolutionFormLanguage] = useState('');
  const [solutionFormContent, setSolutionFormContent] = useState('');
  const [solutionSubmitting, setSolutionSubmitting] = useState(false);

  // ── Discussions state ──
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [discussionsPagination, setDiscussionsPagination] = useState<any>(null);
  const [discussionsPage, setDiscussionsPage] = useState(1);
  const [discussionsCategory, setDiscussionsCategory] = useState('all');
  const [discussionsSort, setDiscussionsSort] = useState('newest');
  const [discussionsLoading, setDiscussionsLoading] = useState(false);
  const [showDiscussionForm, setShowDiscussionForm] = useState(false);
  const [discussionFormTitle, setDiscussionFormTitle] = useState('');
  const [discussionFormCategory, setDiscussionFormCategory] = useState('general');
  const [discussionFormContent, setDiscussionFormContent] = useState('');
  const [discussionSubmitting, setDiscussionSubmitting] = useState(false);

  // Ref for polling cleanup (Bug 2 fix)
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // ── AI completion state ──
  const [aiCompleting, setAiCompleting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiAllowedModels, setAiAllowedModels] = useState<{ model: string; display_name: string }[]>([]);
  const [aiSelectedModel, setAiSelectedModel] = useState<string>('');

  // ── Report modal state ──
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportType, setReportType] = useState('typo');
  const [reportDescription, setReportDescription] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  // ── Fetch problem on slug change (Bug 8 fix: separate effects) ──

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setLoadError('');
    api.getProblem(slug)
      .then((data) => {
        if (!isMountedRef.current) return;
        setProblem(data.problem);
        setSampleTestcases(data.sampleTestcases);
        setStats(data.stats);
      })
      .catch((e) => {
        if (!isMountedRef.current) return;
        setLoadError(e.message || t('problemDetail.loadError'));
      })
      .finally(() => {
        if (isMountedRef.current) setLoading(false);
      });
  }, [slug]);

  // ── Fetch user-specific data when user + problem are available ──

  useEffect(() => {
    if (!user || !problem?.id) return;

    // Check favorite status
    api.checkFavorite(problem.id)
      .then((result) => {
        if (isMountedRef.current) setIsFavorited(result.is_favorited);
      })
      .catch((e) => console.error('Failed to check favorite:', e));

    // Check submission status — single API call (Bug 3 fix)
    api.getProblemStatus(problem.id)
      .then((result) => {
        if (!isMountedRef.current) return;
        if (result.solved) {
          setSubmissionStatus('accepted');
        } else if (result.attempted) {
          setSubmissionStatus('attempted');
        } else {
          setSubmissionStatus('none');
        }
      })
      .catch((e) => console.error('Failed to check submission status:', e));

    // Fetch recent submissions
    api.getSubmissions({ problem_id: String(problem.id), pageSize: 5 })
      .then((data) => {
        if (isMountedRef.current) setRecentSubmissions(data.submissions);
      })
      .catch((e) => console.error('Failed to fetch recent submissions:', e));
  }, [user, problem?.id]);

  // Fetch prev/next problem navigation
  useEffect(() => {
    if (!problem?.id) return;
    api.getProblems({ pageSize: 200 }).then((data) => {
      const problems = data.problems;
      const idx = problems.findIndex((p: any) => p.id === problem.id);
      setPrevProblem(idx > 0 ? problems[idx - 1] : null);
      setNextProblem(idx < problems.length - 1 ? problems[idx + 1] : null);
    }).catch(() => {});
  }, [problem?.id]);

  // ── Fetch solutions when tab is active ──
  useEffect(() => {
    if (activeTab !== 'solutions' || !problem?.id) return;
    const fetchSolutions = async () => {
      setSolutionsLoading(true);
      try {
        const data = await api.getSolutions({
          problem_id: problem.id,
          page: solutionsPage,
          pageSize: 10,
          sort: solutionsSort,
        });
        if (isMountedRef.current) {
          setSolutions(data.solutions);
          setSolutionsPagination(data.pagination);
        }
      } catch (e) {
        console.error('Failed to fetch solutions:', e);
      } finally {
        if (isMountedRef.current) setSolutionsLoading(false);
      }
    };
    fetchSolutions();
  }, [activeTab, problem?.id, solutionsPage, solutionsSort]);

  // ── Fetch discussions when tab is active ──
  useEffect(() => {
    if (activeTab !== 'discussions' || !problem?.id) return;
    const fetchDiscussions = async () => {
      setDiscussionsLoading(true);
      try {
        const params: any = {
          problem_id: problem.id,
          page: discussionsPage,
          pageSize: 20,
          sort: discussionsSort,
        };
        if (discussionsCategory !== 'all') {
          params.category = discussionsCategory;
        }
        const data = await api.getDiscussions(params);
        if (isMountedRef.current) {
          setDiscussions(data.discussions || []);
          setDiscussionsPagination(data.pagination || null);
        }
      } catch (e) {
        console.error('Failed to fetch discussions:', e);
      } finally {
        if (isMountedRef.current) setDiscussionsLoading(false);
      }
    };
    fetchDiscussions();
  }, [activeTab, problem?.id, discussionsPage, discussionsCategory, discussionsSort]);

  // ── Solution form submit ──
  const handleSolutionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problem?.id || !solutionFormTitle.trim() || !solutionFormContent.trim() || solutionSubmitting) return;
    setSolutionSubmitting(true);
    try {
      await api.createSolution({
        problem_id: problem.id,
        title: solutionFormTitle.trim(),
        content: solutionFormContent.trim(),
        language: solutionFormLanguage || undefined,
      });
      setShowSolutionForm(false);
      setSolutionFormTitle('');
      setSolutionFormLanguage('');
      setSolutionFormContent('');
      // Re-fetch solutions
      setSolutionsPage(1);
      const data = await api.getSolutions({ problem_id: problem.id, page: 1, pageSize: 10, sort: solutionsSort });
      setSolutions(data.solutions);
      setSolutionsPagination(data.pagination);
    } catch (e: any) {
      useToastStore.getState().addToast('error', e.message || t('common.error'));
    } finally {
      if (isMountedRef.current) setSolutionSubmitting(false);
    }
  };

  // ── Discussion form submit ──
  const handleDiscussionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problem?.id || !discussionFormTitle.trim() || !discussionFormContent.trim() || discussionSubmitting) return;
    setDiscussionSubmitting(true);
    try {
      await api.createDiscussion({
        problem_id: problem.id,
        title: discussionFormTitle.trim(),
        content: discussionFormContent.trim(),
        category: discussionFormCategory,
      });
      setShowDiscussionForm(false);
      setDiscussionFormTitle('');
      setDiscussionFormCategory('general');
      setDiscussionFormContent('');
      // Re-fetch discussions
      setDiscussionsPage(1);
      const params: any = { problem_id: problem.id, page: 1, pageSize: 20, sort: discussionsSort };
      if (discussionsCategory !== 'all') params.category = discussionsCategory;
      const data = await api.getDiscussions(params);
      setDiscussions(data.discussions || []);
      setDiscussionsPagination(data.pagination || null);
    } catch (e: any) {
      useToastStore.getState().addToast('error', e.message || t('common.error'));
    } finally {
      if (isMountedRef.current) setDiscussionSubmitting(false);
    }
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
    return date.toLocaleDateString();
  };

  const LANGUAGE_BADGE: Record<string, string> = {
    cpp: 'C++', c: 'C', python: 'Python', java: 'Java', javascript: 'JS', go: 'Go', rust: 'Rust', other: t('solutions.other'),
  };

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

  const getCategoryLabel = (category: string) => {
    if (category === 'question') return t('discussions.question');
    if (category === 'share') return t('discussions.share');
    return t('discussions.general');
  };

  // ── Restore draft from localStorage (Bug 6 fix) ──

  useEffect(() => {
    if (!slug) return;
    const savedDraft = localStorage.getItem(DRAFT_KEY(slug, language));
    if (savedDraft) {
      setSourceCode(savedDraft);
    } else {
      setSourceCode(LANGUAGE_TEMPLATES[language] || '');
    }
  }, [slug, language]);

  // ── Auto-save draft to localStorage (Bug 6 fix) ──

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSourceCodeChange = useCallback((value: string) => {
    setSourceCode(value);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (slug) {
        localStorage.setItem(DRAFT_KEY(slug, language), value);
      }
    }, 500);
  }, [slug, language]);

  // ── Cleanup on unmount (Bug 2 fix) ──

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollingRef.current) clearTimeout(pollingRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const toggleFavorite = async () => {
    if (!user || !problem?.id || favoriteLoading) return;
    setFavoriteLoading(true);
    try {
      if (isFavorited) {
        await api.removeFavorite(problem.id);
        setIsFavorited(false);
      } else {
        await api.addFavorite(problem.id);
        setIsFavorited(true);
      }
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    } finally {
      if (isMountedRef.current) setFavoriteLoading(false);
    }
  };

  const openReportModal = () => {
    if (!user) {
      navigate('/login');
      return;
    }
    setReportType('typo');
    setReportDescription('');
    setShowReportModal(true);
  };

  const submitReport = async () => {
    if (!problem?.id) return;
    if (!reportDescription.trim()) {
      addToast('error', t('reports.description'));
      return;
    }
    setReportSubmitting(true);
    try {
      await api.createProblemReport(problem.id, reportType, reportDescription.trim());
      addToast('success', t('reports.reportSubmitted'));
      setShowReportModal(false);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      if (isMountedRef.current) setReportSubmitting(false);
    }
  };

  const handleLanguageChange = (lang: string) => {
    const isTemplate = Object.values(LANGUAGE_TEMPLATES).some(tmpl => tmpl === sourceCode);
    if (isTemplate) {
      setSourceCode(LANGUAGE_TEMPLATES[lang] || '');
    }
    setLanguage(lang);
  };

  const handleSubmit = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!problem || submitting) return;

    setSubmitting(true);
    setLastStatus('pending');
    try {
      const result = await api.submitCode({
        problem_id: problem.id,
        language,
        source_code: sourceCode,
      });
      setLastSubmissionId(result.submission_id);
      pollSubmission(result.submission_id);
      // Clear draft after successful submission (Bug 6 fix)
      if (slug) localStorage.removeItem(DRAFT_KEY(slug, language));
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
      setLastStatus(null);
    } finally {
      if (isMountedRef.current) setSubmitting(false);
    }
  };

  // ── AI code completion ──

  // Fetch AI status on mount to get allowed models
  useEffect(() => {
    let cancelled = false;
    api.aiStatus().then((data) => {
      if (!cancelled && data.allowed_models && data.allowed_models.length > 0) {
        setAiAllowedModels(data.allowed_models);
        setAiSelectedModel(data.allowed_models[0].model);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleAIComplete = async () => {
    if (aiCompleting || !problem) return;
    setAiCompleting(true);
    setAiSuggestion(null);
    try {
      const result = await api.aiComplete({
        code: sourceCode,
        language,
        problem_title: problem.title,
        problem_description: problem.description,
        instruction: aiInstruction || undefined,
        model: aiSelectedModel || undefined,
      });
      if (isMountedRef.current) {
        setAiSuggestion(result.content);
      }
    } catch (e: any) {
      useToastStore.getState().addToast('error', e.message || t('ai.error'));
    } finally {
      if (isMountedRef.current) setAiCompleting(false);
    }
  };

  const applyAISuggestion = () => {
    if (aiSuggestion) {
      handleSourceCodeChange(aiSuggestion);
      setAiSuggestion(null);
      setAiInstruction('');
    }
  };

  // ── Polling with cleanup (Bug 2 fix) ──

  const pollSubmission = useCallback((id: number) => {
    const maxAttempts = 120;
    let attempts = 0;

    const poll = async () => {
      if (!isMountedRef.current) return;
      try {
        const data = await api.getSubmission(id);
        if (!isMountedRef.current) return;
        const status = data.submission.status;
        setLastStatus(status);

        if (status !== 'pending' && status !== 'running') {
          if (status === 'accepted') {
            setSubmissionStatus('accepted');
          } else {
            setSubmissionStatus((prev) => prev === 'none' ? 'attempted' : prev);
          }
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          pollingRef.current = setTimeout(poll, 1500);
        }
      } catch {
        attempts++;
        if (attempts < maxAttempts && isMountedRef.current) {
          pollingRef.current = setTimeout(poll, 2000);
        }
      }
    };

    poll();
  }, []);

  // ── Ctrl+Enter shortcut (Bug 7 fix) ──

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSubmit, submitting, problem, user, sourceCode, language]);

  const getLangExtension = (lang: string) => {
    switch (lang) {
      case 'python': return python();
      case 'cpp': return cpp();
      case 'java': return java();
      case 'javascript': return javascript();
      default: return python();
    }
  };

  const getStatusIcon = () => {
    switch (submissionStatus) {
      case 'accepted':
        return <CheckCircle size={20} className="status-icon accepted" />;
      case 'attempted':
        return <AlertCircle size={20} className="status-icon attempted" />;
      default:
        return <XCircle size={20} className="status-icon none" />;
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>{t('problemDetail.loadingProblem')}</p>
      </div>
    );
  }

  if (loadError || !problem) {
    return (
      <div className="empty-container">
        <AlertCircle size={48} style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
        <h2>{loadError || t('problemDetail.problemNotFound')}</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {loadError && slug && (
            <button className="btn btn-secondary" onClick={() => {
              setLoadError('');
              setLoading(true);
              api.getProblem(slug)
                .then(d => { setProblem(d.problem); setSampleTestcases(d.sampleTestcases); setStats(d.stats); })
                .catch(e => setLoadError(e.message || t('problemDetail.loadError')))
                .finally(() => setLoading(false));
            }}>
              {t('common.retry')}
            </button>
          )}
          <Link to="/" className="btn btn-primary">{t('problemDetail.backToProblems')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="problem-detail-page">
      <div className="problem-info">
        <div className="breadcrumb">
          <Link to="/">{t('problemList.title')}</Link>
          <ChevronRight size={14} />
          <span>{problem.title}</span>
        </div>

        <div className="problem-nav">
          {prevProblem ? (
            <Link to={`/problems/${prevProblem.slug}`} className="nav-btn prev">
              <ChevronLeft size={16} /> #{prevProblem.id} {prevProblem.title}
            </Link>
          ) : <span />}
          {nextProblem ? (
            <Link to={`/problems/${nextProblem.slug}`} className="nav-btn next">
              #{nextProblem.id} {nextProblem.title} <ChevronRight size={16} />
            </Link>
          ) : <span />}
        </div>

        <div className="problem-header">
          <div className="problem-title-section">
            <h1 className="problem-title">
              {problem.title}
              {problem.judge_type === 'spj' && (
                <span className="spj-badge" style={{
                  display: 'inline-block',
                  marginLeft: '8px',
                  padding: '2px 8px',
                  fontSize: '12px',
                  fontWeight: '600',
                  borderRadius: '4px',
                  background: 'var(--color-primary, #3b82f6)',
                  color: '#fff',
                  verticalAlign: 'middle',
                }}>
                  {t('admin.spjBadge')}
                </span>
              )}
            </h1>
            <div className="problem-status">
              {getStatusIcon()}
              <span className={`status-text ${submissionStatus}`}>
                {submissionStatus === 'accepted' ? t('problemDetail.solved') : submissionStatus === 'attempted' ? t('problemDetail.attempted') : t('problemDetail.notStarted')}
              </span>
            </div>
          </div>
          <div className="problem-actions">
            {problem.rating && problem.rating >= 800 ? (
              <RatingBadge rating={problem.rating} size="lg" />
            ) : (
              <div
                className="difficulty-badge"
                data-difficulty={problem.difficulty || ''}
              >
                {problem.difficulty}
              </div>
            )}
            <Link
              to={`/solutions?problem_id=${problem.id}&problem_title=${encodeURIComponent(problem.title)}`}
              className="action-btn-outline"
              title={t('solutions.title')}
            >
              <BookOpen size={16} />
            </Link>
            <Link
              to={`/discussions?problem_id=${problem.id}&problem_title=${encodeURIComponent(problem.title)}`}
              className="action-btn-outline"
              title={t('discussions.title')}
            >
              <MessageSquare size={16} />
            </Link>
            {user && (
              <button
                className={`favorite-btn ${isFavorited ? 'active' : ''}`}
                onClick={toggleFavorite}
                disabled={favoriteLoading}
                title={isFavorited ? t('problemDetail.removeFromFavorites') : t('problemDetail.addToFavorites')}
              >
                <Heart size={18} fill={isFavorited ? 'currentColor' : 'none'} />
              </button>
            )}
            {user && (
              <button
                className="action-btn-outline"
                onClick={openReportModal}
                title={t('reports.reportProblem')}
              >
                <Flag size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="problem-meta">
          <span className="meta-item">
            <Clock size={14} /> {t('problemDetail.timeLimit')}: {problem.time_limit}ms
          </span>
          <span className="meta-item">
            <MemoryStick size={14} /> {t('problemDetail.memoryLimit')}: {problem.memory_limit}MB
          </span>
          {stats && (
            <>
              <span className="meta-item">
                <Users size={14} /> {t('problemDetail.submissions')}: {stats.submission_count || 0}
              </span>
              <span className="meta-item">
                <CheckCircle size={14} /> {t('problemDetail.accepted')}: {stats.accepted_count || 0}
              </span>
              <span className={`meta-item pass-rate ${stats.pass_rate != null ? (stats.pass_rate >= 0.6 ? 'high' : stats.pass_rate >= 0.3 ? 'medium' : 'low') : ''}`}>
                {t('problemDetail.passRate')}: {stats.pass_rate != null ? `${Math.round(stats.pass_rate * 100)}%` : 'N/A'}
              </span>
            </>
          )}
          {(() => {
            try {
              return JSON.parse(problem.tags || '[]').map((t: string) => (
                <span key={t} className="tag-chip small">
                  <Tag size={10} /> {t}
                </span>
              ));
            } catch { return null; }
          })()}
        </div>

        <div className="problem-description">
          <h3>{t('problemDetail.description')}</h3>
          <div className="markdown-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(problem.description) }} />

          {problem.input_format && (
            <>
              <h3>{t('problemDetail.inputFormat')}</h3>
              <div className="markdown-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(problem.input_format) }} />
            </>
          )}

          {problem.output_format && (
            <>
              <h3>{t('problemDetail.outputFormat')}</h3>
              <div className="markdown-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(problem.output_format) }} />
            </>
          )}

          {sampleTestcases.map((tc, idx) => (
            <div key={tc.id} className="sample-case">
              <h4>{t('problemDetail.sample')} {idx + 1}</h4>
              <div className="sample-pair">
                <div className="sample-box">
                  <label>{t('problemDetail.input')}</label>
                  <pre>{tc.input}</pre>
                </div>
                <div className="sample-box">
                  <label>{t('problemDetail.output')}</label>
                  <pre>{tc.expected_output}</pre>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tab Navigation ── */}
        <div className="problem-tabs">
          <button
            className={`problem-tab ${activeTab === 'description' ? 'active' : ''}`}
            onClick={() => setActiveTab('description')}
          >
            <BookOpen size={14} />
            {t('problemDetail.tabDescription')}
          </button>
          <button
            className={`problem-tab ${activeTab === 'solutions' ? 'active' : ''}`}
            onClick={() => setActiveTab('solutions')}
          >
            <ThumbsUp size={14} />
            {t('problemDetail.tabSolutions')}
          </button>
          <button
            className={`problem-tab ${activeTab === 'discussions' ? 'active' : ''}`}
            onClick={() => setActiveTab('discussions')}
          >
            <MessageSquare size={14} />
            {t('problemDetail.tabDiscussions')}
          </button>
        </div>

        {/* ── Solutions Tab Content ── */}
        {activeTab === 'solutions' && (
          <div className="tab-content solutions-tab-content">
            <div className="tab-content-toolbar">
              <div className="tab-sort-buttons">
                <button
                  className={`filter-btn ${solutionsSort === 'newest' ? 'active' : ''}`}
                  onClick={() => { setSolutionsSort('newest'); setSolutionsPage(1); }}
                >
                  {t('solutions.newest')}
                </button>
                <button
                  className={`filter-btn ${solutionsSort === 'popular' ? 'active' : ''}`}
                  onClick={() => { setSolutionsSort('popular'); setSolutionsPage(1); }}
                >
                  {t('solutions.popular')}
                </button>
              </div>
              {user && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowSolutionForm(!showSolutionForm)}
                >
                  <Plus size={14} />
                  {t('problemDetail.writeSolution')}
                </button>
              )}
            </div>

            {showSolutionForm && (
              <div className="inline-form-card">
                <div className="inline-form-header">
                  <BookOpen size={18} />
                  <h3>{t('problemDetail.writeSolution')}</h3>
                  <button className="inline-form-close" onClick={() => setShowSolutionForm(false)}>
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleSolutionSubmit} className="inline-form">
                  <div className="form-group">
                    <label>{t('problemDetail.solutionTitle')}</label>
                    <input
                      type="text"
                      className="form-input"
                      value={solutionFormTitle}
                      onChange={(e) => setSolutionFormTitle(e.target.value)}
                      placeholder={t('problemDetail.solutionTitlePlaceholder')}
                      required
                      maxLength={200}
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('problemDetail.solutionLanguage')}</label>
                    <select
                      className="form-select"
                      value={solutionFormLanguage}
                      onChange={(e) => setSolutionFormLanguage(e.target.value)}
                    >
                      {LANGUAGE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{t('problemDetail.solutionContent')}</label>
                    <textarea
                      className="form-textarea"
                      value={solutionFormContent}
                      onChange={(e) => setSolutionFormContent(e.target.value)}
                      placeholder={t('problemDetail.solutionContentPlaceholder')}
                      required
                      rows={8}
                    />
                    <div style={{marginTop:'4px'}}>
                      <ImageUploadButton onInsert={(md) => setSolutionFormContent(prev => prev + (prev ? '\n' : '') + md)} />
                    </div>
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowSolutionForm(false)}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={solutionSubmitting || !solutionFormTitle.trim() || !solutionFormContent.trim()}
                    >
                      {solutionSubmitting ? t('problemDetail.submittingSolution') : t('problemDetail.submitSolution')}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {solutionsLoading ? (
              <div className="tab-loading">
                <div className="loading-spinner" />
                <span>{t('common.loading')}</span>
              </div>
            ) : solutions.length === 0 ? (
              <div className="tab-empty">
                <MessageSquare size={36} />
                <p>{t('solutions.noSolutions')}</p>
                {user && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowSolutionForm(true)}>
                    <Plus size={14} />
                    {t('problemDetail.writeSolution')}
                  </button>
                )}
              </div>
            ) : (
              <div className="inline-list">
                {solutions.map((solution) => (
                  <Link
                    key={solution.id}
                    to={`/solutions/${solution.id}`}
                    className="inline-card solution-inline-card"
                  >
                    <div className="inline-card-main">
                      <div className="inline-card-header">
                        <h4 className="inline-card-title">{solution.title}</h4>
                        {solution.language && (
                          <span className="language-badge">
                            {LANGUAGE_BADGE[solution.language] || solution.language}
                          </span>
                        )}
                      </div>
                      <div className="inline-card-meta">
                        <span className="inline-card-author">{solution.username || solution.author}</span>
                        <span className="inline-card-dot">·</span>
                        <span className="inline-card-date">
                          <Clock size={12} />
                          {formatRelativeTime(solution.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="inline-card-stats">
                      <span className="inline-stat" title={t('solutions.likes')}>
                        <ThumbsUp size={14} />
                        {solution.vote_count || 0}
                      </span>
                      <span className="inline-stat" title={t('solutions.views')}>
                        <Eye size={14} />
                        {solution.view_count || 0}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {solutionsPagination.totalPages > 1 && (
              <div className="tab-pagination">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={solutionsPage <= 1}
                  onClick={() => setSolutionsPage(solutionsPage - 1)}
                >
                  {t('common.previous')}
                </button>
                <span className="page-info">
                  {t('common.page').replace('{0}', String(solutionsPage)).replace('{1}', String(solutionsPagination.totalPages))}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={solutionsPage >= solutionsPagination.totalPages}
                  onClick={() => setSolutionsPage(solutionsPage + 1)}
                >
                  {t('common.next')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Discussions Tab Content ── */}
        {activeTab === 'discussions' && (
          <div className="tab-content discussions-tab-content">
            <div className="tab-content-toolbar">
              <div className="tab-filter-group">
                <Tag size={14} />
                {['all', 'question', 'share', 'general'].map((cat) => (
                  <button
                    key={cat}
                    className={`filter-btn ${discussionsCategory === cat ? 'active' : ''}`}
                    onClick={() => { setDiscussionsCategory(cat); setDiscussionsPage(1); }}
                  >
                    {cat === 'all' ? t('discussions.all') : getCategoryLabel(cat)}
                  </button>
                ))}
                <span className="filter-separator">|</span>
                <button
                  className={`filter-btn ${discussionsSort === 'newest' ? 'active' : ''}`}
                  onClick={() => { setDiscussionsSort('newest'); setDiscussionsPage(1); }}
                >
                  {t('discussions.newest')}
                </button>
                <button
                  className={`filter-btn ${discussionsSort === 'active' ? 'active' : ''}`}
                  onClick={() => { setDiscussionsSort('active'); setDiscussionsPage(1); }}
                >
                  {t('discussions.active')}
                </button>
              </div>
              {user && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowDiscussionForm(!showDiscussionForm)}
                >
                  <Plus size={14} />
                  {t('problemDetail.newDiscussion')}
                </button>
              )}
            </div>

            {showDiscussionForm && (
              <div className="inline-form-card">
                <div className="inline-form-header">
                  <MessageSquare size={18} />
                  <h3>{t('problemDetail.newDiscussion')}</h3>
                  <button className="inline-form-close" onClick={() => setShowDiscussionForm(false)}>
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={handleDiscussionSubmit} className="inline-form">
                  <div className="form-group">
                    <label>{t('problemDetail.discussionTitle')}</label>
                    <input
                      type="text"
                      className="form-input"
                      value={discussionFormTitle}
                      onChange={(e) => setDiscussionFormTitle(e.target.value)}
                      placeholder={t('problemDetail.discussionTitlePlaceholder')}
                      required
                      maxLength={200}
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('problemDetail.discussionCategory')}</label>
                    <select
                      className="form-select"
                      value={discussionFormCategory}
                      onChange={(e) => setDiscussionFormCategory(e.target.value)}
                    >
                      <option value="question">{getCategoryLabel('question')}</option>
                      <option value="share">{getCategoryLabel('share')}</option>
                      <option value="general">{getCategoryLabel('general')}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{t('problemDetail.discussionContent')}</label>
                    <textarea
                      className="form-textarea"
                      value={discussionFormContent}
                      onChange={(e) => setDiscussionFormContent(e.target.value)}
                      placeholder={t('problemDetail.discussionContentPlaceholder')}
                      required
                      rows={8}
                    />
                    <div style={{marginTop:'4px'}}>
                      <ImageUploadButton onInsert={(md) => setDiscussionFormContent(prev => prev + (prev ? '\n' : '') + md)} />
                    </div>
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowDiscussionForm(false)}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={discussionSubmitting || !discussionFormTitle.trim() || !discussionFormContent.trim()}
                    >
                      {discussionSubmitting ? t('problemDetail.submittingDiscussion') : t('problemDetail.submitDiscussion')}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {discussionsLoading ? (
              <div className="tab-loading">
                <div className="loading-spinner" />
                <span>{t('common.loading')}</span>
              </div>
            ) : discussions.length === 0 ? (
              <div className="tab-empty">
                <MessageSquare size={36} />
                <p>{t('discussions.noDiscussions')}</p>
                {user && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowDiscussionForm(true)}>
                    <Plus size={14} />
                    {t('problemDetail.newDiscussion')}
                  </button>
                )}
              </div>
            ) : (
              <div className="inline-list">
                {discussions.map((discussion) => (
                  <Link
                    key={discussion.id}
                    to={`/discussions/${discussion.id}`}
                    className={`inline-card discussion-inline-card${discussion.is_pinned ? ' pinned' : ''}`}
                  >
                    <div className="inline-card-stats-col">
                      <span className="inline-stat" title={t('discussions.replies')}>
                        <MessageSquare size={14} />
                        {discussion.reply_count ?? 0}
                      </span>
                      <span className="inline-stat" title={t('discussions.views')}>
                        <Eye size={14} />
                        {discussion.view_count ?? 0}
                      </span>
                    </div>
                    <div className="inline-card-main">
                      <div className="inline-card-header">
                        <h4 className="inline-card-title">{discussion.title}</h4>
                        <span className={`category-badge ${discussion.category || 'general'}`}>
                          {getCategoryLabel(discussion.category)}
                        </span>
                      </div>
                      <div className="inline-card-meta">
                        <span className="inline-card-author">{discussion.username || discussion.user_id}</span>
                        <span className="inline-card-dot">·</span>
                        <span className="inline-card-date">
                          <Clock size={12} />
                          {formatRelativeTime(discussion.created_at)}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {discussionsPagination && discussionsPagination.total_pages > 1 && (
              <div className="tab-pagination">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={discussionsPage <= 1}
                  onClick={() => setDiscussionsPage(discussionsPage - 1)}
                >
                  {t('common.previous')}
                </button>
                <span className="page-info">
                  {t('common.page').replace('{0}', String(discussionsPage)).replace('{1}', String(discussionsPagination.total_pages))}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={discussionsPage >= discussionsPagination.total_pages}
                  onClick={() => setDiscussionsPage(discussionsPage + 1)}
                >
                  {t('common.next')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {activeTab === 'description' && (
        <div className="code-panel">
        <div className="code-header">
          <select
            className="language-select"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>

          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            {aiAllowedModels.length > 0 && (
              <select
                className="language-select"
                value={aiSelectedModel}
                onChange={(e) => setAiSelectedModel(e.target.value)}
                title={t('ai.selectModel')}
                style={{fontSize:'12px',maxWidth:'160px'}}
              >
                {aiAllowedModels.map((m) => (
                  <option key={m.model} value={m.model}>{m.display_name}</option>
                ))}
              </select>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleAIComplete}
              disabled={aiCompleting}
              title={t('ai.completeCode')}
            >
              <Sparkles size={14} />
              {aiCompleting ? t('ai.completing') : t('ai.completeCode')}
            </button>

            <button
              className={`btn btn-primary ${submitting ? 'btn-loading' : ''}`}
              onClick={handleSubmit}
              disabled={submitting}
              title="Ctrl+Enter"
            >
              <Send size={14} />
              {submitting ? t('problemDetail.submitting') : t('problemDetail.submit')}
            </button>
          </div>
        </div>

        {aiCompleting && (
          <div style={{padding:'8px 12px',display:'flex',alignItems:'center',gap:'8px',color:'var(--text-secondary)',fontSize:'14px'}}>
            <div className="loading-spinner" style={{width:'16px',height:'16px',borderWidth:'2px'}} />
            {t('ai.thinking')}
          </div>
        )}

        {aiSuggestion !== null && (
          <div style={{padding:'12px',borderBottom:'1px solid var(--border-color)',background:'var(--bg-hover)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
              <span style={{fontWeight:'600',fontSize:'14px',display:'flex',alignItems:'center',gap:'6px'}}>
                <Sparkles size={14} />
                {t('ai.aiSuggestion')}
              </span>
              <div style={{display:'flex',gap:'8px'}}>
                <button className="btn btn-secondary btn-sm" onClick={() => setAiSuggestion(null)}>
                  {t('ai.dismiss')}
                </button>
                <button className="btn btn-primary btn-sm" onClick={applyAISuggestion}>
                  {t('ai.applyCode')}
                </button>
              </div>
            </div>
            <pre style={{margin:0,maxHeight:'300px',overflow:'auto',fontSize:'13px',lineHeight:'1.5',background:'var(--bg-code)',padding:'12px',borderRadius:'8px'}}>
              {aiSuggestion}
            </pre>
          </div>
        )}

        <div className="editor-wrapper">
          <CodeMirror
            value={sourceCode}
            height="400px"
            theme={theme === 'dark' ? oneDark : undefined}
            extensions={[getLangExtension(language)]}
            onChange={handleSourceCodeChange}
          />
        </div>

        {lastStatus && (
          <div className="submit-result">
            {lastSubmissionId && (
              <Link to={`/submissions/${lastSubmissionId}`} className="result-link">
                {t('problemDetail.viewSubmission')} #{lastSubmissionId}
              </Link>
            )}
            <StatusBadge status={lastStatus} />
          </div>
        )}

        {user && recentSubmissions.length > 0 && (
          <div className="recent-submissions">
            <h3>{t('problemDetail.recentSubmissions')}</h3>
            <div className="recent-submissions-list">
              {recentSubmissions.map((sub: any) => (
                <Link key={sub.id} to={`/submissions/${sub.id}`} className="recent-submission-item">
                  <StatusBadge status={sub.status} />
                  <span className="submission-lang">{sub.language}</span>
                  <span className="submission-time">{new Date(sub.created_at).toLocaleString()}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
        </div>
      )}

      {showReportModal && (
        <div className="modal-overlay" onClick={() => !reportSubmitting && setShowReportModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('reports.reportProblem')}</h2>
              <button className="modal-close" onClick={() => setShowReportModal(false)} disabled={reportSubmitting}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{t('reports.reportType')}</label>
                <select
                  className="form-input"
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  disabled={reportSubmitting}
                >
                  <option value="typo">{t('reports.typo')}</option>
                  <option value="wrong_answer">{t('reports.wrong_answer')}</option>
                  <option value="ambiguous">{t('reports.ambiguous')}</option>
                  <option value="missing_data">{t('reports.missing_data')}</option>
                  <option value="other">{t('reports.other')}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('reports.description')}</label>
                <textarea
                  className="form-textarea"
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  placeholder={t('reports.descriptionPlaceholder')}
                  rows={5}
                  disabled={reportSubmitting}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowReportModal(false)} disabled={reportSubmitting}>
                {t('reports.cancel')}
              </button>
              <button className="btn btn-primary" onClick={submitReport} disabled={reportSubmitting}>
                {reportSubmitting ? t('common.loading') : t('reports.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
