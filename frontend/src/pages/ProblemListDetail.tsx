import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { List, ChevronRight, User, StickyNote, Hash, Copy, Share2, CheckCircle, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import { useToastStore } from '../store/toast';
import { useAuthStore } from '../store/auth';
import './ProblemListDetail.css';

export default function ProblemListDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const { user } = useAuthStore();
  const [list, setList] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // 克隆题单到自己的题单
  const handleClone = async () => {
    if (!id) return;
    if (!window.confirm(t('problemListDetail.cloneConfirm'))) return;
    try {
      const result = await api.cloneProblemList(Number(id));
      addToast('success', t('problemListDetail.cloneDone'));
      navigate(`/lists/${result.id}`);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  // 复制分享链接
  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard?.writeText(url).then(() => {
      addToast('success', t('problemListDetail.shareCopied'));
    }).catch(() => {
      addToast('error', t('common.error'));
    });
  };

  // 删除题单(创建者或管理员)
  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm(t('problemListDetail.deleteConfirm'))) return;
    try {
      await api.deleteProblemList(Number(id));
      addToast('success', t('problemListDetail.deleteDone'));
      navigate('/lists');
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const fetchList = useCallback(async () => {
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
  }, [id, addToast]);

  useEffect(() => {
    if (!id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchList();
  }, [id, fetchList]);

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
          <div className="list-info-actions">
            {user && (
              <button className="btn btn-secondary btn-sm" onClick={handleClone} title={t('problemListDetail.clone')}>
                <Copy size={14} /> {t('problemListDetail.clone')}
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={handleShare} title={t('problemListDetail.share')}>
              <Share2 size={14} /> {t('problemListDetail.share')}
            </button>
            {user && (list.user_id === user.id || user.role === 'admin' || user.role === 'super_admin' || user.id === 1) && (
              <button className="btn btn-danger btn-sm" onClick={handleDelete} title={t('problemListDetail.delete')}>
                <Trash2 size={14} /> {t('problemListDetail.delete')}
              </button>
            )}
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

        {/* 题单进度追踪 */}
        {user && items.length > 0 && (
          <div className="list-progress">
            {(() => {
              const solvedCount = items.filter((it: any) => it.solved === 1).length;
              const pct = Math.round((solvedCount / items.length) * 100);
              return (
                <>
                  <div className="list-progress-header">
                    <span className="list-progress-label">{t('problemListDetail.progress')}</span>
                    <span className="list-progress-count">{solvedCount}/{items.length} ({pct}%)</span>
                  </div>
                  <div className="list-progress-track">
                    <div className="list-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                </>
              );
            })()}
          </div>
        )}
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
                <span className="col-order">
                  {user && item.solved === 1 ? (
                    <CheckCircle size={15} className="list-solved-icon" aria-label={t('problemListDetail.solved')} />
                  ) : (
                    idx + 1
                  )}
                </span>
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
