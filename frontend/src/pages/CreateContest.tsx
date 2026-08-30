import { useState, useEffect } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { Trophy, ChevronRight, Plus, X, Send, Edit3 } from 'lucide-react';
import { t } from '../i18n';
import './CreateContest.css';

import { toLocalDatetimeString } from '../utils/contestTime';

export default function CreateContest() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { id: contestId } = useParams<{ id: string }>();
  const isEditing = !!contestId;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [scoringType, setScoringType] = useState<'oi' | 'icpc' | 'ioi'>('icpc');
  const [freezeMinutes, setFreezeMinutes] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Problem search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedProblems, setSelectedProblems] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // Load existing contest data for editing
  useEffect(() => {
    if (!isEditing) return;
    const fetchContest = async () => {
      setLoading(true);
      try {
        const data = await api.getContest(Number(contestId));
        const contest = data.contest;
        setTitle(contest.title || '');
        setDescription(contest.description || '');
        setIsPublic(!!contest.is_public);
        if (contest.scoring_type === 'oi' || contest.scoring_type === 'ioi' || contest.scoring_type === 'icpc') {
          setScoringType(contest.scoring_type);
        }
        setFreezeMinutes(contest.freeze_minutes ?? 0);

        // Format datetime for input fields (YYYY-MM-DDTHH:mm)
        if (contest.start_time) {
          setStartTime(toLocalDatetimeString(contest.start_time));
        }
        if (contest.end_time) {
          setEndTime(toLocalDatetimeString(contest.end_time));
        }

        // Load contest problems
        try {
          const problemsData = await api.getContestProblems(Number(contestId));
          setSelectedProblems(
            problemsData.problems.map((p: any) => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
              label: p.label,
              score: p.score,
            }))
          );
        } catch {
          // Admin might not have access via getContestProblems if contest hasn't started
          // Try loading from rankings endpoint which includes problems
          try {
            const rankingsData = await api.getContestRankings(Number(contestId));
            if (rankingsData.problems) {
              // We have problem labels and scores but not titles, need to fetch individually
              setSelectedProblems(rankingsData.problems.map((p: any) => ({
                problem_id: p.problem_id,
                id: p.problem_id,
                label: p.label,
                score: p.score,
                title: `Problem ${p.label}`,
              })));
            }
          } catch {
            // ignore
          }
        }
      } catch (e: any) {
        setError(e.message || t('common.error'));
      } finally {
        setLoading(false);
      }
    };
    fetchContest();
  }, [contestId, isEditing]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const timer = setTimeout(async () => {
        setSearching(true);
        try {
          const data = await api.getProblems({ search: searchQuery, pageSize: 10 });
          setSearchResults(data.problems.filter((p: any) => !selectedProblems.find(sp => sp.id === p.id)));
        } catch (e) {
          console.error('Search failed:', e);
        } finally {
          setSearching(false);
        }
      }, 300);
      return () => clearTimeout(timer);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
    }
  }, [searchQuery, selectedProblems]);

  // 权限与后端 contestAdminMiddleware 对齐:admin / super_admin 或拥有 contest_admin 权限
  const canManageContest = !!user && (
    user.role === 'admin' || user.role === 'super_admin' ||
    (Array.isArray(user.permissions) && user.permissions.includes('contest_admin'))
  );
  if (!canManageContest) {
    return (
      <div className="empty-container">
        <h2>{t('admin.accessDenied')}</h2>
        <Link to="/" className="btn btn-primary">{t('common.back')}</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="create-contest-page">
        <div className="create-contest-card">
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  const addProblem = (problem: any) => {
    if (!selectedProblems.find(p => p.id === problem.id)) {
      setSelectedProblems([...selectedProblems, problem]);
      setSearchResults(searchResults.filter(p => p.id !== problem.id));
    }
  };

  const removeProblem = (problemId: number) => {
    setSelectedProblems(selectedProblems.filter(p => p.id !== problemId));
  };

  const updateProblemScore = (problemId: number, score: number) => {
    setSelectedProblems(selectedProblems.map(p => p.id === problemId ? { ...p, score } : p));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startTime || !endTime || submitting) return;
    setSubmitting(true);
    setError('');

    const payload = {
      title: title.trim(),
      description: description.trim(),
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      is_public: isPublic ? 1 : 0,
      scoring_type: scoringType,
      freeze_minutes: freezeMinutes,
      problems: selectedProblems.map((p, i) => ({
        problem_id: p.id,
        label: String.fromCharCode(65 + i),
        score: p.score || 100,
      })),
    };

    try {
      if (isEditing) {
        await api.updateContest(Number(contestId), payload);
        navigate(`/match/${contestId}`);
      } else {
        const data = await api.createContest(payload);
        navigate(`/match/${data.id}`);
      }
    } catch (e: any) {
      setError(e.message || (isEditing ? 'Failed to update contest' : 'Failed to create contest'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-contest-page">
      <div className="breadcrumb">
        <Link to="/matches">{t('contests.title')}</Link>
        <ChevronRight size={14} />
        {isEditing ? (
          <>
            <Link to={`/match/${contestId}`}>{title || t('contests.title')}</Link>
            <ChevronRight size={14} />
            <span>{t('contests.editContest')}</span>
          </>
        ) : (
          <span>{t('contests.createContest')}</span>
        )}
      </div>

      <div className="create-contest-card">
        <div className="create-contest-header">
          {isEditing ? <Edit3 size={22} className="contest-icon" /> : <Trophy size={22} className="contest-icon" />}
          <h1>{isEditing ? t('contests.editContest') : t('contests.createContest')}</h1>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit} className="contest-form">
          <div className="form-group">
            <label>{t('contests.title')}</label>
            <input type="text" className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('contests.titlePlaceholder')} required maxLength={200} />
          </div>

          <div className="form-group">
            <label>{t('admin.description')}</label>
            <textarea className="form-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('contests.descriptionPlaceholder')} rows={4} maxLength={5000} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t('contests.startTime')}</label>
              <input type="datetime-local" className="form-input" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>{t('contests.endTime')}</label>
              <input type="datetime-local" className="form-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
          </div>

          <div className="form-group">
            <label>{t('contests.contestType')}</label>
            <select className="form-input form-select" value={scoringType} onChange={(e) => setScoringType(e.target.value as 'oi' | 'icpc' | 'ioi')}>
              <option value="oi">{t('contests.oiType')}</option>
              <option value="icpc">{t('contests.icpcType')}</option>
              <option value="ioi">{t('contests.ioiType')}</option>
            </select>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              {t('admin.public')}
            </label>
          </div>

          <div className="form-group">
            <label>{t('contests.freezeMinutes')}</label>
            <input
              type="number"
              min={0}
              className="form-input"
              value={freezeMinutes}
              onChange={(e) => setFreezeMinutes(parseInt(e.target.value) || 0)}
              placeholder="0"
            />
            <small style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('contests.freezeMinutesHint')}</small>
          </div>

          <div className="form-group">
            <label>{t('contests.addProblems')}</label>
            <input type="text" className="form-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('contests.searchProblems')} />
            {searching && <div style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'4px'}}>{t('common.loading')}</div>}
            {searchResults.length > 0 && (
              <div className="problem-search-results">
                {searchResults.map((p) => (
                  <div key={p.id} className="problem-search-item" onClick={() => addProblem(p)}>
                    <span>#{p.id} {p.title}</span>
                    <Plus size={14} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedProblems.length > 0 && (
            <div className="selected-problems">
              <label>{t('contests.selectedProblems')} ({selectedProblems.length})</label>
              <div className="selected-problems-list">
                {selectedProblems.map((p, idx) => (
                  <div key={p.id} className="selected-problem-item">
                    <span className="problem-order">{String.fromCharCode(65 + idx)}.</span>
                    <span className="problem-name">#{p.id} {p.title}</span>
                    <input
                      type="number"
                      className="score-input"
                      value={p.score || 100}
                      onChange={(e) => updateProblemScore(p.id, parseInt(e.target.value) || 0)}
                      min={0}
                      max={1000}
                    />
                    <span className="score-label">{t('admin.score')}</span>
                    <button type="button" className="remove-problem-btn" onClick={() => removeProblem(p.id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => navigate(isEditing ? `/match/${contestId}` : '/matches')}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !title.trim() || !startTime || !endTime}>
              {isEditing ? <Edit3 size={14} /> : <Send size={14} />}
              {submitting ? t('admin.saving') : (isEditing ? t('contests.saveContest') : t('contests.createContest'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
