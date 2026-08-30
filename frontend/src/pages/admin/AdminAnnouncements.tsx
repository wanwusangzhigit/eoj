import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { Pin, Edit3, Trash2, Plus, X, Check } from 'lucide-react';
import { t } from '../../i18n';

export default function AdminAnnouncements() {
  const addToast = useToastStore((s) => s.addToast);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  useDocumentTitle(t('admin.announcementsManagement'));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminAnnouncements({ page: 1, pageSize: 50 });
      setAnnouncements(data.announcements);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreate = () => {
    setEditingId(null);
    setTitle('');
    setContent('');
    setIsPinned(false);
    setShowForm(true);
  };

  const openEdit = (a: any) => {
    setEditingId(a.id);
    setTitle(a.title);
    setContent('');
    setIsPinned(a.is_pinned === 1);
    setShowForm(true);
    // 编辑时拉取完整内容(列表接口不返回 content)
    api.getAnnouncement(a.id).then((d) => setContent(d.announcement.content || '')).catch(() => {});
  };

  const handleSave = async () => {
    if (!title.trim()) {
      addToast('error', t('announcements.titleLabel') + ' ' + t('common.required'));
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.updateAnnouncement(editingId, { title: title.trim(), content, is_pinned: isPinned });
        addToast('success', t('announcements.save'));
      } else {
        await api.createAnnouncement({ title: title.trim(), content, is_pinned: isPinned });
        addToast('success', t('announcements.publish'));
      }
      setShowForm(false);
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t('announcements.deleteWarning'))) return;
    try {
      await api.deleteAnnouncement(id);
      addToast('success', t('common.success'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleTogglePin = async (a: any) => {
    try {
      await api.updateAnnouncement(a.id, { is_pinned: a.is_pinned === 1 ? false : true });
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>{t('admin.announcementsManagement')}</h2>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <Plus size={14} /> {t('announcements.publish')}
        </button>
      </div>

      {showForm && (
        <div className="admin-card" style={{ marginBottom: 16, padding: 16 }}>
          <div className="form-group">
            <label>{t('announcements.titleLabel')}</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="form-group">
            <label>{t('announcements.contentLabel')}</label>
            <textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
            {t('announcements.pinnedLabel')}
          </label>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              <Check size={14} /> {t('announcements.save')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>
              <X size={14} /> {t('announcements.cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-container"><div className="loading-spinner"></div></div>
      ) : announcements.length === 0 ? (
        <div className="empty">{t('announcements.empty')}</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('announcements.titleLabel')}</th>
              <th style={{ width: 90 }}>{t('announcements.pinnedLabel')}</th>
              <th style={{ width: 160 }}>时间</th>
              <th style={{ width: 160 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {announcements.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td>
                  <button className={`btn btn-sm ${a.is_pinned === 1 ? 'btn-primary' : 'btn-secondary'}`} onClick={() => handleTogglePin(a)}>
                    <Pin size={13} />
                  </button>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {new Date(a.created_at).toLocaleString()}
                </td>
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(a)}>
                    <Edit3 size={13} /> {t('announcements.edit')}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(a.id)}>
                    <Trash2 size={13} /> {t('announcements.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
