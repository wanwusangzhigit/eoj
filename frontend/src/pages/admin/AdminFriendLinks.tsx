import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { Plus, Edit3, Trash2, X, Check, Link2 } from 'lucide-react';
import { t } from '../../i18n';

export default function AdminFriendLinks() {
  const addToast = useToastStore((s) => s.addToast);
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  useDocumentTitle(t('admin.friendLinksManagement'));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminFriendLinks();
      setLinks(data.links || []);
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
    setName(''); setUrl(''); setDescription(''); setIcon('');
    setSortOrder(links.length);
    setEnabled(true);
    setShowForm(true);
  };

  const openEdit = (l: any) => {
    setEditingId(l.id);
    setName(l.name); setUrl(l.url); setDescription(l.description || '');
    setIcon(l.icon || ''); setSortOrder(l.sort_order || 0); setEnabled(l.enabled === 1);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !url.trim()) {
      addToast('error', t('friendLinks.nameUrlRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim(), url: url.trim(), description, icon, sort_order: sortOrder, enabled };
      if (editingId) {
        await api.updateFriendLink(editingId, payload);
        addToast('success', t('common.success'));
      } else {
        await api.createFriendLink(payload);
        addToast('success', t('common.success'));
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
    if (!window.confirm(t('friendLinks.deleteConfirm'))) return;
    try {
      await api.deleteFriendLink(id);
      addToast('success', t('common.success'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleToggle = async (l: any) => {
    try {
      await api.updateFriendLink(l.id, { enabled: l.enabled === 1 ? false : true });
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>{t('admin.friendLinksManagement')}</h2>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <Plus size={14} /> {t('friendLinks.add')}
        </button>
      </div>

      {showForm && (
        <div className="admin-card" style={{ marginBottom: 16, padding: 16 }}>
          <div className="form-group">
            <label>{t('friendLinks.name')}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div className="form-group">
            <label>{t('friendLinks.url')}</label>
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://..." />
          </div>
          <div className="form-group">
            <label>{t('friendLinks.description')}</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
          </div>
          <div className="form-group">
            <label>{t('friendLinks.icon')}</label>
            <input type="text" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={500} placeholder="https://... (可选)" />
          </div>
          <div className="form-group">
            <label>{t('friendLinks.sortOrder')}</label>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)} />
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t('friendLinks.enabled')}
          </label>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              <Check size={14} /> {t('common.save')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>
              <X size={14} /> {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-container"><div className="loading-spinner"></div></div>
      ) : links.length === 0 ? (
        <div className="empty">{t('friendLinks.empty')}</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>#</th>
              <th>{t('friendLinks.name')}</th>
              <th>{t('friendLinks.url')}</th>
              <th style={{ width: 90 }}>{t('friendLinks.enabled')}</th>
              <th style={{ width: 160 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id}>
                <td>{l.sort_order}</td>
                <td>
                  {l.icon && <img src={l.icon} alt="" style={{ width: 16, height: 16, verticalAlign: -3, marginRight: 6 }} />}
                  {l.name}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}><Link2 size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{l.url}</td>
                <td>
                  <button className={`btn btn-sm ${l.enabled === 1 ? 'btn-primary' : 'btn-secondary'}`} onClick={() => handleToggle(l)}>
                    {l.enabled === 1 ? t('friendLinks.on') : t('friendLinks.off')}
                  </button>
                </td>
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(l)}>
                    <Edit3 size={13} /> {t('common.edit')}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(l.id)}>
                    <Trash2 size={13} /> {t('common.delete')}
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
