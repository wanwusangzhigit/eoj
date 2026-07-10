import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import {
  Trash2, ChevronLeft, ChevronRight, Image, File,
} from 'lucide-react';
import '../Admin.css';

export default function AdminUploads() {
  useDocumentTitle(t('admin.uploadManagement'));
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const [adminUploads, setAdminUploads] = useState<any[]>([]);
  const [uploadPagination, setUploadPagination] = useState<any>(null);
  const [uploadPage, setUploadPage] = useState(1);
  const [uploadTypeFilter, setUploadTypeFilter] = useState('');

  useEffect(() => {
    fetchAdminUploads();
  }, [uploadPage, uploadTypeFilter, refreshKey]);

  const fetchAdminUploads = async () => {
    try {
      const data = await api.getUploads({ page: uploadPage, pageSize: 10, type: uploadTypeFilter || undefined });
      setAdminUploads(data.uploads);
      setUploadPagination(data.pagination);
    } catch (e) { console.error('Failed to fetch uploads:', e); }
  };

  const handleDeleteUpload = async (id: number) => {
    if (!window.confirm(t('common.deleteConfirm'))) return;
    try {
      await api.deleteUpload(id);
      useToastStore().addToast('success', t('common.deleteSuccess'));
      refresh();
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.uploadManagement')}</h2>
      <div className="filter-bar" style={{marginBottom:'12px'}}>
        <select className="filter-select" value={uploadTypeFilter} onChange={(e) => { setUploadTypeFilter(e.target.value); setUploadPage(1); }}>
          <option value="">{t('common.all')}</option>
          <option value="image">{t('common.image')}</option>
          <option value="file">{t('common.file')}</option>
        </select>
      </div>
      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">{t('common.id')}</span>
          <span className="pm-col pm-col-title">{t('common.fileName')}</span>
          <span className="pm-col" style={{width:'80px'}}>{t('common.fileType')}</span>
          <span className="pm-col" style={{width:'80px'}}>{t('common.fileSize')}</span>
          <span className="pm-col" style={{width:'100px'}}>{t('common.uploadedBy')}</span>
          <span className="pm-col" style={{width:'140px'}}>{t('common.uploadTime')}</span>
          <span className="pm-col" style={{width:'80px'}}>{t('common.actions')}</span>
        </div>
        {adminUploads.length === 0 ? (
          <div className="pm-empty">{t('common.noFiles')}</div>
        ) : (
          adminUploads.map((u: any) => (
            <div key={u.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{u.id}</span>
              <span className="pm-col pm-col-title" style={{display:'flex',alignItems:'center',gap:'6px'}}>
                {u.file_type === 'image' ? <Image size={14} style={{color:'var(--accent)'}} /> : <File size={14} style={{color:'var(--text-secondary)'}} />}
                <a href={u.url} target="_blank" rel="noopener noreferrer" style={{color:'var(--accent)',textDecoration:'none'}}>
                  {u.original_name}
                </a>
              </span>
              <span className="pm-col" style={{width:'80px'}}>
                <span className={`badge ${u.file_type === 'image' ? 'badge-info' : 'badge-warning'}`}>
                  {u.file_type === 'image' ? t('common.image') : t('common.file')}
                </span>
              </span>
              <span className="pm-col" style={{width:'80px',fontSize:'12px',color:'var(--text-secondary)'}}>
                {u.size_bytes < 1024 ? `${u.size_bytes}B` : u.size_bytes < 1048576 ? `${(u.size_bytes / 1024).toFixed(1)}KB` : `${(u.size_bytes / 1048576).toFixed(1)}MB`}
              </span>
              <span className="pm-col" style={{width:'100px',fontSize:'12px'}}>{u.username || `User#${u.user_id}`}</span>
              <span className="pm-col" style={{width:'140px',fontSize:'12px',color:'var(--text-secondary)'}}>
                {u.created_at ? new Date(u.created_at).toLocaleString() : '-'}
              </span>
              <span className="pm-col" style={{width:'80px'}}>
                <button className="btn btn-danger btn-sm" onClick={() => handleDeleteUpload(u.id)}>
                  <Trash2 size={14} /> {t('common.delete')}
                </button>
              </span>
            </div>
          ))
        )}
      </div>
      {uploadPagination && uploadPagination.totalPages > 1 && (
        <div className="pm-pagination">
          <button className="btn btn-secondary btn-sm" disabled={uploadPage <= 1} onClick={() => setUploadPage(uploadPage - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span className="pm-page-info">{uploadPage} / {uploadPagination.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={uploadPage >= uploadPagination.totalPages} onClick={() => setUploadPage(uploadPage + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
