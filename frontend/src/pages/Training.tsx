import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { BookOpen, Search, GraduationCap, AlertCircle, Layers } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './Training.css';

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: '#52c41a',
  intermediate: '#ff7c00',
  advanced: '#fe2c55',
};

export default function Training() {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  useDocumentTitle(t('training.title'));

  useEffect(() => {
    fetchPlans();
  }, [search]);

  const fetchPlans = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getTrainingPlans({ search: search || undefined, pageSize: 30 });
      setPlans(data.plans);
    } catch (e) {
      console.error('Failed to fetch training plans:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  return (
    <div className="training-page">
      <div className="training-header">
        <div className="training-title-section">
          <GraduationCap size={28} className="title-icon" />
          <h1 className="page-title">{t('training.title')}</h1>
        </div>
        <form className="search-bar" onSubmit={handleSearch}>
          <Search size={16} />
          <input
            type="text"
            placeholder={t('training.searchPlans')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : loadError ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchPlans}>{t('common.retry')}</button>
        </div>
      ) : plans.length === 0 ? (
        <EmptyState icon={GraduationCap} title={t('training.noPlans')} />
      ) : (
        <div className="training-grid">
          {plans.map((plan) => {
            const progress = plan.progress;
            const percent = progress && progress.total > 0
              ? Math.round((progress.completed / progress.total) * 100)
              : 0;
            const isJoined = !!progress;
            return (
              <Link to={`/training/${plan.id}`} key={plan.id} className="training-card">
                {plan.cover_image ? (
                  <div className="training-card-cover" style={{ backgroundImage: `url(${plan.cover_image})` }} />
                ) : (
                  <div className="training-card-cover placeholder">
                    <GraduationCap size={32} />
                  </div>
                )}
                <div className="training-card-body">
                  <div className="training-card-title-row">
                    <h3>{plan.title}</h3>
                    {plan.is_official ? <span className="official-badge">{t('training.official')}</span> : null}
                  </div>
                  <p className="training-card-desc">{plan.description}</p>
                  <div className="training-card-meta">
                    <span
                      className="difficulty-tag"
                      style={{ color: DIFFICULTY_COLORS[plan.difficulty] || '#999', borderColor: DIFFICULTY_COLORS[plan.difficulty] || '#999' }}
                    >
                      {t(`training.${plan.difficulty}`)}
                    </span>
                    <span className="meta-item">
                      <Layers size={14} /> {t('training.chaptersCount').replace('{0}', String(plan.chapter_count || 0))}
                    </span>
                    <span className="meta-item">
                      <BookOpen size={14} /> {t('training.problemsCount').replace('{0}', String(plan.problem_count || 0))}
                    </span>
                  </div>
                  {isJoined && (
                    <div className="training-card-progress">
                      <div className="progress-bar">
                        <div className="progress-bar-inner" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="progress-text">
                        {t('training.progressLabel').replace('{0}', String(progress.completed)).replace('{1}', String(progress.total))}
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
