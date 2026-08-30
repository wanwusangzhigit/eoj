import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { Plus, Edit3, Trash2, X, Check, FileText, ExternalLink } from 'lucide-react';
import { t } from '../../i18n';

export default function AdminCustomPages() {
  const addToast = useToastStore((s) => s.addToast);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showInFooter, setShowInFooter] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  useDocumentTitle(t('admin.customPagesManagement'));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminPages();
      setPages(data.pages || []);
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
    setSlug(''); setTitle(''); setContent('');
    setShowInFooter(false); setEnabled(true);
    setShowForm(true);
  };

  const openEdit = (p: any) => {
    setEditingId(p.id);
    setSlug(p.slug); setTitle(p.title); setContent('');
    setShowInFooter(p.show_in_footer === 1); setEnabled(p.enabled === 1);
    setShowForm(true);
    // 编辑时拉取完整内容
    api.getPage(p.slug).then((d) => setContent(d.page.content || '')).catch(() => {});
  };

  const handleSave = async () => {
    if (!slug.trim() || !title.trim()) {
      addToast('error', t('customPages.slugTitleRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = { slug: slug.trim().toLowerCase(), title: title.trim(), content, show_in_footer: showInFooter, enabled };
      if (editingId) {
        await api.updatePage(editingId, payload);
        addToast('success', t('common.success'));
      } else {
        await api.createPage(payload);
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
    if (!window.confirm(t('customPages.deleteConfirm'))) return;
    try {
      await api.deletePage(id);
      addToast('success', t('common.success'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleToggle = async (p: any) => {
    try {
      await api.updatePage(p.id, { enabled: p.enabled === 1 ? false : true });
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>{t('admin.customPagesManagement')}</h2>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <Plus size={14} /> {t('customPages.add')}
        </button>
      </div>

      {showForm && (
        <div className="admin-card" style={{ marginBottom: 16, padding: 16 }}>
          <div className="form-group">
            <label>{t('customPages.slug')}</label>
            <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="about / help / ..." />
          </div>
          <div className="form-group">
            <label>{t('customPages.title')}</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="form-group">
            <label>{t('customPages.content')}</label>
            <textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Markdown 内容..." />
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={showInFooter} onChange={(e) => setShowInFooter(e.target.checked)} />
            {t('customPages.showInFooter')}
          </label>
          <label className="checkbox-label" style={{ marginLeft: 16 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t('customPages.enabled')}
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
      ) : pages.length === 0 ? (
        <div className="empty">{t('customPages.empty')}</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>ID</th>
              <th>{t('customPages.title')}</th>
              <th>{t('customPages.slug')}</th>
              <th style={{ width: 90 }}>{t('customPages.enabled')}</th>
              <th style={{ width: 170 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>
                  {p.title}
                  {p.show_in_footer === 1 && <span className="badge badge-info" style={{ marginLeft: 6 }}>页脚</span>}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <a href={`/page/${p.slug}`} target="_blank" rel="noopener noreferrer">
                    <FileText size={12} style={{ verticalAlign: -2, marginRight: 4 }} />/{p.slug}
                    <ExternalLink size={11} style={{ verticalAlign: -2, marginLeft: 4 }} />
                  </a>
                </td>
                <td>
                  <button className={`btn btn-sm ${p.enabled === 1 ? 'btn-primary' : 'btn-secondary'}`} onClick={() => handleToggle(p)}>
                    {p.enabled === 1 ? t('friendLinks.on') : t('friendLinks.off')}
                  </button>
                </td>
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>
                    <Edit3 size={13} /> {t('common.edit')}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)}>
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
