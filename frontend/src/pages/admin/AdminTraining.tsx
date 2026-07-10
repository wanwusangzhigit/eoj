import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import {
  Trash2, ChevronLeft, ChevronRight, ExternalLink, Plus, GraduationCap, BookPlus, FilePlus,
} from 'lucide-react';
import '../Admin.css';

const CATEGORIES = ['algorithm', 'math', 'data-structure', 'search', 'string', 'greedy', 'geometry'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

export default function AdminTraining() {
  useDocumentTitle(t('training.title'));
  const addToast = useToastStore((s) => s.addToast);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const [plans, setPlans] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);

  // Create plan form
  const [showCreate, setShowCreate] = useState(false);
  const [newPlan, setNewPlan] = useState({
    title: '',
    description: '',
    category: 'algorithm',
    difficulty: 'beginner',
    is_official: false,
    cover_image: '',
    sort_order: 0,
  });

  // Selected plan for chapter management
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [planDetail, setPlanDetail] = useState<any>(null);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [newChapterDesc, setNewChapterDesc] = useState('');
  const [newProblemInputs, setNewProblemInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    fetchPlans();
  }, [page, refreshKey]);

  const fetchPlans = async () => {
    try {
      const data = await api.getTrainingPlans({ page, pageSize: 10 });
      setPlans(data.plans);
      setPagination(data.pagination);
    } catch (e) {
      console.error('Failed to fetch training plans:', e);
    }
  };

  const handleCreatePlan = async () => {
    if (!newPlan.title.trim()) {
      addToast('error', t('training.planTitle'));
      return;
    }
    try {
      await api.createTrainingPlan({
        ...newPlan,
        is_official: newPlan.is_official ? 1 : 0,
      });
      addToast('success', t('training.planCreated'));
      setShowCreate(false);
      setNewPlan({ title: '', description: '', category: 'algorithm', difficulty: 'beginner', is_official: false, cover_image: '', sort_order: 0 });
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleDeletePlan = async (id: number) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return;
    try {
      await api.deleteTrainingPlan(id);
      addToast('success', t('training.planDeleted'));
      if (selectedPlan?.id === id) {
        setSelectedPlan(null);
        setPlanDetail(null);
      }
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const openPlanDetail = async (plan: any) => {
    setSelectedPlan(plan);
    try {
      const data = await api.getTrainingPlan(plan.id);
      setPlanDetail(data.plan);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleAddChapter = async () => {
    if (!selectedPlan) return;
    if (!newChapterTitle.trim()) {
      addToast('error', t('training.chapterTitle'));
      return;
    }
    try {
      await api.addTrainingChapter(selectedPlan.id, { title: newChapterTitle, description: newChapterDesc });
      addToast('success', t('training.chapterCreated'));
      setNewChapterTitle('');
      setNewChapterDesc('');
      await openPlanDetail(selectedPlan);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleDeleteChapter = async (chapterId: number) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return;
    try {
      await api.deleteTrainingChapter(chapterId);
      addToast('success', t('training.chapterDeleted'));
      await openPlanDetail(selectedPlan);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleAddProblem = async (chapterId: number) => {
    const pidStr = newProblemInputs[chapterId]?.trim();
    if (!pidStr) return;
    const pid = parseInt(pidStr);
    if (!pid || isNaN(pid)) {
      addToast('error', t('training.problemId'));
      return;
    }
    try {
      await api.addChapterProblem(chapterId, { problem_id: pid });
      addToast('success', t('training.problemAdded'));
      setNewProblemInputs({ ...newProblemInputs, [chapterId]: '' });
      await openPlanDetail(selectedPlan);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleRemoveProblem = async (chapterId: number, problemId: number) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return;
    try {
      await api.removeChapterProblem(chapterId, problemId);
      addToast('success', t('training.problemRemoved'));
      await openPlanDetail(selectedPlan);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <div className="admin-header">
        <h2>{t('training.title')}</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus size={14} />
          {t('training.createPlan')}
        </button>
      </div>

      {showCreate && (
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <h3>{t('training.createPlan')}</h3>
          <div className="admin-form-grid">
            <label>
              <span>{t('training.planTitle')}</span>
              <input
                type="text"
                value={newPlan.title}
                onChange={(e) => setNewPlan({ ...newPlan, title: e.target.value })}
                placeholder={t('training.planTitle')}
              />
            </label>
            <label>
              <span>{t('training.category')}</span>
              <select value={newPlan.category} onChange={(e) => setNewPlan({ ...newPlan, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              <span>{t('training.difficulty')}</span>
              <select value={newPlan.difficulty} onChange={(e) => setNewPlan({ ...newPlan, difficulty: e.target.value })}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{t(`training.${d}`)}</option>)}
              </select>
            </label>
            <label>
              <span>{t('training.coverImage')}</span>
              <input
                type="text"
                value={newPlan.cover_image}
                onChange={(e) => setNewPlan({ ...newPlan, cover_image: e.target.value })}
                placeholder="URL"
              />
            </label>
            <label>
              <span>{t('training.sortOrder')}</span>
              <input
                type="number"
                value={newPlan.sort_order}
                onChange={(e) => setNewPlan({ ...newPlan, sort_order: parseInt(e.target.value) || 0 })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={newPlan.is_official}
                onChange={(e) => setNewPlan({ ...newPlan, is_official: e.target.checked })}
              />
              <span>{t('training.isOfficial')}</span>
            </label>
          </div>
          <label className="full-width">
            <span>{t('training.planDescription')}</span>
            <textarea
              rows={3}
              value={newPlan.description}
              onChange={(e) => setNewPlan({ ...newPlan, description: e.target.value })}
            />
          </label>
          <div className="admin-form-actions">
            <button className="btn btn-primary btn-sm" onClick={handleCreatePlan}>{t('common.create')}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">{t('common.id')}</span>
          <span className="pm-col pm-col-title">{t('training.planTitle')}</span>
          <span className="pm-col" style={{ width: '90px' }}>{t('training.category')}</span>
          <span className="pm-col" style={{ width: '90px' }}>{t('training.difficulty')}</span>
          <span className="pm-col" style={{ width: '70px' }}>{t('training.official')}</span>
          <span className="pm-col" style={{ width: '160px' }}>{t('common.actions')}</span>
        </div>
        {plans.length === 0 ? (
          <div className="pm-empty">{t('training.noPlans')}</div>
        ) : (
          plans.map((p: any) => (
            <div key={p.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{p.id}</span>
              <span className="pm-col pm-col-title">{p.title}</span>
              <span className="pm-col" style={{ width: '90px' }}>{p.category}</span>
              <span className="pm-col" style={{ width: '90px' }}>{t(`training.${p.difficulty}`)}</span>
              <span className="pm-col" style={{ width: '70px' }}>{p.is_official ? '✓' : ''}</span>
              <span className="pm-col" style={{ width: '160px' }}>
                <div className="admin-row-actions">
                  <button className="btn-text-sm" title={t('training.editPlan')} onClick={() => openPlanDetail(p)}>
                    <GraduationCap size={13} /> {t('training.chapters')}
                  </button>
                  <a href={`/training/${p.id}`} className="btn-text-sm" title={t('common.view')}>
                    <ExternalLink size={13} />
                  </a>
                  <button className="btn-icon-sm danger" title={t('common.delete')} onClick={() => handleDeletePlan(p.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </span>
            </div>
          ))
        )}
      </div>

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

      {selectedPlan && planDetail && (
        <div className="admin-card" style={{ marginTop: 24 }}>
          <h3>{selectedPlan.title} — {t('training.chapters')}</h3>

          <div className="admin-subform" style={{ marginBottom: 16 }}>
            <h4><BookPlus size={14} /> {t('training.addChapter')}</h4>
            <div className="admin-form-grid">
              <label>
                <span>{t('training.chapterTitle')}</span>
                <input type="text" value={newChapterTitle} onChange={(e) => setNewChapterTitle(e.target.value)} />
              </label>
              <label>
                <span>{t('training.chapterDescription')}</span>
                <input type="text" value={newChapterDesc} onChange={(e) => setNewChapterDesc(e.target.value)} />
              </label>
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddChapter}>
              <Plus size={12} /> {t('training.addChapter')}
            </button>
          </div>

          {planDetail.chapters?.length ? (
            planDetail.chapters.map((ch: any) => (
              <div key={ch.id} className="admin-subsection">
                <div className="subsection-header">
                  <strong>#{ch.id} {ch.title}</strong>
                  <button className="btn-icon-sm danger" onClick={() => handleDeleteChapter(ch.id)} title={t('training.deleteChapter')}>
                    <Trash2 size={13} />
                  </button>
                </div>
                {ch.description && <p className="subsection-desc">{ch.description}</p>}
                <div className="subsection-problems">
                  {ch.problems?.length ? (
                    ch.problems.map((p: any) => (
                      <div key={p.relation_id} className="subsection-problem-row">
                        <span>#{p.problem_id} {p.title}</span>
                        <button className="btn-icon-sm danger" onClick={() => handleRemoveProblem(ch.id, p.problem_id)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="empty-text">{t('training.noProblems')}</div>
                  )}
                </div>
                <div className="add-problem-row">
                  <input
                    type="number"
                    placeholder={t('training.problemId')}
                    value={newProblemInputs[ch.id] || ''}
                    onChange={(e) => setNewProblemInputs({ ...newProblemInputs, [ch.id]: e.target.value })}
                  />
                  <button className="btn btn-secondary btn-sm" onClick={() => handleAddProblem(ch.id)}>
                    <FilePlus size={12} /> {t('training.addProblem')}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-text">{t('training.noChapters')}</div>
          )}
        </div>
      )}
    </div>
  );
}
