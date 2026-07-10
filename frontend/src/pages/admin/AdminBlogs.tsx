import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { Search, Trash2, Eye, ChevronLeft, ChevronRight, X, FileText } from 'lucide-react';
import '../Admin.css';

const STATUS_OPTIONS = ['published', 'draft', 'archived', 'deleted'];

const STATUS_LABELS: Record<string, string> = {
  published: '已发布',
  draft: '草稿',
  archived: '已归档',
  deleted: '已删除',
};

const STATUS_COLORS: Record<string, string> = {
  published: '#52c41a',
  draft: '#888',
  archived: '#ff7c00',
  deleted: '#fe2c55',
};

export default function AdminBlogs() {
  useDocumentTitle(t('admin.blogManagement'));
  const addToast = useToastStore((s) => s.addToast);

  const [blogs, setBlogs] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedBlog, setSelectedBlog] = useState<any>(null);
  const [blogDetail, setBlogDetail] = useState<string>('');
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchBlogs();
  }, [page, debouncedSearch, statusFilter]);

  const fetchBlogs = async () => {
    setLoading(true);
    try {
      const data = await api.getAdminBlogs({
        page,
        pageSize: 20,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
      });
      setBlogs(data.blogs);
      setPagination(data.pagination);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDetail = async (blog: any) => {
    setSelectedBlog(blog);
    setBlogDetail('');
    setLoadingDetail(true);
    try {
      const data = await api.getAdminBlog(blog.id);
      setBlogDetail(data.blog?.content || '');
    } catch (e: any) {
      setBlogDetail('Failed to load: ' + (e.message || ''));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleStatusChange = async (blog: any, newStatus: string) => {
    try {
      await api.updateBlogStatus(blog.id, newStatus);
      addToast('success', t('admin.blogStatusUpdated'));
      await fetchBlogs();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleDelete = async (blog: any) => {
    const msg = t('admin.blogDeleteConfirm').replace('{title}', blog.title);
    if (!confirm(msg)) return;
    try {
      await api.deleteBlogAdmin(blog.id);
      addToast('success', t('admin.blogDeleted'));
      setSelectedBlog(null);
      await fetchBlogs();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.blogManagement')}</h2>

      {/* Filters */}
      <div className="admin-filters" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder={t('admin.searchBlogs')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="status-select"
        >
          <option value="">{t('common.all')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">ID</span>
          <span className="pm-col pm-col-title">{t('admin.blogTitle')}</span>
          <span className="pm-col" style={{ width: '120px' }}>{t('admin.author')}</span>
          <span className="pm-col" style={{ width: '100px' }}>{t('admin.blogStatus')}</span>
          <span className="pm-col" style={{ width: '80px' }}>{t('admin.views')}</span>
          <span className="pm-col" style={{ width: '80px' }}>{t('admin.likes')}</span>
          <span className="pm-col" style={{ width: '80px' }}>{t('admin.comments')}</span>
          <span className="pm-col" style={{ width: '140px' }}>{t('common.actions')}</span>
        </div>
        {loading ? (
          <div className="pm-empty">{t('common.loading')}</div>
        ) : blogs.length === 0 ? (
          <div className="pm-empty">{t('admin.noBlogs')}</div>
        ) : (
          blogs.map((b) => (
            <div key={b.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{b.id}</span>
              <span className="pm-col pm-col-title">
                <a href={`/blogs/${b.id}`} target="_blank" rel="noopener" className="link">
                  {b.title}
                </a>
              </span>
              <span className="pm-col" style={{ width: '120px' }}>
                <a href={`/users/${b.username}`} target="_blank" rel="noopener" className="link">
                  {b.username}
                </a>
              </span>
              <span className="pm-col" style={{ width: '100px' }}>
                <select
                  value={b.status}
                  onChange={(e) => handleStatusChange(b, e.target.value)}
                  className="status-inline-select"
                  style={{ color: STATUS_COLORS[b.status] || '#888' }}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </span>
              <span className="pm-col" style={{ width: '80px' }}>{b.view_count ?? 0}</span>
              <span className="pm-col" style={{ width: '80px' }}>{b.like_count ?? 0}</span>
              <span className="pm-col" style={{ width: '80px' }}>{b.comment_count ?? 0}</span>
              <span className="pm-col" style={{ width: '140px', display: 'flex', gap: 6 }}>
                <button className="btn-text-sm" onClick={() => handleOpenDetail(b)} title={t('admin.viewBlog')}>
                  <Eye size={14} />
                </button>
                <button
                  className="btn-text-sm danger"
                  onClick={() => handleDelete(b)}
                  title={t('common.delete')}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
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

      {/* Detail modal */}
      {selectedBlog && (
        <div className="admin-modal-overlay" onClick={() => setSelectedBlog(null)}>
          <div className="admin-modal admin-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>
                <FileText size={16} style={{ display: 'inline', marginRight: 6 }} />
                {selectedBlog.title}
              </h3>
              <button className="btn-icon-sm" onClick={() => setSelectedBlog(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="blog-detail-meta">
                <div><strong>{t('admin.author')}:</strong> {selectedBlog.username}</div>
                <div><strong>{t('admin.blogStatus')}:</strong>
                  <span style={{ color: STATUS_COLORS[selectedBlog.status] || '#888', marginLeft: 6 }}>
                    {STATUS_LABELS[selectedBlog.status] || selectedBlog.status}
                  </span>
                </div>
                <div><strong>{t('admin.createdAt')}:</strong> {new Date(selectedBlog.created_at).toLocaleString()}</div>
                {selectedBlog.tags && <div><strong>{t('admin.tags')}:</strong> {selectedBlog.tags}</div>}
              </div>
              <div className="blog-content-preview">
                {loadingDetail ? (
                  <div className="pm-empty">{t('common.loading')}</div>
                ) : (
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.6, margin: 0, maxHeight: '50vh', overflow: 'auto' }}>
                    {blogDetail || t('admin.noContent')}
                  </pre>
                )}
              </div>
            </div>
            <div className="admin-form-actions">
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleDelete(selectedBlog)}
              >
                <Trash2 size={14} /> {t('common.delete')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedBlog(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
