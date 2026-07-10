import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { DIFFICULTIES, DIFFICULTY_COLORS } from '../../constants';
import { t } from '../../i18n';
import {
  Search, Trash2, Edit3, X, ChevronLeft, ChevronRight, FileText, Save,
} from 'lucide-react';
import '../Admin.css';

export default function AdminProblems() {
  useDocumentTitle(t('admin.problemManagement'));
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const [adminProblems, setAdminProblems] = useState<any[]>([]);
  const [problemPagination, setProblemPagination] = useState<any>(null);
  const [problemSearch, setProblemSearch] = useState('');
  const [debouncedProblemSearch, setDebouncedProblemSearch] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [problemPage, setProblemPage] = useState(1);
  const [editingProblem, setEditingProblem] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});

  useEffect(() => {
    fetchAdminProblems();
  }, [problemPage, debouncedProblemSearch, refreshKey]);

  // Debounce problem search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedProblemSearch(problemSearch);
    }, 400);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [problemSearch]);

  const fetchAdminProblems = async () => {
    try {
      const data = await api.getAdminProblems({
        page: problemPage,
        pageSize: 10,
        search: debouncedProblemSearch || undefined,
      });
      setAdminProblems(data.problems);
      setProblemPagination(data.pagination);
    } catch (e) {
      console.error('Failed to fetch admin problems:', e);
    }
  };

  const handleDeleteProblem = async (id: number) => {
    if (!window.confirm(t('admin.deleteConfirm'))) {
      return;
    }
    try {
      await api.deleteProblem(id);
      useToastStore().addToast('success', t('admin.problemDeleted'));
      refresh();
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    }
  };

  const handleEditProblem = (problem: any) => {
    setEditingProblem(problem.id);
    setEditForm({
      title: problem.title || '',
      description: problem.description || '',
      input_format: problem.input_format || '',
      output_format: problem.output_format || '',
      time_limit: problem.time_limit || 1000,
      memory_limit: problem.memory_limit || 256,
      difficulty: problem.difficulty || 'Easy',
      is_public: !!problem.is_public,
    });
  };

  const handleSaveEdit = async (id: number) => {
    try {
      await api.updateProblem(id, editForm);
      useToastStore().addToast('success', t('admin.problemUpdated'));
      setEditingProblem(null);
      setEditForm({});
      refresh();
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    }
  };

  const handleCancelEdit = () => {
    setEditingProblem(null);
    setEditForm({});
  };

  return (
    <div className="admin-form">
      <div className="admin-search">
        <Search size={16} />
        <input
          type="text"
          placeholder={t('admin.searchProblems')}
          value={problemSearch}
          onChange={(e) => {
            setProblemSearch(e.target.value);
            setProblemPage(1);
          }}
        />
      </div>

      <div className="problem-management-table">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">{t('common.id')}</span>
          <span className="pm-col pm-col-title">{t('admin.problemTitle')}</span>
          <span className="pm-col pm-col-difficulty">{t('admin.difficulty')}</span>
          <span className="pm-col pm-col-testcase-count">{t('admin.testcaseCount')}</span>
          <span className="pm-col pm-col-public">{t('admin.public')}</span>
          <span className="pm-col pm-col-actions">{t('common.actions')}</span>
        </div>
        {adminProblems.length === 0 ? (
          <div className="pm-empty">{t('admin.noProblems')}</div>
        ) : (
          adminProblems.map((p: any) => (
            <div key={p.id} className="pm-table-row">
              {editingProblem === p.id ? (
                <div className="edit-form">
                  <div className="form-group">
                    <label>{t('admin.problemTitle')}</label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('admin.description')}</label>
                    <textarea
                      rows={4}
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>{t('admin.timeLimit')}</label>
                      <input
                        type="number"
                        value={editForm.time_limit}
                        onChange={(e) => setEditForm({ ...editForm, time_limit: parseInt(e.target.value) })}
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('admin.memoryLimit')}</label>
                      <input
                        type="number"
                        value={editForm.memory_limit}
                        onChange={(e) => setEditForm({ ...editForm, memory_limit: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>{t('admin.difficulty')}</label>
                    <select
                      value={editForm.difficulty}
                      onChange={(e) => setEditForm({ ...editForm, difficulty: e.target.value })}
                    >
                      {DIFFICULTIES.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={editForm.is_public}
                        onChange={(e) => setEditForm({ ...editForm, is_public: e.target.checked })}
                      />
                      {t('admin.public')}
                    </label>
                  </div>
                  <div className="form-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => handleSaveEdit(p.id)}>
                      <Save size={14} /> {t('admin.save')}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={handleCancelEdit}>
                      <X size={14} /> {t('admin.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="pm-col pm-col-id">{p.id}</span>
                  <span className="pm-col pm-col-title">{p.title}</span>
                  <span className="pm-col pm-col-difficulty">
                    <span
                      className="difficulty-badge"
                      style={{ color: DIFFICULTY_COLORS[p.difficulty] || '#8b8fa3' }}
                    >
                      {p.difficulty || 'N/A'}
                    </span>
                  </span>
                  <span className="pm-col pm-col-testcase-count">
                    <span className={p.testcase_count === 0 ? 'testcase-count-zero' : ''}>
                      {p.testcase_count ?? 0}
                    </span>
                  </span>
                  <span className="pm-col pm-col-public">
                    {p.is_public ? '✓' : '✗'}
                  </span>
                  <span className="pm-col pm-col-actions">
                    <div className="problem-row-actions">
                      <button
                        className="manage-testcases-btn"
                        onClick={() => navigate(`/admin/testcases?problemId=${p.id}`)}
                      >
                        <FileText size={14} /> {t('admin.manageTestcases')}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleEditProblem(p)}
                      >
                        <Edit3 size={14} /> {t('common.edit')}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteProblem(p.id)}
                      >
                        <Trash2 size={14} /> {t('common.delete')}
                      </button>
                    </div>
                  </span>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {problemPagination && problemPagination.totalPages > 1 && (
        <div className="pm-pagination">
          <button
            className="btn btn-secondary btn-sm"
            disabled={problemPage <= 1}
            onClick={() => setProblemPage(problemPage - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="pm-page-info">
            {t('common.page').replace('{0}', String(problemPagination.page)).replace('{1}', String(problemPagination.totalPages))}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={problemPage >= problemPagination.totalPages}
            onClick={() => setProblemPage(problemPage + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
