import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { DIFFICULTIES, DIFFICULTY_COLORS } from '../../constants';
import { t } from '../../i18n';
import {
  Search, Trash2, Edit3, X, ChevronLeft, ChevronRight, FileText, Save, Download, Upload,
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
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [actionStatus, setActionStatus] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const appendActionLog = (message: string) => {
    setActionLog((prev) => [...prev, message]);
  };

  const resetActionLog = () => {
    setActionLog([]);
    setActionStatus('');
  };

  const handleExportProblems = async () => {
    resetActionLog();
    setIsExporting(true);
    setActionStatus(t('admin.exportingProblems'));
    appendActionLog(t('admin.exportLogStart'));

    try {
      const data = await api.exportProblems();
      appendActionLog(t('admin.exportLogCount').replace('{0}', String(data.problems?.length ?? 0)));
      appendActionLog(t('admin.exportLogPreparingDownload'));

      const blob = new Blob([JSON.stringify(data.problems, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `eoj-problems-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      appendActionLog(t('admin.exportLogFinished'));
      setActionStatus(t('admin.exportComplete'));
      useToastStore().addToast('success', t('admin.problemsExported'));
    } catch (e: any) {
      appendActionLog(`${t('common.error')}: ${e.message || t('common.error')}`);
      setActionStatus(t('admin.exportFailed'));
      useToastStore().addToast('error', e.message || t('common.error'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportProblems = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    resetActionLog();
    setIsImporting(true);
    setActionStatus(t('admin.importingProblems'));
    appendActionLog(t('admin.importLogReadFile'));

    try {
      const text = await file.text();
      appendActionLog(t('admin.importLogParseJson'));
      const payload = JSON.parse(text);
      const problems = Array.isArray(payload) ? payload : payload.problems || [];
      appendActionLog(t('admin.importLogCount').replace('{0}', String(problems.length)));
      appendActionLog(t('admin.importLogUploading'));

      const result = await api.importProblems(problems);
      appendActionLog(t('admin.importLogFinished').replace('{0}', String(result.imported || 0)));
      setActionStatus(t('admin.importComplete'));
      useToastStore().addToast('success', t('admin.problemsImported').replace('{0}', String(result.imported || 0)));
      refresh();
    } catch (e: any) {
      appendActionLog(`${t('common.error')}: ${e.message || t('common.error')}`);
      setActionStatus(t('admin.importFailed'));
      useToastStore().addToast('error', e.message || t('common.error'));
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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

      <div className="admin-actions" style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={handleExportProblems} disabled={isExporting || isImporting}>
          <Download size={14} /> {t('admin.exportProblems')}
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={isExporting || isImporting}>
          <Upload size={14} /> {t('admin.importProblems')}
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={handleImportProblems} />
      </div>

      {(actionLog.length > 0 || isExporting || isImporting) && (
        <div style={{
          border: '1px solid #e0e0e0',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          backgroundColor: '#fafafa',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>{actionStatus || t('admin.noActionLogs')}</div>
            {(isExporting || isImporting) && (
              <span style={{ fontStyle: 'italic', color: '#666' }}>{t('admin.processing')}</span>
            )}
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 13, lineHeight: 1.6 }}>
            {actionLog.length === 0 ? (
              <div style={{ color: '#777' }}>{t('admin.noActionLogs')}</div>
            ) : (
              actionLog.map((line, index) => (
                <div key={index}>{line}</div>
              ))
            )}
          </div>
        </div>
      )}

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
