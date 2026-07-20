import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { List, ChevronRight, User, StickyNote, Hash } from 'lucide-react';
import { t } from '../i18n';
import { useToastStore } from '../store/toast';
import './ProblemListDetail.css';

export default function ProblemListDetail() {
  const { id } = useParams<{ id: string }>();
  const addToast = useToastStore((s) => s.addToast);
  const [list, setList] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchList();
  }, [id]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const data = await api.getProblemList(Number(id));
      setList(data.list);
      setItems(data.items || []);
    } catch (e) {
      addToast('error', t('problemListDetail.loadError'));
      console.error('Failed to fetch problem list:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (loadError) {
    return (
      <div className="empty-container">
        <h2>{t('problemListDetail.loadError')}</h2>
        <Link to="/lists" className="btn btn-primary">{t('problemListDetail.backToLists')}</Link>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="empty-container">
        <h2>{t('problemListDetail.notFound')}</h2>
        <Link to="/lists" className="btn btn-primary">{t('problemListDetail.backToLists')}</Link>
      </div>
    );
  }

  return (
    <div className="problem-list-detail-page">
      <div className="breadcrumb">
        <Link to="/lists">{t('lists.title')}</Link>
        <ChevronRight size={14} />
        <span>{list.title}</span>
      </div>

      <div className="list-info-card">
        <div className="list-info-header">
          <div className="list-info-title-section">
            <List size={24} className="list-icon" />
            <h1 className="list-detail-title">{list.title}</h1>
          </div>
        </div>

        {list.description && (
          <p className="list-description">{list.description}</p>
        )}

        <div className="list-meta">
          <span className="meta-item">
            <Hash size={14} />
            {t('lists.problemCount')}: {list.problem_count ?? items.length}
          </span>
          <span className="meta-item">
            <User size={14} />
            {list.creator || list.username || ''}
          </span>
        </div>
      </div>

      <div className="list-problems-section">
        <h3>{t('contests.problems')}</h3>
        {items.length === 0 ? (
          <div className="empty-problems">{t('problemListDetail.noProblems')}</div>
        ) : (
          <div className="list-problems-table">
            <div className="list-problems-table-header">
              <span className="col-order">#</span>
              <span className="col-title">{t('problemList.titleCol')}</span>
              <span className="col-note">{t('lists.note')}</span>
            </div>
            {items.map((item: any, idx: number) => (
              <Link
                key={item.id || item.problem_id || idx}
                to={`/problems/${item.slug || item.problem_id}`}
                className="list-problem-row"
              >
                <span className="col-order">{idx + 1}</span>
                <span className="col-title">{item.title || item.problem_title || `Problem ${item.problem_id}`}</span>
                <span className="col-note">
                  {item.note ? (
                    <span className="note-content">
                      <StickyNote size={12} />
                      {item.note}
                    </span>
                  ) : (
                    <span className="note-empty">—</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
