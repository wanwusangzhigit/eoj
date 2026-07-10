import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../Admin.css';

const STATUS_OPTIONS = ['open', 'in_progress', 'resolved', 'closed'];

const TYPE_LABELS: Record<string, string> = {
  typo: t('reports.typo'),
  wrong_answer: t('reports.wrong_answer'),
  ambiguous: t('reports.ambiguous'),
  missing_data: t('reports.missing_data'),
  other: t('reports.other'),
};

const STATUS_COLORS: Record<string, string> = {
  open: '#fe2c55',
  in_progress: '#ff7c00',
  resolved: '#52c41a',
  closed: '#888',
};

export default function AdminReports() {
  useDocumentTitle(t('reports.title'));
  const addToast = useToastStore((s) => s.addToast);
  const [reports, setReports] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [updateStatus, setUpdateStatus] = useState('in_progress');
  const [adminReply, setAdminReply] = useState('');

  useEffect(() => {
    fetchReports();
  }, [page, statusFilter]);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const data = await api.getProblemReports({ page, pageSize: 20, status: statusFilter || undefined });
      setReports(data.reports);
      setPagination(data.pagination);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDetail = (r: any) => {
    setSelectedReport(r);
    setUpdateStatus(r.status === 'open' ? 'in_progress' : r.status);
    setAdminReply(r.admin_reply || '');
  };

  const handleUpdate = async () => {
    if (!selectedReport) return;
    try {
      await api.updateProblemReport(selectedReport.id, updateStatus, adminReply);
      addToast('success', t('reports.reportUpdated'));
      setSelectedReport(null);
      await fetchReports();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('reports.title')}</h2>

      <div className="type-tabs" style={{ marginBottom: 16 }}>
        <button
          className={`type-tab ${!statusFilter ? 'active' : ''}`}
          onClick={() => { setStatusFilter(''); setPage(1); }}
        >
          {t('notifications.all')}
        </button>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            className={`type-tab ${statusFilter === s ? 'active' : ''}`}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {t(`reports.${s}`)}
          </button>
        ))}
      </div>

      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">{t('common.id')}</span>
          <span className="pm-col pm-col-title">{t('reports.problem')}</span>
          <span className="pm-col" style={{ width: '100px' }}>{t('reports.reportType')}</span>
          <span className="pm-col" style={{ width: '100px' }}>{t('reports.reporter')}</span>
          <span className="pm-col" style={{ width: '90px' }}>{t('reports.status')}</span>
          <span className="pm-col" style={{ width: '100px' }}>{t('common.actions')}</span>
        </div>
        {loading ? (
          <div className="pm-empty">{t('common.loading')}</div>
        ) : reports.length === 0 ? (
          <div className="pm-empty">{t('reports.noReports')}</div>
        ) : (
          reports.map((r) => (
            <div key={r.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{r.id}</span>
              <span className="pm-col pm-col-title">
                <a href={`/problems/${r.problem_slug}`} target="_blank" rel="noopener" className="link">
                  {r.problem_title}
                </a>
              </span>
              <span className="pm-col" style={{ width: '100px' }}>
                {TYPE_LABELS[r.type] || r.type}
              </span>
              <span className="pm-col" style={{ width: '100px' }}>{r.reporter_name}</span>
              <span className="pm-col" style={{ width: '90px' }}>
                <span
                  className="status-tag"
                  style={{
                    color: STATUS_COLORS[r.status],
                    borderColor: STATUS_COLORS[r.status],
                  }}
                >
                  {t(`reports.${r.status}`)}
                </span>
              </span>
              <span className="pm-col" style={{ width: '100px' }}>
                <button className="btn-text-sm" onClick={() => handleOpenDetail(r)}>
                  {t('reports.updateStatus')}
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {selectedReport && (
        <div className="admin-modal-overlay" onClick={() => setSelectedReport(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('reports.title')} #{selectedReport.id}</h3>
            <div className="report-detail">
              <div><strong>{t('reports.problem')}:</strong> {selectedReport.problem_title}</div>
              <div><strong>{t('reports.reporter')}:</strong> {selectedReport.reporter_name}</div>
              <div><strong>{t('reports.reportType')}:</strong> {TYPE_LABELS[selectedReport.type] || selectedReport.type}</div>
              <div><strong>{t('reports.description')}:</strong></div>
              <p className="report-desc">{selectedReport.description}</p>
            </div>
            <label>
              <span>{t('reports.status')}</span>
              <select value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{t(`reports.${s}`)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('reports.adminReply')}</span>
              <textarea
                rows={3}
                value={adminReply}
                onChange={(e) => setAdminReply(e.target.value)}
              />
            </label>
            <div className="admin-form-actions">
              <button className="btn btn-primary btn-sm" onClick={handleUpdate}>
                {t('reports.updateStatus')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedReport(null)}>
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
