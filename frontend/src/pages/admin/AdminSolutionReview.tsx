import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { Check, X, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import '../Admin.css';

const STATUS_TABS = [
  { key: 'pending', label: t('review.pending') },
  { key: 'approved', label: t('review.approved') },
  { key: 'rejected', label: t('review.rejected') },
];

export default function AdminSolutionReview() {
  useDocumentTitle(t('review.title'));
  const addToast = useToastStore((s) => s.addToast);
  const [solutions, setSolutions] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    fetchSolutions();
  }, [page, status]);

  const fetchSolutions = async () => {
    setLoading(true);
    try {
      const data = await api.getPendingSolutions({ page, pageSize: 20, status });
      setSolutions(data.solutions);
      setPagination(data.pagination);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await api.approveSolution(id);
      addToast('success', t('review.approvedToast'));
      await fetchSolutions();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleReject = async (id: number) => {
    try {
      await api.rejectSolution(id, rejectReason);
      addToast('success', t('review.rejectedToast'));
      setRejectingId(null);
      setRejectReason('');
      await fetchSolutions();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('review.title')}</h2>

      <div className="type-tabs" style={{ marginBottom: 16 }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`type-tab ${status === tab.key ? 'active' : ''}`}
            onClick={() => { setStatus(tab.key); setPage(1); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">{t('common.id')}</span>
          <span className="pm-col pm-col-title">{t('review.problem')}</span>
          <span className="pm-col" style={{ width: '120px' }}>{t('review.author')}</span>
          <span className="pm-col" style={{ width: '120px' }}>{t('review.submittedAt')}</span>
          <span className="pm-col" style={{ width: '180px' }}>{t('common.actions')}</span>
        </div>
        {loading ? (
          <div className="pm-empty">{t('common.loading')}</div>
        ) : solutions.length === 0 ? (
          <div className="pm-empty">{t('review.noSolutions')}</div>
        ) : (
          solutions.map((s) => (
            <div key={s.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{s.id}</span>
              <span className="pm-col pm-col-title">
                <a href={`/problems/${s.problem_slug}`} target="_blank" rel="noopener" className="link">
                  {s.problem_title}
                </a>
                <div className="muted">{s.title}</div>
              </span>
              <span className="pm-col" style={{ width: '120px' }}>{s.username}</span>
              <span className="pm-col" style={{ width: '120px' }}>
                {new Date(s.created_at).toLocaleDateString()}
              </span>
              <span className="pm-col" style={{ width: '180px' }}>
                <div className="admin-row-actions">
                  <a href={`/solutions/${s.id}`} target="_blank" rel="noopener" className="btn-text-sm" title={t('review.viewSolution')}>
                    <ExternalLink size={13} />
                  </a>
                  {status === 'pending' && (
                    <>
                      <button className="btn-text-sm success" onClick={() => handleApprove(s.id)} title={t('review.approve')}>
                        <Check size={14} />
                      </button>
                      <button className="btn-text-sm danger" onClick={() => setRejectingId(s.id)} title={t('review.reject')}>
                        <X size={14} />
                      </button>
                    </>
                  )}
                  {status === 'rejected' && s.reject_reason && (
                    <span className="muted" title={s.reject_reason}>原因: {s.reject_reason}</span>
                  )}
                </div>
              </span>
            </div>
          ))
        )}
      </div>

      {rejectingId !== null && (
        <div className="admin-modal-overlay" onClick={() => setRejectingId(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('review.reject')}</h3>
            <label>
              <span>{t('review.rejectReason')}</span>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t('review.rejectReasonPlaceholder')}
              />
            </label>
            <div className="admin-form-actions">
              <button className="btn btn-primary btn-sm" onClick={() => handleReject(rejectingId)}>
                {t('review.reject')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setRejectingId(null); setRejectReason(''); }}>
                {t('reports.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn-icon-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>{t('common.page').replace('{0}', String(page)).replace('{1}', String(pagination.totalPages))}</span>
          <button className="btn-icon-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
