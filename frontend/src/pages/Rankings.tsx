import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Trophy, Medal, Award, Crown, Target, TrendingUp, AlertCircle, Star } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import RatingBadge from '../components/RatingBadge';
import { getRatingColor } from '../utils/rating';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './Rankings.css';

type Mode = 'solved' | 'rating';

export default function Rankings() {
  const [rankings, setRankings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [timeRange, setTimeRange] = useState<'all' | 'week' | 'month'>('all');
  const [mode, setMode] = useState<Mode>('solved');
  useDocumentTitle(t('rankings.title'));

  useEffect(() => {
    fetchRankings();
  }, [timeRange, mode]);

  const fetchRankings = async () => {
    try {
      setLoadError(false);
      if (mode === 'rating') {
        const data = await api.getRatingLeaderboard({ page: 1, pageSize: 50 });
        setRankings(data.rankings);
      } else {
        const data = await api.getRankings(50, timeRange);
        setRankings(data.rankings);
      }
    } catch (e) {
      console.error('Failed to fetch rankings:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Crown className="rank-icon gold" size={28} />;
    if (rank === 2) return <Medal className="rank-icon silver" size={24} />;
    if (rank === 3) return <Award className="rank-icon bronze" size={24} />;
    return <span className="rank-number">{rank}</span>;
  };

  const getRankClass = (rank: number) => {
    if (rank === 1) return 'rank-gold';
    if (rank === 2) return 'rank-silver';
    if (rank === 3) return 'rank-bronze';
    return '';
  };

  if (loading) {
    return <LoadingSpinner message={t('rankings.loadingRankings')} />;
  }

  return (
    <div className="rankings-page">
      {loadError && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('rankings.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchRankings}>{t('common.retry')}</button>
        </div>
      )}
      <div className="rankings-header">
        <div className="rankings-title-section">
          <Trophy size={32} className="title-icon" />
          <div>
            <h1 className="page-title">{t('rankings.title')}</h1>
            <p className="page-subtitle">{t('rankings.subtitle')}</p>
          </div>
        </div>

        <div className="rankings-controls">
          <div className="mode-switcher">
            <button
              className={`mode-btn ${mode === 'solved' ? 'active' : ''}`}
              onClick={() => setMode('solved')}
              title={t('rankings.bySolved')}
            >
              <Target size={14} />
              {t('rankings.bySolved')}
            </button>
            <button
              className={`mode-btn ${mode === 'rating' ? 'active' : ''}`}
              onClick={() => setMode('rating')}
              title={t('rankings.byRating')}
            >
              <Star size={14} />
              {t('rankings.byRating')}
            </button>
          </div>

          {mode === 'solved' && (
            <div className="time-filter">
              {(['all', 'week', 'month'] as const).map((range) => (
                <button
                  key={range}
                  className={`time-filter-btn ${timeRange === range ? 'active' : ''}`}
                  onClick={() => setTimeRange(range)}
                >
                  {range === 'all' && <TrendingUp size={14} />}
                  {range === 'all' && t('rankings.allTime')}
                  {range === 'week' && t('rankings.weekly')}
                  {range === 'month' && t('rankings.monthly')}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {rankings.length === 0 ? (
        <div className="empty-state">
          <Target size={48} className="empty-icon" />
          <h3>{mode === 'rating' ? t('rankings.noRatingsYet') : t('rankings.noSubmissionsYet')}</h3>
          <p>{t('rankings.beTheFirst')}</p>
        </div>
      ) : (
        <div className="rankings-table">
          <div className="rankings-table-header">
            <span className="header-rank">{t('rankings.rank')}</span>
            <span className="header-user">{t('rankings.user')}</span>
            {mode === 'solved' && <span className="header-score">{t('rankings.solved')}</span>}
            {mode === 'rating' && <span className="header-rating">{t('rankings.rating')}</span>}
          </div>
          {rankings.map((user) => {
            const rank = mode === 'rating' ? user.rank : user.rank;
            return (
              <Link
                key={`${user.id}-${mode}`}
                to={`/users/${user.username}`}
                className={`rankings-row ${mode === 'rating' ? 'rating-mode' : ''} ${getRankClass(rank)}`}
              >
                <div className="rank-cell">{getRankIcon(rank)}</div>
                <div className="user-cell">
                  {user.avatar_url && (
                    <img src={user.avatar_url} alt={user.username} className="user-avatar" />
                  )}
                  <div className="user-info">
                    <span className="username">{user.username}</span>
                    {rank <= 3 && (
                      <span className={`rank-badge ${getRankClass(rank)}`}>
                        {rank === 1 ? t('rankings.champion') : rank === 2 ? t('rankings.runnerUp') : t('rankings.thirdPlace')}
                      </span>
                    )}
                  </div>
                </div>
                {mode === 'solved' && (
                  <div className="score-cell">
                    <span className="score">{user.solved_count}</span>
                    <span className="score-label">{t('rankings.problems')}</span>
                  </div>
                )}
                {mode === 'rating' && (
                  <div className="rating-cell">
                    {user.rating > 0 ? (
                      <>
                        <span className="rating-value" style={{ color: getRatingColor(user.rating) }}>
                          {user.rating}
                        </span>
                        {user.max_rating > 0 && (
                          <span className="max-rating">/ {user.max_rating}</span>
                        )}
                        <RatingBadge rating={user.rating} showLabel={false} size="sm" />
                      </>
                    ) : (
                      <span className="rating-unrated">{t('rankings.unrated')}</span>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
