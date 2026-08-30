import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { Plus, Edit3, Trash2, X, Tag as TagIcon, FolderOpen, Save } from 'lucide-react';
import { t } from '../../i18n';

export default function AdminTags() {
  const addToast = useToastStore((s) => s.addToast);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 分类表单
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [catEditingId, setCatEditingId] = useState<number | null>(null);
  const [catName, setCatName] = useState('');
  const [catSlug, setCatSlug] = useState('');
  const [catIcon, setCatIcon] = useState('');
  const [catSortOrder, setCatSortOrder] = useState(0);
  const [catSaving, setCatSaving] = useState(false);

  // 标签表单
  const [tagFormOpen, setTagFormOpen] = useState(false);
  const [tagEditingId, setTagEditingId] = useState<number | null>(null);
  const [tagCategoryId, setTagCategoryId] = useState<number | ''>('');
  const [tagName, setTagName] = useState('');
  const [tagSlug, setTagSlug] = useState('');
  const [tagSortOrder, setTagSortOrder] = useState(0);
  const [tagSaving, setTagSaving] = useState(false);

  useDocumentTitle(t('admin.tagsManagement'));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTagCategories();
      setCategories(data.categories || []);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── 分类操作 ──
  const openCatCreate = () => {
    setCatEditingId(null);
    setCatName(''); setCatSlug(''); setCatIcon('');
    setCatSortOrder(categories.length);
    setCatFormOpen(true);
  };

  const openCatEdit = (cat: any) => {
    setCatEditingId(cat.id);
    setCatName(cat.name); setCatSlug(cat.slug); setCatIcon(cat.icon || '');
    setCatSortOrder(cat.sort_order || 0);
    setCatFormOpen(true);
  };

  const handleCatSave = async () => {
    if (!catName.trim() || !catSlug.trim()) {
      addToast('error', t('admin.tagsNameSlugRequired'));
      return;
    }
    setCatSaving(true);
    try {
      const payload = { name: catName.trim(), slug: catSlug.trim(), icon: catIcon.trim(), sort_order: catSortOrder };
      if (catEditingId) {
        await api.updateTagCategory(catEditingId, payload);
      } else {
        await api.createTagCategory(payload);
      }
      addToast('success', t('common.success'));
      setCatFormOpen(false);
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setCatSaving(false);
    }
  };

  const handleCatDelete = async (cat: any) => {
    const tagCount = cat.tags?.length || 0;
    const msg = tagCount > 0
      ? t('admin.tagsCategoryDeleteConfirmWithTags').replace('{0}', String(tagCount))
      : t('admin.tagsCategoryDeleteConfirm');
    if (!window.confirm(msg)) return;
    try {
      await api.deleteTagCategory(cat.id);
      addToast('success', t('common.success'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  // ── 标签操作 ──
  const openTagCreate = (categoryId?: number) => {
    setTagEditingId(null);
    setTagCategoryId(categoryId ?? (categories[0]?.id ?? ''));
    setTagName(''); setTagSlug(''); setTagSortOrder(0);
    setTagFormOpen(true);
  };

  const openTagEdit = (tag: any) => {
    setTagEditingId(tag.id);
    setTagCategoryId(tag.category_id ?? '');
    setTagName(tag.name); setTagSlug(tag.slug); setTagSortOrder(tag.sort_order || 0);
    setTagFormOpen(true);
  };

  const handleTagSave = async () => {
    if (!tagCategoryId || !tagName.trim() || !tagSlug.trim()) {
      addToast('error', t('admin.tagsNameSlugRequired'));
      return;
    }
    setTagSaving(true);
    try {
      const payload = { category_id: Number(tagCategoryId), name: tagName.trim(), slug: tagSlug.trim(), sort_order: tagSortOrder };
      if (tagEditingId) {
        await api.updateTag(tagEditingId, payload);
      } else {
        await api.createTag(payload);
      }
      addToast('success', t('common.success'));
      setTagFormOpen(false);
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setTagSaving(false);
    }
  };

  const handleTagDelete = async (tag: any) => {
    if (!window.confirm(t('admin.tagsDeleteConfirm'))) return;
    try {
      await api.deleteTag(tag.id);
      addToast('success', t('common.success'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>{t('admin.tagsManagement')}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => openTagCreate()} disabled={categories.length === 0}>
            <Plus size={14} /> {t('admin.tagsAddTag')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={openCatCreate}>
            <Plus size={14} /> {t('admin.tagsAddCategory')}
          </button>
        </div>
      </div>

      {catFormOpen && (
        <div className="admin-card" style={{ marginBottom: 16, padding: 16 }}>
          <h3 style={{ marginBottom: 12 }}>
            <FolderOpen size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {catEditingId ? t('admin.tagsEditCategory') : t('admin.tagsAddCategory')}
          </h3>
          <div className="form-group">
            <label>{t('admin.tagsName')}</label>
            <input type="text" value={catName} onChange={(e) => setCatName(e.target.value)} maxLength={50} />
          </div>
          <div className="form-group">
            <label>{t('admin.tagsSlug')}</label>
            <input type="text" value={catSlug} onChange={(e) => setCatSlug(e.target.value)} maxLength={50} placeholder="e.g. algorithm" />
          </div>
          <div className="form-group">
            <label>{t('admin.tagsIcon')}</label>
            <input type="text" value={catIcon} onChange={(e) => setCatIcon(e.target.value)} maxLength={100} placeholder="e.g. 🏷️" />
          </div>
          <div className="form-group">
            <label>{t('admin.tagsSortOrder')}</label>
            <input type="number" value={catSortOrder} onChange={(e) => setCatSortOrder(parseInt(e.target.value) || 0)} />
          </div>
          <div className="form-actions">
            <button className="btn btn-primary btn-sm" onClick={handleCatSave} disabled={catSaving}>
              <Save size={14} /> {catSaving ? t('admin.saving') : t('common.save')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setCatFormOpen(false)}>
              <X size={14} /> {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {tagFormOpen && (
        <div className="admin-card" style={{ marginBottom: 16, padding: 16 }}>
          <h3 style={{ marginBottom: 12 }}>
            <TagIcon size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {tagEditingId ? t('admin.tagsEditTag') : t('admin.tagsAddTag')}
          </h3>
          <div className="form-group">
            <label>{t('admin.tagsCategory')}</label>
            <select
              value={tagCategoryId}
              onChange={(e) => setTagCategoryId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">{t('admin.tagsSelectCategory')}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{t('admin.tagsName')}</label>
            <input type="text" value={tagName} onChange={(e) => setTagName(e.target.value)} maxLength={50} />
          </div>
          <div className="form-group">
            <label>{t('admin.tagsSlug')}</label>
            <input type="text" value={tagSlug} onChange={(e) => setTagSlug(e.target.value)} maxLength={50} placeholder="e.g. dp" />
          </div>
          <div className="form-group">
            <label>{t('admin.tagsSortOrder')}</label>
            <input type="number" value={tagSortOrder} onChange={(e) => setTagSortOrder(parseInt(e.target.value) || 0)} />
          </div>
          <div className="form-actions">
            <button className="btn btn-primary btn-sm" onClick={handleTagSave} disabled={tagSaving}>
              <Save size={14} /> {tagSaving ? t('admin.saving') : t('common.save')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setTagFormOpen(false)}>
              <X size={14} /> {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-container"><div className="loading-spinner" /><p>{t('common.loading')}</p></div>
      ) : categories.length === 0 ? (
        <div className="empty-state">
          <FolderOpen size={32} />
          <p>{t('admin.tagsNoCategories')}</p>
          <button className="btn btn-primary btn-sm" onClick={openCatCreate}>
            <Plus size={14} /> {t('admin.tagsAddCategory')}
          </button>
        </div>
      ) : (
        categories.map((cat) => (
          <div className="admin-card" key={cat.id} style={{ marginBottom: 16, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FolderOpen size={16} style={{ color: 'var(--primary)' }} />
                {cat.name}
                <span className="text-muted" style={{ fontWeight: 'normal', fontSize: 13 }}>/{cat.slug}</span>
                {cat.icon && <span>{cat.icon}</span>}
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openTagCreate(cat.id)}>
                  <Plus size={13} /> {t('admin.tagsAddTag')}
                </button>
                <button className="btn-icon-sm" onClick={() => openCatEdit(cat)} title={t('common.edit')}>
                  <Edit3 size={14} />
                </button>
                <button className="btn-icon-sm danger" onClick={() => handleCatDelete(cat)} title={t('common.delete')}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {(cat.tags && cat.tags.length > 0) ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {cat.tags.map((tag: any) => (
                  <span
                    key={tag.id}
                    className="admin-tag-chip"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: '16px', fontSize: 13,
                      background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
                    }}
                  >
                    <TagIcon size={12} style={{ color: 'var(--primary)' }} />
                    {tag.name}
                    <span className="text-muted" style={{ fontSize: 12 }}>/{tag.slug}</span>
                    <button
                      className="btn-icon-sm"
                      style={{ marginLeft: 2 }}
                      onClick={() => openTagEdit(tag)}
                      title={t('common.edit')}
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      className="btn-icon-sm danger"
                      onClick={() => handleTagDelete(tag)}
                      title={t('common.delete')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted" style={{ margin: 0 }}>{t('admin.tagsNoTagsInCategory')}</p>
            )}
          </div>
        ))
      )}
    </div>
  );
}
