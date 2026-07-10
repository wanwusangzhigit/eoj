import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import RatingChart from '../components/RatingChart';
import { DIFFICULTY_COLORS } from '../constants';
import RatingBadge from '../components/RatingBadge';
import { getRatingColor, getRatingTier } from '../utils/rating';
import { Trophy, Target, Clock, Calendar, UserX, Swords, Edit3, Key, X, Check, Mail, Users, TrendingUp } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import FollowButton from '../components/FollowButton';
import './Profile.css';

export default function Profile() {
  const { username } = useParams<{ username?: string }>();
  const { user: currentUser, fetchUser } = useAuthStore();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allSubmissions, setAllSubmissions] = useState<any[]>([]);
  const [languageStats, setLanguageStats] = useState<{ language: string; total: number; accepted: number }[]>([]);
  const [contests, setContests] = useState<any[]>([]);
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [ratingHistory, setRatingHistory] = useState<any[]>([]);
  const [ratingInfo, setRatingInfo] = useState<{ rating: number; max_rating: number } | null>(null);

  // Edit profile state
  const [editing, setEditing] = useState(false);
  const [editAvatar, setEditAvatar] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Change password state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const profileUser = data?.user;
  useDocumentTitle(profileUser?.username ? `${profileUser.username}'s Profile` : t('profile.title'));

  const isOwnProfile = !username || username === currentUser?.username;

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (isOwnProfile) {
          const profileData = await api.getUserProfile();
          setData(profileData);
        } else if (username) {
          const userData = await api.getUserByUsername(username);
          setData(userData);
        }
      } catch (err: any) {
        setError(err.message || t('profile.notFound'));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [username, isOwnProfile]);

  useEffect(() => {
    const fetchExtraData = async () => {
      // Fetch language stats via dedicated API (more efficient than pageSize:1000)
      if (isOwnProfile) {
        try {
          const langData = await api.getUserLanguageStats();
          setLanguageStats(langData.languages);
        } catch {
          // ignore
        }
        try {
          const heatmapData = await api.getUserHeatmap();
          setHeatmap(heatmapData.heatmap);
        } catch {
          // ignore
        }
      } else {
        // For other users, fall back to fetching submissions
        try {
          const subData = await api.getSubmissions({ user_id: String(data?.user?.id), pageSize: 1000 });
          setAllSubmissions(subData.submissions);
        } catch {
          // ignore
        }
      }
      // Fetch user's contest history (contests they joined)
      try {
        const contestData = await api.getUserContests();
        setContests(contestData.contests);
      } catch {
        // ignore
      }

      // Fetch rating history for the profile subject (works for both own and others')
      try {
        const targetUsername = isOwnProfile ? currentUser?.username : username;
        if (targetUsername) {
          const ratingData = await api.getUserRating(targetUsername);
          setRatingInfo({ rating: ratingData.rating, max_rating: ratingData.max_rating });
          setRatingHistory(ratingData.history || []);
        }
      } catch {
        // user has no rating history yet — ignore
      }
    };
    if (data?.user) fetchExtraData();
  }, [data?.user]);

  if (loading) {
    return <LoadingSpinner message={t('profile.loadingProfile')} />;
  }

  if (error || !data) {
    return <EmptyState icon={UserX} title={error || t('profile.notFound')} />;
  }

  const { user, stats } = data;
  const solvedProblems = data.solved_problems || [];
  const recentSubmissions = data.recent_submissions || [];
  const startEditing = () => {
    setEditAvatar(user.avatar_url || '');
    setEditBio(user.bio || '');
    setEditError('');
    setEditing(true);
  };

  const handleSaveProfile = async () => {
    setEditSaving(true);
    setEditError('');
    try {
      const result = await api.updateProfile({ avatar_url: editAvatar, bio: editBio });
      setData({ ...data, user: result.user });
      await fetchUser();
      setEditing(false);
    } catch (e: any) {
      setEditError(e.message || t('common.error'));
    } finally {
      setEditSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    if (!oldPassword || !newPassword) {
      setPasswordError(t('login.usernameRequired'));
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(t('login.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('login.passwordMismatch'));
      return;
    }
    setPasswordSaving(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setShowPasswordModal(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      setPasswordError(e.message || t('common.error'));
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-header">
        {isOwnProfile && !editing && (
          <div className="profile-actions">
            <button className="btn btn-secondary btn-sm" onClick={startEditing}>
              <Edit3 size={14} />
              {t('profile.editProfile')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowPasswordModal(true)}>
              <Key size={14} />
              {t('profile.changePassword')}
            </button>
          </div>
        )}
        {!isOwnProfile && currentUser && profileUser && (
          <div className="profile-actions">
            <FollowButton username={profileUser.username} initialFollowing={!!data?.is_following} />
            <Link to={`/messages?target=${profileUser.id}`} className="btn btn-secondary btn-sm">
              <Mail size={14} />
              {t('messages.sendMessage')}
            </Link>
          </div>
        )}

        {editing ? (
          <div className="profile-edit-form">
            <div className="form-group">
              <label htmlFor="edit-avatar">{t('profile.avatarUrl')}</label>
              <input
                id="edit-avatar"
                type="text"
                className="form-input"
                value={editAvatar}
                onChange={(e) => setEditAvatar(e.target.value)}
                placeholder={t('profile.avatarUrlPlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <label htmlFor="edit-bio">{t('profile.bio')}</label>
              <textarea
                id="edit-bio"
                className="form-textarea"
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                placeholder={t('profile.bioPlaceholder')}
                maxLength={500}
                rows={3}
              />
              <div className="char-count">{editBio.length}/500</div>
            </div>
            {editError && <div className="form-error">{editError}</div>}
            <div className="form-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>
                <X size={14} />
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveProfile} disabled={editSaving}>
                <Check size={14} />
                {editSaving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-info">
            {user.avatar_url && (
              <img src={user.avatar_url} alt={user.username} className="profile-avatar" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div className="profile-text">
              <h1 className="profile-username" style={user.rating && user.rating >= 800 ? { color: getRatingColor(user.rating) } : undefined}>{user.username}</h1>
              {user.rating && user.rating >= 800 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <RatingBadge rating={user.rating} showLabel={false} size="md" />
                  <span style={{ color: getRatingColor(user.rating), fontWeight: 600, fontSize: '13px' }}>{getRatingTier(user.rating)}</span>
                </div>
              )}
              {user.bio && <p className="profile-bio">{user.bio}</p>}
              <div className="profile-meta">
                <span className="meta-item">
                  <Calendar size={14} />
                  {t('profile.joined')} {new Intl.DateTimeFormat().format(new Date(user.created_at))}
                </span>
                {(user.role === 'admin' || user.role === 'super_admin') && (
                  <span className="badge admin-badge">{t('common.admin')}</span>
                )}
              </div>
              {(data?.followers_count !== undefined || data?.following_count !== undefined) && (
                <div className="profile-follow-stats">
                  <Link to={`/users/${user.username}/followers`} className="follow-stat">
                    <Users size={14} />
                    <strong>{data?.followers_count ?? 0}</strong>
                    <span>{t('follow.followers')}</span>
                  </Link>
                  <Link to={`/users/${user.username}/following`} className="follow-stat">
                    <Users size={14} />
                    <strong>{data?.following_count ?? 0}</strong>
                    <span>{t('follow.followingList')}</span>
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="stats-grid">
          <div className="stat-card">
            <Trophy size={24} className="stat-icon solved" />
            <div className="stat-content">
              <div className="stat-value">{stats.solved_count}</div>
              <div className="stat-label">{t('profile.accepted')}</div>
            </div>
          </div>
          <div className="stat-card">
            <Target size={24} className="stat-icon attempted" />
            <div className="stat-content">
              <div className="stat-value">{stats.attempted_count || stats.solved_count}</div>
              <div className="stat-label">{t('profile.attempted')}</div>
            </div>
          </div>
          <div className="stat-card">
            <Clock size={24} className="stat-icon submissions" />
            <div className="stat-content">
              <div className="stat-value">{stats.total_submissions}</div>
              <div className="stat-label">{t('profile.totalSubmissions')}</div>
            </div>
          </div>
          {ratingInfo && ratingInfo.rating > 0 && (
            <div className="stat-card">
              <TrendingUp size={24} className="stat-icon solved" />
              <div className="stat-content">
                <div className="stat-value" style={{ color: getRatingColor(ratingInfo.rating) }}>
                  {ratingInfo.rating}
                </div>
                <div className="stat-label">Rating / Max {ratingInfo.max_rating}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {ratingHistory.length > 0 && (
        <div className="profile-rating-section">
          <h2 className="section-title">
            <TrendingUp size={18} />
            {t('profile.ratingHistory')}
          </h2>
          <RatingChart history={ratingHistory} />
        </div>
      )}

      {isOwnProfile && Object.keys(heatmap).length > 0 && (
        <div className="heatmap-section">
          <h2 className="section-title">{t('profile.activityHeatmap')}</h2>
          <div className="heatmap-grid">
            {(() => {
              const now = new Date();
              const weeks = 53;
              const days = weeks * 7;
              const startDate = new Date(now);
              startDate.setDate(startDate.getDate() - days + 1);
              // Align to Sunday
              startDate.setDate(startDate.getDate() - startDate.getDay());
              const maxCount = Math.max(1, ...Object.values(heatmap));
              const cells: React.ReactNode[] = [];
              for (let i = 0; i < days; i++) {
                const d = new Date(startDate);
                d.setDate(d.getDate() + i);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const count = heatmap[key] || 0;
                let level = 0;
                if (count > 0) level = 1;
                if (count > maxCount * 0.25) level = 2;
                if (count > maxCount * 0.5) level = 3;
                if (count > maxCount * 0.75) level = 4;
                cells.push(
                  <div
                    key={key}
                    className={`heatmap-cell heatmap-level-${level}`}
                    title={`${key}: ${count} ${t('profile.submissions')}`}
                  />
                );
              }
              return cells;
            })()}
          </div>
        </div>
      )}

      {solvedProblems.length > 0 && (
        <div className="difficulty-distribution">
          <h2 className="section-title">{t('profile.difficultyDistribution')}</h2>
          <div className="difficulty-bars">
            {['easy', 'medium', 'hard'].map((diff) => {
              const label = diff === 'easy' ? t('problemList.easy') : diff === 'medium' ? t('problemList.medium') : t('problemList.hard');
              const count = solvedProblems.filter((p: any) => p.difficulty?.toLowerCase() === diff || p.difficulty === label).length;
              const percentage = solvedProblems.length > 0 ? Math.round((count / solvedProblems.length) * 100) : 0;
              return (
                <div key={diff} className="difficulty-bar-item">
                  <div className="difficulty-bar-header">
                    <span className="difficulty-bar-label" style={{ color: DIFFICULTY_COLORS[label] || DIFFICULTY_COLORS[diff] }}>{label}</span>
                    <span className="difficulty-bar-count">{count} ({percentage}%)</span>
                  </div>
                  <div className="difficulty-bar-track">
                    <div
                      className="difficulty-bar-fill"
                      style={{
                        width: `${percentage}%`,
                        background: DIFFICULTY_COLORS[label] || DIFFICULTY_COLORS[diff],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(languageStats.length > 0 || allSubmissions.length > 0) && (
        <div className="language-distribution">
          <h2 className="section-title">{t('profile.languageStats')}</h2>
          <div className="language-bars">
            {(() => {
              // Use dedicated API stats for own profile, else compute from submissions
              if (languageStats.length > 0) {
                const total = languageStats.reduce((s, l) => s + l.accepted, 0) || 1;
                return languageStats
                  .filter(l => l.accepted > 0)
                  .map(({ language, accepted }) => {
                    const pct = Math.round((accepted / total) * 100);
                    return (
                      <div key={language} className="language-bar-item">
                        <div className="language-bar-header">
                          <span className="language-bar-label">{language}</span>
                          <span className="language-bar-count">{accepted} ({pct}%)</span>
                        </div>
                        <div className="difficulty-bar-track">
                          <div className="difficulty-bar-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                        </div>
                      </div>
                    );
                  });
              }
              const langCounts: Record<string, number> = {};
              allSubmissions.forEach((s: any) => {
                if (s.status === 'accepted') {
                  langCounts[s.language] = (langCounts[s.language] || 0) + 1;
                }
              });
              const total = Object.values(langCounts).reduce((a, b) => a + b, 0) || 1;
              return Object.entries(langCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([lang, count]) => {
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={lang} className="language-bar-item">
                      <div className="language-bar-header">
                        <span className="language-bar-label">{lang}</span>
                        <span className="language-bar-count">{count} ({pct}%)</span>
                      </div>
                      <div className="difficulty-bar-track">
                        <div className="difficulty-bar-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                      </div>
                    </div>
                  );
                });
            })()}
          </div>
        </div>
      )}

      {solvedProblems.length > 0 && (
        <div className="solved-section">
          <h2 className="section-title">{t('profile.solvedProblems')} ({solvedProblems.length})</h2>
          <div className="problems-grid">
            {solvedProblems.map((problem: any) => (
              <Link
                key={problem.id}
                to={`/problems/${problem.slug}`}
                className="problem-card solved"
              >
                <div className="problem-card-header">
                  <span className="problem-id">#{problem.id}</span>
                  <span
                    className="difficulty-badge"
                    style={{
                      color: DIFFICULTY_COLORS[problem.difficulty],
                      borderColor: DIFFICULTY_COLORS[problem.difficulty],
                      background: `${DIFFICULTY_COLORS[problem.difficulty]}15`,
                    }}
                  >
                    {problem.difficulty}
                  </span>
                </div>
                <div className="problem-card-title">{problem.title}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {contests.length > 0 && (
        <div className="contest-history-section">
          <h2 className="section-title">{t('profile.contestHistory')}</h2>
          <div className="contest-history-list">
            {contests.map((contest: any) => {
              const now = Date.now();
              const start = new Date(contest.start_time).getTime();
              const end = new Date(contest.end_time).getTime();
              let statusLabel: string;
              let statusClass: string;
              if (now < start) {
                statusLabel = t('contests.upcoming');
                statusClass = 'badge badge-info';
              } else if (now >= start && now <= end) {
                statusLabel = t('contests.running');
                statusClass = 'badge badge-success';
              } else {
                statusLabel = t('contests.ended');
                statusClass = 'badge badge-ended';
              }
              return (
                <Link key={contest.id} to={`/contests/${contest.id}`} className="contest-history-item">
                  <div className="contest-history-info">
                    <div className="contest-history-title">
                      <Swords size={16} />
                      {contest.title}
                    </div>
                    <div className="contest-history-meta">
                      <span><Calendar size={12} /> {new Intl.DateTimeFormat().format(new Date(contest.start_time))} - {new Intl.DateTimeFormat().format(new Date(contest.end_time))}</span>
                      <span>{contest.participant_count ?? 0} {t('contests.participants')}</span>
                    </div>
                  </div>
                  <span className={statusClass}>{statusLabel}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {recentSubmissions.length > 0 && (
        <div className="submissions-section">
          <div className="section-header">
            <h2 className="section-title">{t('profile.recentSubmissions')}</h2>
            <Link to="/submissions" className="view-all-link">{t('profile.viewAll')}</Link>
          </div>
          <div className="submissions-list">
            {recentSubmissions.map((sub: any) => (
              <Link
                key={sub.id}
                to={`/submissions/${sub.id}`}
                className="submission-item"
              >
                <div className="submission-info">
                  <div className="submission-problem">{sub.title}</div>
                  <div className="submission-meta">
                    <span>{sub.language}</span>
                    <span>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(sub.created_at))}</span>
                  </div>
                </div>
                <StatusBadge status={sub.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('profile.changePassword')}</h2>
              <button className="modal-close" onClick={() => setShowPasswordModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="old-password">{t('profile.oldPassword')}</label>
                <input
                  id="old-password"
                  type="password"
                  className="form-input"
                  name="old_password"
                  autoComplete="current-password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-password">{t('profile.newPassword')}</label>
                <input
                  id="new-password"
                  type="password"
                  className="form-input"
                  name="new_password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('login.passwordTooShort')}
                />
              </div>
              <div className="form-group">
                <label htmlFor="confirm-password">{t('login.confirmPassword')}</label>
                <input
                  id="confirm-password"
                  type="password"
                  className="form-input"
                  name="confirm_password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              {passwordError && <div className="form-error">{passwordError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleChangePassword} disabled={passwordSaving}>
                {passwordSaving ? t('common.loading') : t('profile.changePassword')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
