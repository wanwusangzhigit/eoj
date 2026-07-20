import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useSettingsStore } from '../store/settings';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../store/toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { Image, FileText, Trash2, Upload, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './MyFiles.css';

export default function MyFiles() {
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const getImageUploadEnabled = useSettingsStore((s) => s.getImageUploadEnabled);
  const getUploadEnabled = useSettingsStore((s) => s.getUploadEnabled);
  const perms = usePermissions();
  const [uploads, setUploads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'image' | 'file'>('image');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useDocumentTitle(t('common.myFiles'));

  const imageUploadAllowed = getImageUploadEnabled() || perms.canManageUploads;
  const fileUploadAllowed = getUploadEnabled() || perms.canManageUploads;

  // Auto-switch tab if current tab's upload is disabled
  useEffect(() => {
    if (activeTab === 'image' && !imageUploadAllowed && fileUploadAllowed) {
      setActiveTab('file');
    } else if (activeTab === 'file' && !fileUploadAllowed && imageUploadAllowed) {
      setActiveTab('image');
    }
  }, [imageUploadAllowed, fileUploadAllowed]);

  const fetchUploads = async (p: number = page) => {
    try {
      const data = await api.getUploads({ page: p, pageSize: 20, type: activeTab });
      setUploads(data.uploads);
      setTotalPages(data.pagination.totalPages);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchUploads(1);
  }, [activeTab]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (activeTab === 'image') {
        await api.uploadImage(file);
        addToast('success', t('common.uploadSuccess'));
      } else {
        await api.uploadFile(file);
        addToast('success', t('common.uploadSuccess'));
      }
      fetchUploads(page);
    } catch (e: any) {
      addToast('error', e.message || t('common.uploadFailed'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('common.deleteConfirm'))) return;
    try {
      await api.deleteUpload(id);
      addToast('success', t('common.deleteSuccess'));
      fetchUploads(page);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const copyMarkdown = async (item: any) => {
    const markdown = `![${item.original_name}](${item.url})`;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopiedId(item.id);
      addToast('success', t('common.copied'));
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      addToast('error', t('common.error'));
    }
  };

  const canUploadCurrentTab = activeTab === 'image' ? imageUploadAllowed : fileUploadAllowed;

  if (!user) return null;

  return (
    <div className="myfiles-page">
      <h1>{t('common.myFiles')}</h1>

      <div className="myfiles-tabs">
        {imageUploadAllowed && (
          <button className={`tab-btn ${activeTab === 'image' ? 'active' : ''}`} onClick={() => setActiveTab('image')}>
            <Image size={16} /> {t('common.image')}
          </button>
        )}
        {fileUploadAllowed && (
          <button className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`} onClick={() => setActiveTab('file')}>
            <FileText size={16} /> {t('common.file')}
          </button>
        )}
      </div>

      {canUploadCurrentTab && (
        <div className="myfiles-toolbar">
          <input
            ref={fileInputRef}
            type="file"
            accept={activeTab === 'image' ? 'image/*' : undefined}
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={14} />
            {uploading ? t('common.loading') : (activeTab === 'image' ? t('common.uploadImage') : t('common.uploadFile'))}
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : uploads.length === 0 ? (
        <div className="myfiles-empty">{t('common.noFiles')}</div>
      ) : (
        <>
          <div className="myfiles-grid">
            {activeTab === 'image' ? uploads.map((item: any) => (
              <div key={item.id} className="myfiles-card image-card">
                <div className="image-preview">
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <img src={item.url} alt={item.original_name} />
                  </a>
                </div>
                <div className="image-info">
                  <span className="image-name" title={item.original_name}>{item.original_name}</span>
                  <span className="image-size">{formatSize(item.size_bytes)}</span>
                  <button className="btn-icon" onClick={() => copyMarkdown(item)} title={t('common.copyMarkdown')}>
                    {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button className="btn-icon" onClick={() => handleDelete(item.id)} title={t('common.delete')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )) : uploads.map((item: any) => (
              <div key={item.id} className="myfiles-card file-card">
                <FileText size={24} />
                <div className="file-info">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="file-name">{item.original_name}</a>
                  <span className="file-meta">{formatSize(item.size_bytes)} · {new Date(item.created_at).toLocaleString()}</span>
                </div>
                <button className="btn-icon" onClick={() => handleDelete(item.id)} title={t('common.delete')}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="myfiles-pagination">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => { setPage(page - 1); fetchUploads(page - 1); }}>
                <ChevronLeft size={14} />
              </button>
              <span>{page} / {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => { setPage(page + 1); fetchUploads(page + 1); }}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
