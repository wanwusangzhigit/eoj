import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useSettingsStore } from '../store/settings';
import {
  Megaphone, X, Target, Swords, BookOpen, MessageSquare,
  ChevronRight, Calendar, Quote, AlertCircle, RefreshCw, Sparkles
} from 'lucide-react';
import { DIFFICULTY_COLORS } from '../constants';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSiteConfig } from '../hooks/useSiteConfig';
import AdSlot from '../components/AdSlot';
import './Home.css';

interface Hitokoto {
  id: number;
  hitokoto: string;
  type: string;
  from: string;
  from_who: string;
}

export default function Home() {
  const { user } = useAuthStore();
  const config = useSiteConfig();
  const getAnnouncement = useSettingsStore((s) => s.getAnnouncement);
  const [announcement, setAnnouncement] = useState('');
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState(false);
  const [hitokoto, setHitokoto] = useState<Hitokoto | null>(null);
  const [hitokotoError, setHitokotoError] = useState(false);
  const [recentProblems, setRecentProblems] = useState<any[]>([]);
  const [recentContests, setRecentContests] = useState<any[]>([]);
  const [recentLists, setRecentLists] = useState<any[]>([]);
  const [recentDiscussions, setRecentDiscussions] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [currentDate, setCurrentDate] = useState('');
  const [fetchError, setFetchError] = useState(false);
  useDocumentTitle(t('home.title'));

  useEffect(() => {
    const now = new Date();
    const weekdays = [t('home.sunday'), t('home.monday'), t('home.tuesday'), t('home.wednesday'), t('home.thursday'), t('home.friday'), t('home.saturday')];
    setCurrentDate(`${now.getFullYear()}${t('home.year')}${String(now.getMonth() + 1).padStart(2, '0')}${t('home.month')}${String(now.getDate()).padStart(2, '0')}${t('home.day')} ${weekdays[now.getDay()]}`);
  }, []);

  useEffect(() => {
    // Get announcement from cached settings store
    const ann = getAnnouncement();
    if (ann) setAnnouncement(ann);
    fetchAll();
    fetchHitokoto();
    if (user) fetchRecommendations();
  }, [user]);

  const fetchAll = async () => {
    try {
      setFetchError(false);
      const [problemsData, contestsData, listsData, discussionsData] = await Promise.allSettled([
        api.getProblems({ page: 1, pageSize: 5 }),
        api.getContests({ page: 1, pageSize: 5 }),
        api.getProblemLists({ page: 1, pageSize: 5 }),
        api.getDiscussions({ page: 1, pageSize: 5 }),
      ]);
      if (problemsData.status === 'fulfilled') {
        setRecentProblems(problemsData.value.problems);
      }
      if (contestsData.status === 'fulfilled') {
        setRecentContests(contestsData.value.contests);
      }
      if (listsData.status === 'fulfilled') {
        setRecentLists(listsData.value.lists);
      }
      if (discussionsData.status === 'fulfilled') {
        setRecentDiscussions(discussionsData.value.discussions);
      }
      // 如果全部失败则显示错误
      const allFailed = problemsData.status === 'rejected' && contestsData.status === 'rejected'
        && listsData.status === 'rejected' && discussionsData.status === 'rejected';
      if (allFailed) {
        setFetchError(true);
      }
    } catch (e) {
      console.error('Failed to fetch home data:', e);
      setFetchError(true);
    }
  };

  const fetchHitokoto = async () => {
    try {
      setHitokotoError(false);
      const res = await fetch('https://v1.hitokoto.cn/?c=a&c=b&c=d&c=i&c=k');
      const data = await res.json();
      setHitokoto(data);
    } catch {
      setHitokotoError(true);
    }
  };

  const fetchRecommendations = async () => {
    try {
      const data = await api.getRecommendedProblems(6);
      setRecommendations(data.recommendations || []);
    } catch (e) {
      // ignore — recommendations are optional
    }
  };

  const getContestStatus = (contest: any) => {
    const now = Date.now();
    const start = new Date(contest.start_time).getTime();
    const end = new Date(contest.end_time).getTime();
    if (now < start) return 'upcoming';
    if (now >= start && now <= end) return 'running';
    return 'ended';
  };

  const getContestStatusLabel = (status: string) => {
    if (status === 'upcoming') return t('contests.upcoming');
    if (status === 'running') return t('contests.running');
    return t('contests.ended');
  };

  return (
    <div className="home-page">
      {/* Hero Section */}
      <div className="home-hero">
        <div className="home-hero-left">
          <h1 className="home-title">{config.home.title || t('home.title')}</h1>
          <p className="home-date">
            <Calendar size={16} />
            {currentDate}
          </p>
          {user && (
            <p className="home-welcome">{t('home.welcomeBack').replace('{0}', user.username)}</p>
          )}
        </div>
        <div className="home-hero-right">
          <div className="home-stats-grid">
            <Link to="/problems" className="home-stat-card">
              <Target size={20} />
              <span className="stat-label">{t('nav.problems')}</span>
              <ChevronRight size={14} className="stat-arrow" />
            </Link>
            <Link to="/contests" className="home-stat-card">
              <Swords size={20} />
              <span className="stat-label">{t('nav.contests')}</span>
              <ChevronRight size={14} className="stat-arrow" />
            </Link>
            <Link to="/lists" className="home-stat-card">
              <BookOpen size={20} />
              <span className="stat-label">{t('nav.lists')}</span>
              <ChevronRight size={14} className="stat-arrow" />
            </Link>
            <Link to="/discussions/all" className="home-stat-card">
              <MessageSquare size={20} />
              <span className="stat-label">{t('nav.discussions')}</span>
              <ChevronRight size={14} className="stat-arrow" />
            </Link>
          </div>
        </div>
      </div>

      {/* Announcement */}
      {announcement && !dismissedAnnouncement && (
        <div className="home-announcement">
          <Megaphone size={16} className="announcement-icon" />
          <div className="announcement-content" dangerouslySetInnerHTML={{ __html: announcement }} />
          <button className="announcement-close" onClick={() => setDismissedAnnouncement(true)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Ads */}
      <AdSlot position="home_top" />

      {/* Hitokoto */}
      {hitokoto ? (
        <button className="home-hitokoto" onClick={fetchHitokoto} title={t('home.clickToRefresh')}>
          <Quote size={16} className="hitokoto-icon" aria-hidden="true" />
          <div className="hitokoto-text">{hitokoto.hitokoto}</div>
          <div className="hitokoto-from">—— {hitokoto.from || hitokoto.from_who || t('home.unknown')}</div>
        </button>
      ) : hitokotoError ? (
        <button className="home-hitokoto hitokoto-error" onClick={fetchHitokoto} title={t('home.clickToRefresh')}>
          <Quote size={16} className="hitokoto-icon" aria-hidden="true" />
          <div className="hitokoto-text">{t('home.clickToRefresh')}</div>
        </button>
      ) : null}

      {/* Content Grid */}
      {fetchError && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchAll}>
            <RefreshCw size={14} /> {t('common.retry')}
          </button>
        </div>
      )}

      {/* Personalized Recommendations (logged-in users only) */}
      {user && (
        <div className="home-recommend-section">
          <div className="home-recommend-header">
            <div className="recommend-title-block">
              <Sparkles size={18} className="recommend-icon" />
              <div>
                <h2>{t('home.recommendProblems')}</h2>
                <span className="recommend-subtitle">{t('home.recommendSubtitle')}</span>
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={fetchRecommendations}>
              <RefreshCw size={14} /> {t('home.refreshRecommend')}
            </button>
          </div>
          {recommendations.length === 0 ? (
            <div className="home-empty">{t('home.noRecommendations')}</div>
          ) : (
            <div className="recommend-cards">
              {recommendations.map((p: any) => (
                <Link key={p.id} to={`/problems/${p.slug || p.id}`} className="recommend-card">
                  <div className="recommend-card-header">
                    <span className="difficulty-dot" style={{ color: DIFFICULTY_COLORS[p.difficulty] || '#8b8fa3' }}>●</span>
                    <span className="recommend-card-difficulty">{p.difficulty}</span>
                    {p.rating && (
                      <span className="recommend-card-rating">{p.rating}</span>
                    )}
                  </div>
                  <div className="recommend-card-title">{p.title}</div>
                  {p.reason && (
                    <div className="recommend-card-reason">{p.reason}</div>
                  )}
                  {p.tags && (
                    <div className="recommend-card-tags">
                      {(
                        Array.isArray(p.tags)
                          ? p.tags
                          : (typeof p.tags === 'string' ? p.tags.split(',') : [])
                      ).slice(0, 3).map((tag: string, i: number) => (
                        <span key={i} className="recommend-tag">#{tag}</span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="home-content-grid">
        {/* Recent Problems */}
        <div className="home-card">
          <div className="home-card-header">
            <h2><Target size={18} /> {t('home.recentProblems')}</h2>
            <Link to="/problems" className="home-card-more">{t('home.viewAll')} <ChevronRight size={14} /></Link>
          </div>
          <div className="home-card-body">
            {recentProblems.length === 0 ? (
              <div className="home-empty">{t('common.noData')}</div>
            ) : (
              recentProblems.map((p: any) => (
                <Link key={p.id} to={`/problems/${p.slug}`} className="home-item">
                  <span className="home-item-title">{p.title}</span>
                  <span className="home-item-meta">
                    <span className="difficulty-dot" style={{ color: DIFFICULTY_COLORS[p.difficulty] || '#8b8fa3' }}>●</span>
                    {p.difficulty}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent Contests */}
        <div className="home-card">
          <div className="home-card-header">
            <h2><Swords size={18} /> {t('home.recentContests')}</h2>
            <Link to="/contests" className="home-card-more">{t('home.viewAll')} <ChevronRight size={14} /></Link>
          </div>
          <div className="home-card-body">
            {recentContests.length === 0 ? (
              <div className="home-empty">{t('common.noData')}</div>
            ) : (
              recentContests.map((c: any) => {
                const status = getContestStatus(c);
                return (
                  <Link key={c.id} to={`/contests/${c.id}`} className="home-item">
                    <span className="home-item-title">{c.title}</span>
                    <span className={`home-item-status status-${status}`}>
                      {getContestStatusLabel(status)}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Lists */}
        <div className="home-card">
          <div className="home-card-header">
            <h2><BookOpen size={18} /> {t('home.recentLists')}</h2>
            <Link to="/lists" className="home-card-more">{t('home.viewAll')} <ChevronRight size={14} /></Link>
          </div>
          <div className="home-card-body">
            {recentLists.length === 0 ? (
              <div className="home-empty">{t('common.noData')}</div>
            ) : (
              recentLists.map((l: any) => (
                <Link key={l.id} to={`/lists/${l.id}`} className="home-item">
                  <span className="home-item-title">{l.title}</span>
                  <span className="home-item-meta">{l.problem_count ?? 0} {t('home.problemsCount')}</span>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent Discussions */}
        <div className="home-card">
          <div className="home-card-header">
            <h2><MessageSquare size={18} /> {t('home.recentDiscussions')}</h2>
            <Link to="/discussions/all" className="home-card-more">{t('home.viewAll')} <ChevronRight size={14} /></Link>
          </div>
          <div className="home-card-body">
            {recentDiscussions.length === 0 ? (
              <div className="home-empty">{t('common.noData')}</div>
            ) : (
              recentDiscussions.map((d: any) => (
                <Link key={d.id} to={`/discussions/${d.id}`} className="home-item">
                  <span className="home-item-title">{d.title}</span>
                  <span className="home-item-meta">{d.reply_count ?? 0} {t('home.repliesCount')}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
