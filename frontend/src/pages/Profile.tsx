import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import RatingChart from '../components/RatingChart';
import { DIFFICULTY_COLORS } from '../constants';
import RatingBadge from '../components/RatingBadge';
import { getRatingColor, getRatingTier } from '../utils/rating';
import { parseContestTimeToMs, formatContestTime } from '../utils/contestTime';
import { Trophy, Target, Clock, Calendar, UserX, Swords, Edit3, Key, X, Check, Mail, Users, TrendingUp, Award, Download, Tag, BookX, RefreshCw } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import FollowButton from '../components/FollowButton';
import { useNow } from '../hooks/useNow';
import './Profile.css';

export default function Profile() {
  const { username } = useParams<{ username?: string }>();
  const { user: currentUser, fetchUser } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allSubmissions, setAllSubmissions] = useState<any[]>([]);
  const [languageStats, setLanguageStats] = useState<{ language: string; total: number; accepted: number }[]>([]);
  const [contests, setContests] = useState<any[]>([]);
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [analysisStats, setAnalysisStats] = useState<{ difficulty: any[]; monthly: any[]; status: any[] } | null>(null);
  const [ratingHistory, setRatingHistory] = useState<any[]>([]);
  const [ratingInfo, setRatingInfo] = useState<{ rating: number; max_rating: number } | null>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [checkingAchievements, setCheckingAchievements] = useState(false);

  // Edit profile state
  const [editing, setEditing] = useState(false);
  const [editAvatar, setEditAvatar] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editSignature, setEditSignature] = useState('');
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
  const now = useNow();

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
        try {
          const statsData = await api.getUserStats();
          setAnalysisStats(statsData);
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
      // Fetch achievements
      try {
        const achData = await api.getAchievements();
        setAchievements(achData.achievements || []);
      } catch {
        // ignore
      }
    };
    if (data?.user) fetchExtraData();
  }, [data?.user, isOwnProfile, currentUser, username]);

  // ── 重新检查成就解锁状态(仅本人) ──
  const handleCheckAchievements = async () => {
    if (checkingAchievements) return;
    setCheckingAchievements(true);
    try {
      const result = await api.checkAchievements();
      if (result.new_achievements && result.new_achievements.length > 0) {
        addToast('success', t('profile.newAchievements').replace('{0}', String(result.new_achievements.length)));
      } else {
        addToast('info', t('profile.noNewAchievements'));
      }
      // 刷新成就列表
      const achData = await api.getAchievements();
      setAchievements(achData.achievements || []);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setCheckingAchievements(false);
    }
  };

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
    setEditSignature(user.signature || '');
    setEditError('');
    setEditing(true);
  };

  const handleSaveProfile = async () => {
    setEditSaving(true);
    setEditError('');
    try {
      const result = await api.updateProfile({ avatar_url: editAvatar, bio: editBio, signature: editSignature });
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

  // 导出用户全部数据
  const handleExportData = async () => {
    try {
      await api.exportUserData();
      addToast('success', t('profile.exportDone'));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
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
            <button className="btn btn-secondary btn-sm" onClick={handleExportData} title={t('profile.exportData')}>
              <Download size={14} />
              {t('profile.exportData')}
            </button>
            <Link to="/annual-report" className="btn btn-secondary btn-sm" title={t('annualReport.title')}>
              <TrendingUp size={14} />
              {t('annualReport.title')}
            </Link>
            <Link to="/wrong-problems" className="btn btn-secondary btn-sm" title={t('wrongProblems.title')}>
              <BookX size={14} />
              {t('wrongProblems.title')}
            </Link>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="edit-avatar"
                  type="text"
                  className="form-input"
                  value={editAvatar}
                  onChange={(e) => setEditAvatar(e.target.value)}
                  placeholder={t('profile.avatarUrlPlaceholder')}
                  autoComplete="off"
                  style={{ flex: 1 }}
                />
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  上传
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const result = await api.uploadAvatar(file);
                        setEditAvatar(result.avatar_url);
                        addToast('success', '头像已上传');
                      } catch (err: any) {
                        addToast('error', err.message || '上传失败');
                      }
                    }}
                  />
                </label>
              </div>
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
            <div className="form-group">
              <label htmlFor="edit-signature">个性签名</label>
              <input
                id="edit-signature"
                type="text"
                className="form-input"
                value={editSignature}
                onChange={(e) => setEditSignature(e.target.value)}
                placeholder="一句话介绍自己..."
                maxLength={200}
              />
              <div className="char-count">{editSignature.length}/200</div>
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
              {user.title && (
                <div className="profile-title-badge" title={t('profile.titleBadge')}>{user.title}</div>
              )}
              {user.rating && user.rating >= 800 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <RatingBadge rating={user.rating} showLabel={false} size="md" />
                  <span style={{ color: getRatingColor(user.rating), fontWeight: 600, fontSize: '13px' }}>{getRatingTier(user.rating)}</span>
                </div>
              )}
              {user.bio && <p className="profile-bio">{user.bio}</p>}
              {user.signature && <p className="profile-signature" style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>「{user.signature}」</p>}
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

      {achievements.length > 0 && (
        <div className="profile-achievements-section">
          <h2 className="section-title">
            <Award size={18} />
            成就徽章
            <span className="achievement-progress">
              {achievements.filter((a: any) => a.earned).length} / {achievements.length}
            </span>
            {isOwnProfile && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={handleCheckAchievements}
                disabled={checkingAchievements}
              >
                <RefreshCw size={13} />
                {checkingAchievements ? t('profile.checkingAchievements') : t('profile.recheckAchievements')}
              </button>
            )}
          </h2>
          <div className="achievements-grid">
            {achievements.map((ach: any) => (
              <div key={ach.key} className={`achievement-card ${ach.earned ? 'earned' : 'locked'}`}>
                <span className="achievement-icon">{ach.icon}</span>
                <span className="achievement-name">{ach.title}</span>
                <span className="achievement-desc">{ach.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats && (
        <div className="profile-submission-stats">
          <h2 className="section-title">
            <TrendingUp size={18} />
            提交统计
          </h2>
          <div className="submission-stats-bars">
            {[
              { label: '已通过', key: 'accepted', count: stats.solved_count, color: 'var(--success)' },
              { label: '总提交', key: 'total', count: stats.total_submissions, color: 'var(--accent)' },
              { label: '尝试题目', key: 'attempted', count: stats.attempted_count, color: 'var(--warning)' },
            ].map((item) => {
              const maxVal = Math.max(stats.total_submissions, stats.attempted_count, stats.solved_count, 1);
              const pct = Math.round((item.count / maxVal) * 100);
              return (
                <div key={item.key} className="stat-bar-item">
                  <div className="stat-bar-header">
                    <span className="stat-bar-label">{item.label}</span>
                    <span className="stat-bar-count">{item.count}</span>
                  </div>
                  <div className="stat-bar-track">
                    <div className="stat-bar-fill" style={{ width: `${pct}%`, background: item.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
          <h2 className="section-title">
            <Calendar size={18} />
            {t('profile.activityHeatmap')}
          </h2>
          <div className="heatmap-stats" style={{display:'flex',gap:16,marginBottom:12,flexWrap:'wrap'}}>
            {(() => {
              const values = Object.values(heatmap) as number[];
              const total = values.reduce((a, b) => a + b, 0);
              const activeDays = values.filter(v => v > 0).length;
              let longestStreak = 0, currentStreak = 0;
              const dates = Object.keys(heatmap).sort();
              for (let i = 0; i < dates.length; i++) {
                if (heatmap[dates[i]] > 0) {
                  currentStreak++;
                  longestStreak = Math.max(longestStreak, currentStreak);
                } else {
                  currentStreak = 0;
                }
              }
              return (
                <>
                  <div className="heatmap-stat-card">
                    <div className="heatmap-stat-icon total"><Clock size={16} /></div>
                    <div>
                      <div className="heatmap-stat-value">{total}</div>
                      <div className="heatmap-stat-label">总提交</div>
                    </div>
                  </div>
                  <div className="heatmap-stat-card">
                    <div className="heatmap-stat-icon days"><Calendar size={16} /></div>
                    <div>
                      <div className="heatmap-stat-value">{activeDays}</div>
                      <div className="heatmap-stat-label">活跃天数</div>
                    </div>
                  </div>
                  <div className="heatmap-stat-card">
                    <div className="heatmap-stat-icon streak"><TrendingUp size={16} /></div>
                    <div>
                      <div className="heatmap-stat-value">{longestStreak}</div>
                      <div className="heatmap-stat-label">最长连续</div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
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

      {analysisStats && analysisStats.difficulty.length > 0 && (
        <div className="stats-visualization">
          <h2 className="section-title">{t('profile.difficultyStats')}</h2>
          <div className="language-bars">
            {analysisStats.difficulty.map((d: any) => {
              const pct = d.attempted > 0 ? Math.round((d.accepted / d.attempted) * 100) : 0;
              return (
                <div key={d.difficulty} className="language-bar-item">
                  <div className="language-bar-header">
                    <span className="language-bar-label">{d.difficulty}</span>
                    <span className="language-bar-count">
                      {d.accepted}/{d.attempted} AC ({pct}%)
                    </span>
                  </div>
                  <div className="difficulty-bar-track">
                    <div className="difficulty-bar-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {analysisStats && analysisStats.monthly.length > 0 && (
        <div className="stats-visualization">
          <h2 className="section-title">{t('profile.monthlyTrend')}</h2>
          <div className="monthly-trend">
            {(() => {
              const max = Math.max(1, ...analysisStats.monthly.map((m: any) => m.total));
              return analysisStats.monthly.map((m: any) => (
                <div key={m.month} className="monthly-bar-col" title={`${m.month}: ${m.accepted} AC / ${m.total} 提交`}>
                  <div className="monthly-bar-stack">
                    <div className="monthly-bar-accepted" style={{ height: `${(m.accepted / max) * 100}%` }} />
                    <div className="monthly-bar-total" style={{ height: `${(m.total / max) * 100}%` }} />
                  </div>
                  <span className="monthly-bar-label">{m.month.slice(5)}</span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {analysisStats && analysisStats.status.length > 0 && (
        <div className="stats-visualization">
          <h2 className="section-title">{t('profile.submissionStatus')}</h2>
          <div className="language-bars">
            {analysisStats.status.map((s: any) => (
              <div key={s.status} className="language-bar-item">
                <div className="language-bar-header">
                  <span className="language-bar-label">{s.status}</span>
                  <span className="language-bar-count">{s.count}</span>
                </div>
                <div className="difficulty-bar-track">
                  <div className="difficulty-bar-fill" style={{ width: `${Math.min(100, s.count)}%`, background: 'var(--text-muted)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 用户标签云 */}
      {data && data.tag_cloud && data.tag_cloud.length > 0 && (
        <div className="tag-cloud-section">
          <h2 className="section-title"><Tag size={16} /> {t('profile.tagCloud')}</h2>
          <div className="tag-cloud">
            {data.tag_cloud.map((tg: any) => (
              <Link
                key={tg.tag}
                to={`/problems?tag=${encodeURIComponent(tg.tag)}`}
                className="tag-cloud-item"
                style={{ fontSize: 12 + Math.min(8, tg.count) }}
              >
                #{tg.tag}
                <span className="tag-cloud-count">{tg.count}</span>
              </Link>
            ))}
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
              const start = parseContestTimeToMs(contest.start_time);
              const end = parseContestTimeToMs(contest.end_time);
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
                <Link key={contest.id} to={`/match/${contest.id}`} className="contest-history-item">
                  <div className="contest-history-info">
                    <div className="contest-history-title">
                      <Swords size={16} />
                      {contest.title}
                    </div>
                    <div className="contest-history-meta">
                      <span><Calendar size={12} /> {formatContestTime(contest.start_time)} - {formatContestTime(contest.end_time)}</span>
                      <span>{contest.participant_count ?? 0} {t('contests.participants')}</span>
                      {contest.final_rank != null && (
                        <span className="contest-history-rank">
                          <Trophy size={12} /> {t('profile.finalRank').replace('{0}', String(contest.final_rank))}
                        </span>
                      )}
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
