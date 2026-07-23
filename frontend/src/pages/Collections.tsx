import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import {
  FolderOpen, Plus, Folder, Trash2, Edit2, X,
  BookOpen, AlertCircle, Globe, Lock,
} from 'lucide-react';
import { DIFFICULTY_COLORS } from '../constants';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './Collections.css';

interface Collection {
  id: number;
  name: string;
  description: string;
  is_public: number;
  problem_count: number;
  created_at: string;
  updated_at: string;
}

interface CollectionItem {
  id: number;
  problem_id: number;
  note: string;
  sort_order: number;
  created_at: string;
  title: string;
  slug: string;
  difficulty: string;
  tags: string;
}

export default function Collections() {
  const { user } = useAuthStore();
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Create/edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPublic, setFormPublic] = useState(false);
  const [saving, setSaving] = useState(false);

  // Detail view state
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useDocumentTitle(t('collections.title'));

  const fetchCollections = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getCollections();
      setCollections(data.collections || []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchCollections();
  }, [user, fetchCollections]);

  const openCreateModal = () => {
    setEditingCollection(null);
    setFormName('');
    setFormDesc('');
    setFormPublic(false);
    setShowModal(true);
  };

  const openEditModal = (col: Collection, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCollection(col);
    setFormName(col.name);
    setFormDesc(col.description || '');
    setFormPublic(col.is_public === 1);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      addToast('error', t('collections.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      if (editingCollection) {
        await api.updateCollection(editingCollection.id, {
          name: formName.trim(),
          description: formDesc.trim(),
          is_public: formPublic,
        });
        addToast('success', t('collections.updated'));
      } else {
        await api.createCollection({
          name: formName.trim(),
          description: formDesc.trim(),
          is_public: formPublic,
        });
        addToast('success', t('collections.created'));
      }
      setShowModal(false);
      fetchCollections();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteId(id);
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    try {
      await api.deleteCollection(deleteId);
      addToast('success', t('collections.deleted'));
      if (selectedCollection?.id === deleteId) {
        setSelectedCollection(null);
        setItems([]);
      }
      setDeleteId(null);
      fetchCollections();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const selectCollection = async (col: Collection) => {
    setSelectedCollection(col);
    setItemsLoading(true);
    try {
      const data = await api.getCollectionItems(col.id);
      setItems(data.items || []);
    } catch {
      addToast('error', t('common.loadError'));
    } finally {
      setItemsLoading(false);
    }
  };

  const removeItem = async (itemId: number) => {
    if (!selectedCollection) return;
    try {
      await api.removeCollectionItem(selectedCollection.id, itemId);
      addToast('success', t('collections.itemRemoved'));
      selectCollection(selectedCollection);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  if (!user) {
    return (
      <div className="empty-page">
        <FolderOpen size={48} className="empty-icon" />
        <h2>{t('collections.pleaseLogin')}</h2>
        <Link to="/login" className="btn btn-primary">
          {t('login.login')}
        </Link>
      </div>
    );
  }

  return (
    <div className="collections-page">
      {/* Header */}
      <div className="page-header">
        <h1><FolderOpen size={24} className="header-icon" /> {t('collections.title')}</h1>
        <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
          <Plus size={16} />
          {t('collections.createCollection')}
        </button>
      </div>

      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>{t('common.loading')}</p>
        </div>
      ) : loadError ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchCollections}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div className="collections-layout">
          {/* Sidebar: Collection list */}
          <div className="collections-sidebar">
            {collections.length === 0 ? (
              <div className="empty-state">
                <FolderOpen size={48} className="empty-icon" />
                <p>{t('collections.noCollections')}</p>
                <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
                  <Plus size={14} />
                  {t('collections.createFirst')}
                </button>
              </div>
            ) : (
              <div className="collection-list">
                {collections.map((col) => (
                  <div
                    key={col.id}
                    className={`collection-item ${selectedCollection?.id === col.id ? 'active' : ''}`}
                    onClick={() => selectCollection(col)}
                  >
                    <div className="collection-item-icon">
                      <Folder size={18} />
                    </div>
                    <div className="collection-item-info">
                      <span className="collection-item-name">{col.name}</span>
                      <span className="collection-item-meta">
                        {col.problem_count} {t('collections.problems')}
                        {col.is_public === 1 && (
                          <span className="collection-public-badge">
                            <Globe size={10} /> {t('collections.public')}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="collection-item-actions">
                      <button
                        className="btn-icon"
                        title={t('common.edit')}
                        onClick={(e) => openEditModal(col, e)}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        className="btn-icon danger"
                        title={t('common.delete')}
                        onClick={(e) => confirmDelete(col.id, e)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Main: Collection detail */}
          <div className="collections-main">
            {!selectedCollection ? (
              <div className="empty-state">
                <FolderOpen size={48} className="empty-icon" />
                <p>{t('collections.selectHint')}</p>
              </div>
            ) : itemsLoading ? (
              <div className="loading-container">
                <div className="loading-spinner"></div>
                <p>{t('common.loading')}</p>
              </div>
            ) : (
              <>
                <div className="collection-detail-header">
                  <div className="detail-title-section">
                    <h2>{selectedCollection.name}</h2>
                    {selectedCollection.description && (
                      <p className="detail-desc">{selectedCollection.description}</p>
                    )}
                  </div>
                  <div className="detail-meta">
                    <span className="detail-count">
                      <BookOpen size={14} />
                      {items.length} {t('collections.problems')}
                    </span>
                    {selectedCollection.is_public === 1 ? (
                      <span className="badge badge-public">
                        <Globe size={12} /> {t('collections.public')}
                      </span>
                    ) : (
                      <span className="badge badge-private">
                        <Lock size={12} /> {t('collections.private')}
                      </span>
                    )}
                  </div>
                </div>

                {items.length === 0 ? (
                  <div className="empty-state">
                    <BookOpen size={40} className="empty-icon" />
                    <p>{t('collections.noProblems')}</p>
                    <Link to="/problems" className="btn btn-primary btn-sm">
                      {t('collections.browseProblems')}
                    </Link>
                  </div>
                ) : (
                  <div className="collection-items-table">
                    <div className="items-table-header">
                      <span className="col-id">#</span>
                      <span className="col-title">{t('problemList.titleCol')}</span>
                      <span className="col-difficulty">{t('problemList.difficulty')}</span>
                      <span className="col-tags">{t('problemList.tags')}</span>
                      <span className="col-actions">{t('common.actions')}</span>
                    </div>
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="item-row"
                        onClick={() => navigate(`/problems/${item.slug}`)}
                      >
                        <span className="col-id">{item.problem_id}</span>
                        <span className="col-title">{item.title}</span>
                        <span
                          className="col-difficulty"
                          style={{ color: DIFFICULTY_COLORS[item.difficulty] }}
                        >
                          {item.difficulty}
                        </span>
                        <span className="col-tags">
                          {(() => {
                            try {
                              return JSON.parse(item.tags || '[]').map((tag: string) => (
                                <span key={tag} className="tag-chip small">{tag}</span>
                              ));
                            } catch {
                              return null;
                            }
                          })()}
                        </span>
                        <span className="col-actions">
                          <button
                            className="btn-icon danger"
                            title={t('collections.removeProblem')}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeItem(item.id);
                            }}
                          >
                            <X size={14} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {editingCollection ? t('collections.editCollection') : t('collections.createCollection')}
              </h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{t('collections.nameLabel')}</label>
                <input
                  type="text"
                  className="form-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t('collections.namePlaceholder')}
                  maxLength={100}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>{t('collections.descLabel')}</label>
                <textarea
                  className="form-input"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder={t('collections.descPlaceholder')}
                  rows={3}
                  maxLength={500}
                />
              </div>
              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formPublic}
                    onChange={(e) => setFormPublic(e.target.checked)}
                  />
                  <span>{t('collections.makePublic')}</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId !== null && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('common.deleteConfirm')}</h3>
              <button className="btn-icon" onClick={() => setDeleteId(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p>{t('collections.deleteWarning')}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={handleDelete}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
