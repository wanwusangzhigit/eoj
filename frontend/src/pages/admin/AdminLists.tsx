import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import {
  Trash2, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react';
import '../Admin.css';

export default function AdminLists() {
  useDocumentTitle(t('admin.listManagement'));
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const [adminLists, setAdminLists] = useState<any[]>([]);
  const [listPagination, setListPagination] = useState<any>(null);
  const [listPage, setListPage] = useState(1);

  useEffect(() => {
    fetchAdminLists();
  }, [listPage, refreshKey]);

  const fetchAdminLists = async () => {
    try {
      const data = await api.getAdminLists({ page: listPage, pageSize: 10 });
      setAdminLists(data.lists);
      setListPagination(data.pagination);
    } catch (e) { console.error('Failed to fetch lists:', e); }
  };

  const handleDeleteList = async (id: number) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return;
    try {
      await api.deleteProblemList(id);
      useToastStore().addToast('success', t('common.deleteSuccess'));
      refresh();
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.listManagement')}</h2>
      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">{t('common.id')}</span>
          <span className="pm-col pm-col-title">{t('lists.title')}</span>
          <span className="pm-col" style={{width:'80px'}}>{t('admin.user')}</span>
          <span className="pm-col" style={{width:'80px'}}>{t('lists.problemCount')}</span>
          <span className="pm-col" style={{width:'80px'}}>{t('admin.public')}</span>
          <span className="pm-col" style={{width:'140px'}}>{t('common.actions')}</span>
        </div>
        {adminLists.length === 0 ? (
          <div className="pm-empty">{t('common.noData')}</div>
        ) : (
          adminLists.map((l: any) => (
            <div key={l.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{l.id}</span>
              <span className="pm-col pm-col-title">
                <a href={`/lists/${l.id}`} style={{color:'inherit',textDecoration:'none'}}>{l.title}</a>
              </span>
              <span className="pm-col" style={{width:'80px'}}>{l.username}</span>
              <span className="pm-col" style={{width:'80px'}}>{l.problem_count ?? 0}</span>
              <span className="pm-col" style={{width:'80px'}}>{l.is_public ? '✓' : '✗'}</span>
              <span className="pm-col" style={{width:'140px'}}>
                <div className="admin-row-actions">
                  <a href={`/lists/${l.id}`} className="btn-text-sm" title={t('admin.viewList')}>
                    <ExternalLink size={13} /> {t('admin.viewList')}
                  </a>
                  <button className="btn-icon-sm danger" title={t('common.delete')} onClick={() => handleDeleteList(l.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </span>
            </div>
          ))
        )}
      </div>
      {listPagination && listPagination.totalPages > 1 && (
        <div className="pm-pagination">
          <button className="btn btn-secondary btn-sm" disabled={listPage <= 1} onClick={() => setListPage(listPage - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span className="pm-page-info">{listPage} / {listPagination.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={listPage >= listPagination.totalPages} onClick={() => setListPage(listPage + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
