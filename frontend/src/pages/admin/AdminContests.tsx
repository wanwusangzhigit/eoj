import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import {
  Trash2, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react';
import '../Admin.css';

export default function AdminContests() {
  useDocumentTitle(t('admin.contestManagement'));
  const addToast = useToastStore((s) => s.addToast);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const [adminContests, setAdminContests] = useState<any[]>([]);
  const [contestPagination, setContestPagination] = useState<any>(null);
  const [contestPage, setContestPage] = useState(1);

  useEffect(() => {
    fetchAdminContests();
  }, [contestPage, refreshKey]);

  const fetchAdminContests = async () => {
    try {
      const data = await api.getAdminContests({ page: contestPage, pageSize: 10 });
      setAdminContests(data.contests);
      setContestPagination(data.pagination);
    } catch (e) { console.error('Failed to fetch contests:', e); }
  };

  const handleDeleteContest = async (id: number) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return;
    try {
      await api.deleteContest(id);
      addToast('success', t('common.deleteSuccess'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.contestManagement')}</h2>
      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">{t('common.id')}</span>
          <span className="pm-col pm-col-title">{t('contests.title')}</span>
          <span className="pm-col" style={{width:'100px'}}>{t('contests.status')}</span>
          <span className="pm-col" style={{width:'160px'}}>{t('contests.startTime')}</span>
          <span className="pm-col" style={{width:'80px'}}>{t('contests.participants')}</span>
          <span className="pm-col" style={{width:'140px'}}>{t('common.actions')}</span>
        </div>
        {adminContests.length === 0 ? (
          <div className="pm-empty">{t('common.noData')}</div>
        ) : (
          adminContests.map((c: any) => (
            <div key={c.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{c.id}</span>
              <span className="pm-col pm-col-title">
                <a href={`/contests/${c.id}`} style={{color:'inherit',textDecoration:'none'}}>{c.title}</a>
              </span>
              <span className="pm-col" style={{width:'100px'}}>
                <span className={`badge ${c.status === 'running' ? 'badge-success' : c.status === 'upcoming' ? 'badge-info' : 'badge-ended'}`}>
                  {c.status}
                </span>
              </span>
              <span className="pm-col" style={{width:'160px', fontSize:'12px', color:'var(--text-secondary)'}}>
                {c.start_time ? new Date(c.start_time).toLocaleString() : '-'}
              </span>
              <span className="pm-col" style={{width:'80px'}}>{c.participant_count ?? 0}</span>
              <span className="pm-col" style={{width:'140px'}}>
                <div className="admin-row-actions">
                  <a href={`/contests/${c.id}`} className="btn-text-sm" title={t('admin.viewContest')}>
                    <ExternalLink size={13} /> {t('admin.viewContest')}
                  </a>
                  <button className="btn-icon-sm danger" title={t('common.delete')} onClick={() => handleDeleteContest(c.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </span>
            </div>
          ))
        )}
      </div>
      {contestPagination && contestPagination.totalPages > 1 && (
        <div className="pm-pagination">
          <button className="btn btn-secondary btn-sm" disabled={contestPage <= 1} onClick={() => setContestPage(contestPage - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span className="pm-page-info">{contestPage} / {contestPagination.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={contestPage >= contestPagination.totalPages} onClick={() => setContestPage(contestPage + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
