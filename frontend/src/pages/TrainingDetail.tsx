import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { GraduationCap, ChevronDown, ChevronRight, CheckCircle2, Circle, AlertCircle, ArrowLeft } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { useSSRPage } from '../ssr/useSSRPage';
import './Training.css';

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: '#52c41a',
  intermediate: '#ff7c00',
  advanced: '#fe2c55',
};

// SSR 注入数据(对应 backend/src/loaders.ts 中 trainingDetail loader 的返回)
interface TrainingDetailSSRData {
  plan?: { plan?: any; chapters?: any[] };
}

export default function TrainingDetail() {
  const { id } = useParams<{ id: string }>();
  const planId = parseInt(id || '0');
  const ssr = useSSRPage<TrainingDetailSSRData>('trainingDetail');
  const firstRunRef = useRef<boolean>(true);
  const [plan, setPlan] = useState<any>(ssr?.plan?.plan ?? null);
  const [loading, setLoading] = useState(!ssr);
  const [loadError, setLoadError] = useState(false);
  // 默认展开所有章节(SSR 命中时直接用注入数据初始化)
  const [expandedChapters, setExpandedChapters] = useState<Record<number, boolean>>(() => {
    const exp: Record<number, boolean> = {};
    (ssr?.plan?.plan?.chapters || []).forEach((ch: any) => { exp[ch.id] = true; });
    return exp;
  });
  const [progress, setProgress] = useState<{ completed: number; total: number; percent: number } | null>(null);
  const [joining, setJoining] = useState(false);
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  useDocumentTitle(plan?.title || t('training.title'));

  const fetchPlan = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getTrainingPlan(planId);
      setPlan(data.plan);
      // 默认展开所有章节
      const expanded: Record<number, boolean> = {};
      (data.plan?.chapters || []).forEach((ch: any) => { expanded[ch.id] = true; });
      setExpandedChapters(expanded);
    } catch (e) {
      console.error('Failed to fetch training plan:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  const fetchProgress = useCallback(async () => {
    try {
      const data = await api.getTrainingProgress(planId);
      setProgress(data);
    } catch {
      // 未加入计划时可能 404，忽略
    }
  }, [planId]);

  useEffect(() => {
    // SSR 已注入数据则跳过首次拉取(避免重复请求与首屏闪烁)
    if (ssr && firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    firstRunRef.current = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    fetchPlan();
    if (user) fetchProgress();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fetchPlan, fetchProgress, user, ssr]);

  const toggleChapter = (chapterId: number) => {
    setExpandedChapters((prev) => ({ ...prev, [chapterId]: !prev[chapterId] }));
  };

  const handleJoin = async () => {
    setJoining(true);
    try {
      await api.joinTraining(planId);
      await fetchProgress();
      addToast('success', t('training.joined'));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setJoining(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  if (loadError || !plan) {
    return (
      <div className="training-detail-page">
        <EmptyError
          message={t('training.planNotFound')}
          onRetry={fetchPlan}
        />
      </div>
    );
  }

  const isJoined = !!progress;
  const percent = progress?.percent || 0;

  return (
    <div className="training-detail-page">
      <Link to="/training" className="back-link">
        <ArrowLeft size={16} />
        {t('training.backToPlans')}
      </Link>

      <div className="training-detail-header">
        <h1>{plan.title}</h1>
        <div className="meta-row">
          <span
            className="difficulty-tag"
            style={{ color: DIFFICULTY_COLORS[plan.difficulty] || '#999', borderColor: DIFFICULTY_COLORS[plan.difficulty] || '#999' }}
          >
            {t(`training.${plan.difficulty}`)}
          </span>
          {plan.is_official ? <span className="official-badge">{t('training.official')}</span> : null}
          <span>作者: {plan.username}</span>
        </div>
        {plan.description && <p className="plan-desc">{plan.description}</p>}

        {user && (
          <div className="training-actions">
            {isJoined ? (
              <>
                <div className="progress-section" style={{ flex: 1 }}>
                  <div className="progress-bar">
                    <div className="progress-bar-inner" style={{ width: `${percent}%` }} />
                  </div>
                  <span className="progress-text">
                    {t('training.progressLabel').replace('{0}', String(progress?.completed || 0)).replace('{1}', String(progress?.total || 0))} ({percent}%)
                  </span>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={fetchProgress}>
                  {t('common.refreshPage')}
                </button>
              </>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleJoin} disabled={joining}>
                <GraduationCap size={14} />
                {joining ? t('common.loading') : t('training.joinTraining')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="chapter-list">
        {plan.chapters?.length ? (
          plan.chapters.map((chapter: any) => (
            <div key={chapter.id} className="chapter-item">
              <div className="chapter-header" onClick={() => toggleChapter(chapter.id)}>
                <div className="chapter-title">
                  {expandedChapters[chapter.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {chapter.title}
                </div>
                <span className="problem-count">
                  {t('training.problemsCount').replace('{0}', String(chapter.problems?.length || 0))}
                </span>
              </div>
              {expandedChapters[chapter.id] && (
                <div className="chapter-problems">
                  {chapter.problems?.length ? (
                    chapter.problems.map((p: any) => (
                      <Link
                        key={p.relation_id}
                        to={`/problems/${p.slug}`}
                        className={`chapter-problem-row ${p.solved ? 'solved' : p.attempted ? 'attempted' : ''}`}
                      >
                        {p.solved ? (
                          <CheckCircle2 size={16} className="status-icon" />
                        ) : (
                          <Circle size={16} className="status-icon" />
                        )}
                        <span className="problem-title">{p.title}</span>
                        <span className="problem-meta">
                          {p.rating > 0 ? `★${p.rating}` : p.difficulty}
                        </span>
                      </Link>
                    ))
                  ) : (
                    <div className="empty-chapter">{t('training.noProblems')}</div>
                  )}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="empty-chapter">{t('training.noChapters')}</div>
        )}
      </div>
    </div>
  );
}

function EmptyError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-banner">
      <AlertCircle size={16} />
      <span>{message}</span>
      <button className="btn btn-secondary btn-sm" onClick={onRetry}>{t('common.retry')}</button>
    </div>
  );
}
