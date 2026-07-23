import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import LoadingSpinner from '../components/LoadingSpinner';
import RatingBadge from '../components/RatingBadge';
import { getRatingColor } from '../utils/rating';
import { Trophy, Calendar, Users, ChevronRight, UserPlus, CheckCircle, Clock, Eye, MessageSquare, BookOpen, Timer, Edit3, XCircle, AlertCircle, Play, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './ContestDetail.css';

const STATUS_BADGE_CLASS: Record<string, string> = {
  upcoming: 'badge badge-info',
  running: 'badge badge-success',
  ended: 'badge badge-ended',
};

function formatPenalty(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}min`;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function ContestDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const [contest, setContest] = useState<any>(null);
  const [problems, setProblems] = useState<any[]>([]);
  const [rankings, setRankings] = useState<any[]>([]);
  const [rankingProblems, setRankingProblems] = useState<any[]>([]);
  const [rankingsMeta, setRankingsMeta] = useState<any>({});
  const [registered, setRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<'problems' | 'rankings' | 'review'>('problems');
  const [registering, setRegistering] = useState(false);
  const [virtualStarting, setVirtualStarting] = useState(false);
  const [ratingChanges, setRatingChanges] = useState<any[]>([]);
  const [countdown, setCountdown] = useState<string>('');
  const [selectedProblem, setSelectedProblem] = useState<string | null>(null);
  const [myProblemStatus, setMyProblemStatus] = useState<Record<string, { status: string; score: number; best_score: number }>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useDocumentTitle(contest?.title);

  useEffect(() => {
    if (!id) return;
    fetchContest();
  }, [id]);

  const fetchContest = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api.getContest(Number(id));
      setContest(data.contest);
      if (user) {
        try {
          const regData = await api.checkContestRegistration(Number(id));
          setRegistered(regData.registered);
        } catch {
          // ignore
        }
      }
    } catch (e: any) {
      setLoadError(e.message || t('contests.loadError'));
    } finally {
      setLoading(false);
    }
  };

  // Countdown timer
  useEffect(() => {
    if (!contest) return;

    const updateCountdown = () => {
      const now = Date.now();
      const start = new Date(contest.start_time).getTime();
      const end = new Date(contest.end_time).getTime();

      if (now < start) {
        setCountdown(`${t('contests.upcoming')} ${formatCountdown(start - now)}`);
      } else if (now >= start && now < end) {
        setCountdown(formatCountdown(end - now));
      } else {
        setCountdown(t('contests.ended'));
        // Contest just ended — refresh data to update status
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        fetchContest();
        return;
      }
    };

    updateCountdown();
    timerRef.current = setInterval(updateCountdown, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [contest]);

  useEffect(() => {
    if (!id || !contest) return;
    if (activeTab === 'problems') {
      fetchProblems();
    } else if (activeTab === 'rankings') {
      fetchRankings();
    } else if (activeTab === 'review') {
      fetchProblems();
      fetchRankings();
      fetchRatingChanges();
    }
  }, [activeTab, id, contest]);

  // Auto-refresh rankings during running contest
  useEffect(() => {
    if (!id || !contest || activeTab !== 'rankings') return;
    const status = contest.status || getStatus();
    if (status !== 'running') return;
    const interval = setInterval(fetchRankings, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [activeTab, id, contest]);

  const fetchProblems = async () => {
    try {
      const data = await api.getContestProblems(Number(id));
      setProblems(data.problems);
    } catch (e: any) {
      setLoadError(e.message || t('common.error'));
    }
    // Also fetch my status
    if (user) {
      try {
        const statusData = await api.getContestMyStatus(Number(id));
        setMyProblemStatus(statusData.problems);
      } catch {
        // ignore - might not be registered
      }
    }
  };

  const fetchRankings = async () => {
    try {
      const data = await api.getContestRankings(Number(id));
      setRankings(data.rankings);
      setRankingProblems(data.problems || []);
      setRankingsMeta({
        scoring_type: data.scoring_type,
        is_rated: data.is_rated,
        rating_finalized: data.rating_finalized,
      });
    } catch (e: any) {
      setLoadError(e.message || t('common.error'));
    }
  };

  const handleRegister = async () => {
    if (!user || !id || registering) return;
    setRegistering(true);
    try {
      await api.registerContest(Number(id));
      setRegistered(true);
    } catch (e: any) {
      setLoadError(e.message || t('common.error'));
    } finally {
      setRegistering(false);
    }
  };

  const handleVirtualRegister = async () => {
    if (!user || !id || virtualStarting) return;
    setVirtualStarting(true);
    try {
      await api.startVirtualParticipation(Number(id));
      addToast('success', t('contests.virtualStarted'));
      setRegistered(true);
      // Refresh problems so user can start submitting
      await fetchContest();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setVirtualStarting(false);
    }
  };

  const handleFinalizeRatings = async () => {
    if (!user || !id) return;
    if (!confirm(t('contests.finalizeConfirm'))) return;
    try {
      const result = await api.finalizeContestRatings(Number(id));
      addToast('success', `${t('contests.finalizeDone')} (${result.changes_count} users)`);
      await fetchRatingChanges();
      await fetchContest();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const fetchRatingChanges = async () => {
    try {
      const data = await api.getContestRatingChanges(Number(id));
      setRatingChanges(data.changes || []);
    } catch {
      // contest may not be finalized yet — ignore
    }
  };

  const getStatus = (): string => {
    if (contest?.status) return contest.status;
    const now = Date.now();
    const start = new Date(contest.start_time).getTime();
    const end = new Date(contest.end_time).getTime();
    if (now < start) return 'upcoming';
    if (now >= start && now <= end) return 'running';
    return 'ended';
  };

  const getStatusLabel = (status: string) => {
    if (status === 'upcoming') return t('contests.upcoming');
    if (status === 'running') return t('contests.running');
    return t('contests.ended');
  };

  const getProblemLabel = (index: number) => {
    return String.fromCharCode(65 + index);
  };

  const getProblemStatusIcon = (label: string) => {
    const ps = myProblemStatus[label];
    if (!ps || ps.status === 'unattempted') return null;
    if (ps.status === 'accepted') return <CheckCircle size={12} className="problem-status-icon accepted" />;
    return <XCircle size={12} className="problem-status-icon wrong" />;
  };

  const getProblemStatusClass = (label: string) => {
    const ps = myProblemStatus[label];
    if (!ps || ps.status === 'unattempted') return '';
    if (ps.status === 'accepted') return 'label-accepted';
    return 'label-attempted';
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getCellClass = (result: any) => {
    if (!result) return 'cell-empty';
    if (result.status === 'accepted') return 'cell-accepted';
    if (result.status === 'wrong_answer') return 'cell-wrong';
    if (result.status === 'time_limit_exceeded' || result.status === 'memory_limit_exceeded') return 'cell-tle';
    if (result.status === 'runtime_error' || result.status === 'compile_error') return 'cell-error';
    return 'cell-attempted';
  };

  const getCellContent = (result: any) => {
    if (!result) return '';
    if (result.status === 'accepted') {
      return (
        <div className="cell-detail">
          <span className="cell-score">{result.score}</span>
          {result.wrong_attempts > 0 && <span className="cell-penalty">+{result.wrong_attempts}</span>}
        </div>
      );
    }
    return (
      <div className="cell-detail">
        <span className="cell-attempts">{result.attempts || '-'}</span>
      </div>
    );
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (loadError || !contest) {
    return (
      <div className="empty-container">
        <AlertCircle size={48} style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
        <h2>{loadError || t('contests.contestNotFound')}</h2>
        <Link to="/contests" className="btn btn-primary">{t('contests.backToContests')}</Link>
      </div>
    );
  }

  const status = getStatus();
  const isRunning = status === 'running';
  const isEnded = status === 'ended';

  return (
    <div className={`contest-detail-page ${isRunning ? 'contest-running' : ''}`}>
      {/* In-contest navigation sidebar */}
      {isRunning && registered && problems.length > 0 && (
        <div className="contest-nav-sidebar">
          <div className="nav-sidebar-header">
            <Timer size={16} />
            <span className="nav-countdown">{countdown}</span>
          </div>
          <div className="nav-sidebar-problems">
            {problems.map((problem, idx) => {
              const label = problem.label || getProblemLabel(idx);
              return (
                <Link
                  key={problem.id}
                  to={`/problems/${problem.slug || problem.id}`}
                  className={`nav-problem-btn ${selectedProblem === problem.slug ? 'active' : ''}`}
                  onClick={() => setSelectedProblem(problem.slug)}
                >
                  <span className={`nav-problem-label ${getProblemStatusClass(label)}`}>
                    {getProblemStatusIcon(label) || (problem.label || getProblemLabel(idx))}
                  </span>
                  <span className="nav-problem-title">{problem.title}</span>
                </Link>
              );
            })}
          </div>
          <div className="nav-sidebar-footer">
            <Link to={`/contests/${id}`} className="nav-sidebar-link">
              <Trophy size={14} /> {t('contests.rankings')}
            </Link>
          </div>
        </div>
      )}

      <div className="contest-main-content">
        <div className="breadcrumb">
          <Link to="/contests">{t('contests.title')}</Link>
          <ChevronRight size={14} />
          <span>{contest.title}</span>
        </div>

        <div className="contest-info-card">
          <div className="contest-info-header">
            <div className="contest-info-title-section">
              <Trophy size={24} className="contest-icon" />
              <h1 className="contest-detail-title">{contest.title}</h1>
            </div>
            <div className="contest-badges">
              {contest.scoring_type && (
                <span className="badge badge-info">{contest.scoring_type === 'ioi' ? t('contests.ioiType') : t('contests.acmType')}</span>
              )}
              {contest.is_rated && (
                <span className="badge badge-success">{t('contests.ratedContest')}</span>
              )}
              <span className={STATUS_BADGE_CLASS[status] || 'badge'}>
                {getStatusLabel(status)}
              </span>
            </div>
          </div>

          {contest.description && (
            <p className="contest-description">{contest.description}</p>
          )}

          <div className="contest-meta">
            <span className="meta-item">
              <Calendar size={14} />
              {t('contests.startTime')}: {formatDate(contest.start_time)}
            </span>
            <span className="meta-item">
              <Calendar size={14} />
              {t('contests.endTime')}: {formatDate(contest.end_time)}
            </span>
            <span className="meta-item">
              <Users size={14} />
              {t('contests.participants')}: {contest.participant_count ?? 0}
            </span>
            {(isRunning || isEnded) && countdown && (
              <span className={`meta-item countdown-item ${isRunning ? 'running' : ''}`}>
                <Clock size={14} />
                {isRunning ? t('contests.remaining') : ''} {countdown}
              </span>
            )}
          </div>

          {user && (
            <div className="contest-actions">
              {(user.role === 'admin' || user.role === 'super_admin') && (
                <Link to={`/contests/${id}/edit`} className="btn btn-secondary btn-sm">
                  <Edit3 size={14} />
                  {t('contests.editContest')}
                </Link>
              )}
              {status !== 'ended' && (registered ? (
                <button className="btn btn-secondary btn-sm" disabled>
                  <CheckCircle size={14} />
                  {t('contests.registered')}
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleRegister}
                  disabled={registering}
                >
                  <UserPlus size={14} />
                  {t('contests.register')}
                </button>
              ))}
              {status === 'ended' && contest.allow_virtual && !registered && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleVirtualRegister}
                  disabled={virtualStarting}
                  title={t('contests.allowVirtual')}
                >
                  <Play size={14} />
                  {t('contests.virtualParticipation')}
                </button>
              )}
              {(user.role === 'admin' || user.role === 'super_admin') &&
                contest.is_rated && status === 'ended' && !rankingsMeta.rating_finalized && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleFinalizeRatings}
                  title={t('contests.finalizeRating')}
                >
                  <Sparkles size={14} />
                  {t('contests.finalizeRating')}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="contest-tabs">
          <button
            className={`tab-btn ${activeTab === 'problems' ? 'active' : ''}`}
            onClick={() => setActiveTab('problems')}
          >
            {t('contests.problems')}
          </button>
          <button
            className={`tab-btn ${activeTab === 'rankings' ? 'active' : ''}`}
            onClick={() => setActiveTab('rankings')}
          >
            {t('contests.rankings')}
          </button>
          {isEnded && (
            <button
              className={`tab-btn ${activeTab === 'review' ? 'active' : ''}`}
              onClick={() => setActiveTab('review')}
            >
              {t('contests.review')}
            </button>
          )}
        </div>

        {/* Problems Tab */}
        {activeTab === 'problems' && (
          <div className="contest-problems">
            {problems.length === 0 ? (
              <div className="empty-tab">{t('contests.noContests')}</div>
            ) : (
              <div className="problems-table">
                <div className="problems-table-header">
                  <span className="col-label">#</span>
                  <span className="col-title">{t('problemList.titleCol')}</span>
                  <span className="col-difficulty" style={{width:'80px'}}>难度</span>
                  <span className="col-score">{t('admin.score')}</span>
                  <span className="col-actions">{t('common.actions')}</span>
                </div>
                {problems.map((problem, idx) => {
                  const label = problem.label || getProblemLabel(idx);
                  const diffColor = problem.difficulty === 'Easy' ? 'var(--success)' : problem.difficulty === 'Medium' ? 'var(--warning)' : 'var(--error)';
                  return (
                    <div key={problem.id} className="problem-row">
                      <span className="col-label">
                        <span className={`problem-label ${getProblemStatusClass(label)}`}>
                          {getProblemStatusIcon(label) || label}
                        </span>
                      </span>
                    <span className="col-title">
                      <Link to={`/problems/${problem.slug || problem.id}`} className="problem-link">
                        {problem.title}
                      </Link>
                    </span>
                    <span className="col-difficulty" style={{width:'80px',fontSize:'12px',color: diffColor,fontWeight:600}}>
                      {problem.difficulty || '-'}
                    </span>
                    <span className="col-score">{problem.score ?? '-'}</span>
                    <span className="col-actions">
                      <Link
                        to={`/solutions?problem_id=${problem.id}&problem_title=${encodeURIComponent(problem.title)}`}
                        className="action-link"
                        title={t('contests.solutions')}
                      >
                        <BookOpen size={14} />
                      </Link>
                      <Link
                        to={`/discussions?problem_id=${problem.id}&problem_title=${encodeURIComponent(problem.title)}`}
                        className="action-link"
                        title={t('contests.discussions')}
                      >
                        <MessageSquare size={14} />
                      </Link>
                    </span>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Enhanced Rankings Tab */}
        {activeTab === 'rankings' && (
          <div className="contest-rankings">
            {rankings.length === 0 ? (
              <div className="empty-tab">{t('contests.noRankings')}</div>
            ) : (
              <div className="rankings-table-enhanced">
                <div className="rankings-table-header">
                  <span className="col-rank">#</span>
                  <span className="col-user">{t('contests.user')}</span>
                  <span className="col-score">{t('contests.totalScore')}</span>
                  {rankingsMeta.scoring_type !== 'ioi' && (
                    <span className="col-penalty">{t('contests.penalty')}</span>
                  )}
                  {rankingProblems.map((cp: any) => (
                    <span key={cp.label} className="col-problem">{cp.label}</span>
                  ))}
                </div>
                {rankings.map((entry: any, idx: number) => (
                  <div key={entry.user_id || idx} className={`ranking-row ${idx < 3 ? `rank-${idx + 1}` : ''}`}>
                    <span className="col-rank">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </span>
                    <span className="col-user">
                      <Link to={`/users/${entry.username}`} className="user-link">
                        {entry.username}
                        {entry.is_virtual && <span className="virtual-flag" title="Virtual">V</span>}
                      </Link>
                    </span>
                    <span className="col-score">{entry.total_score ?? 0}</span>
                    {rankingsMeta.scoring_type !== 'ioi' && (
                      <span className="col-penalty">{formatPenalty(entry.total_penalty ?? 0)}</span>
                    )}
                    {rankingProblems.map((cp: any) => {
                      const result = entry.problems?.[cp.label];
                      return (
                        <span key={cp.label} className={`col-problem ${getCellClass(result)}`}>
                          {getCellContent(result)}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Post-contest Review Tab */}
        {activeTab === 'review' && isEnded && (
          <div className="contest-review">
            <div className="review-header">
              <h2>{t('contests.reviewTitle')}</h2>
              <p className="review-subtitle">{t('contests.reviewSubtitle')}</p>
            </div>

            {/* Review: Problem Summary */}
            <div className="review-section">
              <h3>{t('contests.problemSummary')}</h3>
              <div className="review-problems-grid">
                {problems.map((problem, idx) => (
                  <div key={problem.id} className="review-problem-card">
                    <div className="review-problem-header">
                      <span className="review-problem-label">{problem.label || getProblemLabel(idx)}</span>
                      <span className="review-problem-title">{problem.title}</span>
                    </div>
                    <div className="review-problem-actions">
                      <Link to={`/problems/${problem.slug || problem.id}`} className="btn btn-sm btn-outline">
                        <Eye size={14} /> {t('contests.viewProblem')}
                      </Link>
                      <Link to={`/solutions?problem_id=${problem.id}&problem_title=${encodeURIComponent(problem.title)}`} className="btn btn-sm btn-outline">
                        <BookOpen size={14} /> {t('contests.viewSolutions')}
                      </Link>
                      <Link to={`/discussions?problem_id=${problem.id}&problem_title=${encodeURIComponent(problem.title)}`} className="btn btn-sm btn-outline">
                        <MessageSquare size={14} /> {t('contests.viewDiscussions')}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Review: My Submissions */}
            {user && (
              <div className="review-section">
                <h3>{t('contests.mySubmissions')}</h3>
                <Link to={`/submissions`} className="btn btn-primary btn-sm">
                  {t('contests.viewMySubmissions')}
                </Link>
              </div>
            )}

            {/* Review: Final Rankings */}
            <div className="review-section">
              <h3>{t('contests.finalRankings')}</h3>
              {rankings.length === 0 ? (
                <div className="empty-tab">{t('contests.noRankings')}</div>
              ) : (
                <div className="rankings-table-enhanced">
                  <div className="rankings-table-header">
                    <span className="col-rank">#</span>
                    <span className="col-user">{t('contests.user')}</span>
                    <span className="col-score">{t('contests.totalScore')}</span>
                    <span className="col-penalty">{t('contests.penalty')}</span>
                    {rankingProblems.map((cp: any) => (
                      <span key={cp.label} className="col-problem">{cp.label}</span>
                    ))}
                  </div>
                  {rankings.slice(0, 20).map((entry: any, idx: number) => (
                    <div key={entry.user_id || idx} className={`ranking-row ${idx < 3 ? `rank-${idx + 1}` : ''}`}>
                      <span className="col-rank">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                      </span>
                      <span className="col-user">
                        <Link to={`/users/${entry.username}`} className="user-link">{entry.username}</Link>
                      </span>
                      <span className="col-score">{entry.total_score ?? 0}</span>
                      <span className="col-penalty">{formatPenalty(entry.total_penalty ?? 0)}</span>
                      {rankingProblems.map((cp: any) => {
                        const result = entry.problems?.[cp.label];
                        return (
                          <span key={cp.label} className={`col-problem ${getCellClass(result)}`}>
                            {getCellContent(result)}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Review: Rating Changes */}
            {rankingsMeta.is_rated && (
              <div className="review-section">
                <h3>
                  {t('contests.ratingChanges')}
                  {rankingsMeta.rating_finalized && (
                    <span className="badge badge-success" style={{ marginLeft: 8 }}>
                      {t('contests.ratingFinalized')}
                    </span>
                  )}
                </h3>
                {ratingChanges.length === 0 ? (
                  <div className="empty-tab">{t('contests.noRatingChanges')}</div>
                ) : (
                  <div className="rating-changes-table">
                    <div className="rating-changes-header">
                      <span className="rc-rank">#</span>
                      <span className="rc-user">{t('contests.user')}</span>
                      <span className="rc-old">{t('contests.oldRating')}</span>
                      <span className="rc-arrow">→</span>
                      <span className="rc-new">{t('contests.newRating')}</span>
                      <span className="rc-delta">{t('contests.delta')}</span>
                    </div>
                    {ratingChanges.map((ch: any, idx: number) => {
                      const delta = (ch.new_rating ?? 0) - (ch.old_rating ?? 0);
                      const oldColor = getRatingColor(ch.old_rating ?? 0);
                      const newColor = getRatingColor(ch.new_rating ?? 0);
                      return (
                        <div key={ch.user_id ?? idx} className="rating-change-row">
                          <span className="rc-rank">{ch.rank ?? idx + 1}</span>
                          <span className="rc-user">
                            <Link to={`/users/${ch.username}`} className="user-link">{ch.username}</Link>
                          </span>
                          <span className="rc-old" style={{ color: oldColor }}>{ch.old_rating ?? 0}</span>
                          <span className="rc-arrow">→</span>
                          <span className="rc-new" style={{ color: newColor }}>
                            <RatingBadge rating={ch.new_rating ?? 0} size="sm" />
                          </span>
                          <span className={`rc-delta ${delta >= 0 ? 'positive' : 'negative'}`}>
                            {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            {delta >= 0 ? '+' : ''}{delta}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
