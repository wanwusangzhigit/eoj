import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { DIFFICULTY_COLORS } from '../../constants';
import { t } from '../../i18n';
import {
  Plus, Save, Trash2, X, ChevronUp, ChevronDown, Upload, Download, FileArchive,
  FileCheck, FileText, Gauge, Inbox, AlertCircle, CheckSquare, Copy, Pencil, FileCode,
} from 'lucide-react';
import JSZip from 'jszip';
import '../Admin.css';
// 复用团队测试数据面板的完整视觉规范(.team-testcase-panel 作用域样式)
import '../Teams.css';
import { distributeScores } from '../../utils/testcaseScore';

const SPJ_LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c', 'go', 'rust'];

export default function AdminTestcases() {
  useDocumentTitle(t('admin.addTestcases'));
  const addToast = useToastStore((s) => s.addToast);
  const [searchParams] = useSearchParams();
  const [saving, setSaving] = useState(false);

  const [testcaseSearch, setTestcaseSearch] = useState('');
  const [selectedTestcaseProblem, setSelectedTestcaseProblem] = useState<any>(null);
  const [existingTestcases, setExistingTestcases] = useState<any[]>([]);
  const [testcases, setTestcases] = useState([{ input: '', expected_output: '', is_sample: false, score: 10 }]);

  const [testcaseSearchResults, setTestcaseSearchResults] = useState<any[]>([]);
  const [expandedTestcases, setExpandedTestcases] = useState<Set<number>>(new Set());
  const [selectedTestcases, setSelectedTestcases] = useState<Set<number>>(new Set());
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<any>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [importPreview, setImportPreview] = useState<{ fileName: string; parsed: any[] } | null>(null);
  const [selectedProblemJudgeType, setSelectedProblemJudgeType] = useState<string>('default');
  const testcaseSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropzoneFileInputRef = useRef<HTMLInputElement | null>(null);

  // ── SPJ 管理状态 ──
  const [spjCode, setSpjCode] = useState('');
  const [spjLanguage, setSpjLanguage] = useState('cpp');
  const [spjLoading, setSpjLoading] = useState(false);
  const [spjSaving, setSpjSaving] = useState(false);

  // ── 输入/输出格式编辑状态 ──
  const [formatForm, setFormatForm] = useState<{ input_format: string; output_format: string }>({ input_format: '', output_format: '' });
  const [formatSaving, setFormatSaving] = useState(false);

  // 容量限制(与团队面板默认一致:单题总量 5MB)
  const maxTotalTestcaseSize = 5 * 1024 * 1024;
  const existingTotalSize = existingTestcases.reduce(
    (sum: number, tc: any) => sum + new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length,
    0
  );
  const newRowsTotalSize = testcases.reduce(
    (sum: number, tc: any) => sum + new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length,
    0
  );
  const predictedTotalSize = existingTotalSize + newRowsTotalSize;
  const overTotalLimit = predictedTotalSize > maxTotalTestcaseSize;
  const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)}MB` : `${(bytes / 1024).toFixed(1)}KB`;

  const handleSelectTestcaseProblem = useCallback(async (problem: any) => {
    setSelectedTestcaseProblem(problem);
    setSelectedProblemJudgeType(problem.judge_type || 'default');
    setTestcaseSearch('');
    setExpandedTestcases(new Set());
    setSelectedTestcases(new Set());
    setEditingIdx(null);
    setImportPreview(null);
    setFormatForm({ input_format: problem.input_format || '', output_format: problem.output_format || '' });
    // 重置并加载 SPJ 代码(仅当题目为 SPJ 判题时)
    setSpjCode('');
    setSpjLanguage('cpp');
    if (problem.judge_type === 'spj') {
      setSpjLoading(true);
      try {
        const spjData: any = await api.getProblemSpj(problem.id);
        setSpjCode(spjData.code || '');
        setSpjLanguage(spjData.language || 'cpp');
      } catch (e) {
        console.error('Failed to fetch SPJ code:', e);
        setSpjCode('');
      } finally {
        setSpjLoading(false);
      }
    }
    try {
      const data = await api.getProblemTestcases(problem.id);
      setExistingTestcases(data.testcases);
    } catch (e) {
      console.error('Failed to fetch testcases:', e);
      setExistingTestcases([]);
    }
    // 通过 slug 拉取完整题目信息,刷新输入/输出格式(搜索结果可能不含这些字段)
    if (problem.slug) {
      try {
        const full = await api.getProblem(problem.slug);
        const p = full.problem;
        setFormatForm({ input_format: p.input_format || '', output_format: p.output_format || '' });
      } catch (e) {
        console.error('Failed to fetch problem details:', e);
      }
    }
  }, []);

  // ── SPJ 代码保存 / 删除 ──
  const handleSaveSpj = async () => {
    if (!selectedTestcaseProblem || spjSaving) return;
    if (!spjCode.trim()) {
      addToast('error', t('admin.spjCodeRequired'));
      return;
    }
    setSpjSaving(true);
    try {
      await api.updateProblemSpj(selectedTestcaseProblem.id, spjLanguage, spjCode);
      setSelectedProblemJudgeType('spj');
      addToast('success', t('admin.spjSaved'));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSpjSaving(false);
    }
  };

  const handleDeleteSpj = async () => {
    if (!selectedTestcaseProblem || spjSaving) return;
    if (!window.confirm(t('admin.spjDeleteConfirm'))) return;
    setSpjSaving(true);
    try {
      await api.deleteProblemSpj(selectedTestcaseProblem.id);
      setSpjCode('');
      setSpjLanguage('cpp');
      setSelectedProblemJudgeType('default');
      addToast('success', t('admin.spjDeleted'));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSpjSaving(false);
    }
  };

  const handleSaveFormat = async () => {
    if (!selectedTestcaseProblem || formatSaving) return;
    setFormatSaving(true);
    try {
      await api.updateProblem(selectedTestcaseProblem.id, {
        input_format: formatForm.input_format,
        output_format: formatForm.output_format,
      });
      if (selectedTestcaseProblem.slug) {
        setSelectedTestcaseProblem({ ...selectedTestcaseProblem, input_format: formatForm.input_format, output_format: formatForm.output_format });
      }
      addToast('success', t('admin.problemUpdated'));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setFormatSaving(false);
    }
  };

  // Handle navigation from Create Problem page
  useEffect(() => {
    const problemId = searchParams.get('problemId');
    if (problemId) {
      const problem = {
        id: parseInt(problemId),
        title: searchParams.get('problemTitle') || '',
        slug: searchParams.get('problemSlug') || '',
        difficulty: searchParams.get('problemDifficulty') || 'Easy',
        judge_type: searchParams.get('problemJudgeType') || 'default',
      };
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleSelectTestcaseProblem(problem);
    }
  }, [searchParams, handleSelectTestcaseProblem]);

  const handleAddTestcaseRow = () => {
    setTestcases([...testcases, { input: '', expected_output: '', is_sample: false, score: 10 }]);
  };

  const removeTestcaseRow = (index: number) => {
    if (testcases.length <= 1) return; // 至少保留一行
    setTestcases(testcases.filter((_, i) => i !== index));
  };

  const duplicateTestcaseRow = (index: number) => {
    const row = testcases[index];
    setTestcases([...testcases, { ...row }]);
  };

  // ── 导入预览确认 ──
  const showImportPreview = (fileName: string, parsed: any[]) => {
    if (parsed.length === 0) {
      addToast('error', t('admin.atLeastOneTestcase'));
      return;
    }
    // 上传数据时按 100 分总分均匀分配(样例为 0 分)
    setImportPreview({ fileName, parsed: distributeScores(parsed) });
  };

  const confirmImportPreview = () => {
    if (!importPreview) return;
    setTestcases(importPreview.parsed);
    setImportPreview(null);
    addToast('success', t('admin.testcaseAdded'));
  };

  const cancelImportPreview = () => setImportPreview(null);

  const importJsonFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        const batch = Array.isArray(data) ? data : [data];
        const parsed = batch.map((item: any) => ({
          input: item.input || '',
          expected_output: item.expected_output || item.output || '',
          is_sample: item.is_sample || false,
          score: item.score || 10,
        }));
        showImportPreview(file.name, parsed);
      } catch {
        addToast('error', t('teams.testcasesHint'));
      }
    };
    reader.readAsText(file);
  };

  const importZipFile = async (file: File) => {
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const inEntries = Object.entries(zip.files).filter(
        ([name, entry]) => !entry.dir && /\.in$/i.test(name)
      );
      const parsed: any[] = [];
      for (const [name, entry] of inEntries) {
        const base = name.replace(/\.in$/i, '');
        // 允许导入 .out / .ans 任一扩展名的输出文件
        const outEntry = zip.files[`${base}.out`] || zip.files[`${base}.ans`];
        if (!outEntry || outEntry.dir) continue;
        const input = await entry.async('string');
        const output = await outEntry.async('string');
        parsed.push({ input, expected_output: output, is_sample: false, score: 10 });
      }
      showImportPreview(file.name, parsed);
    } catch {
      addToast('error', t('teams.testcasesHint'));
    }
  };

  const handleBatchUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importJsonFile(file);
    e.target.value = '';
  };

  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importZipFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (/\.(json)$/i.test(file.name)) {
      importJsonFile(file);
    } else if (/\.(zip)$/i.test(file.name)) {
      importZipFile(file);
    } else {
      addToast('error', t('teams.testcasesHint'));
    }
  };

  const handleSaveTestcases = async () => {
    if (!selectedTestcaseProblem) {
      addToast('error', t('admin.selectProblemFirst'));
      return;
    }
    const isSpj = selectedProblemJudgeType === 'spj';
    const validTestcases = testcases.filter((tc) => {
      if (isSpj) {
        return tc.input;
      }
      return tc.input && tc.expected_output;
    });
    if (validTestcases.length === 0) {
      addToast('error', t('admin.atLeastOneTestcase'));
      return;
    }
    // 校验:新增测试点全为隐藏(无样例)时给出提示(不阻断保存)
    if (!validTestcases.some((tc) => tc.is_sample) && !existingTestcases.some((tc: any) => tc.is_sample)) {
      addToast('info', t('teams.noSampleWarning'));
    }
    setSaving(true);
    try {
      await api.addTestcases(selectedTestcaseProblem.id, validTestcases);
      addToast('success', t('admin.testcaseAdded'));
      setTestcases([{ input: '', expected_output: '', is_sample: false, score: 10 }]);
      const data = await api.getProblemTestcases(selectedTestcaseProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTestcase = async (index: number) => {
    if (!selectedTestcaseProblem) return;
    if (!window.confirm(t('admin.deleteTestcaseConfirm'))) return;
    try {
      await api.deleteTestcase(selectedTestcaseProblem.id, index);
      addToast('success', t('admin.testcaseDeleted'));
      const data = await api.getProblemTestcases(selectedTestcaseProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  // ── 多选 + 批量操作 ──
  const toggleSelectTestcase = (index: number) => {
    setSelectedTestcases(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedTestcases(prev =>
      prev.size === existingTestcases.length
        ? new Set()
        : new Set(existingTestcases.map((_, idx) => idx))
    );
  };

  const handleBatchDeleteTestcases = async () => {
    if (!selectedTestcaseProblem || selectedTestcases.size === 0) return;
    if (!window.confirm(t('admin.deleteTestcaseConfirm'))) return;
    setSaving(true);
    try {
      // 从大到小删除,避免索引偏移
      const idxs = [...selectedTestcases].sort((a, b) => b - a);
      for (const idx of idxs) {
        await api.deleteTestcase(selectedTestcaseProblem.id, idx);
      }
      setSelectedTestcases(new Set());
      setExpandedTestcases(new Set());
      addToast('success', t('admin.testcaseDeleted'));
      const data = await api.getProblemTestcases(selectedTestcaseProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleBatchSetSample = async (sample: boolean) => {
    if (!selectedTestcaseProblem || selectedTestcases.size === 0 || saving) return;
    setSaving(true);
    try {
      const next = existingTestcases.map((tc: any, idx: number) =>
        selectedTestcases.has(idx) ? { ...tc, is_sample: sample } : tc
      );
      await api.updateProblemTestcases(selectedTestcaseProblem.id, next);
      setSelectedTestcases(new Set());
      setExpandedTestcases(new Set());
      addToast('success', t('admin.testcaseAdded'));
      const data = await api.getProblemTestcases(selectedTestcaseProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  // ── 排序(上移/下移 + 拖拽) ──
  const moveTestcase = async (index: number, dir: -1 | 1) => {
    if (!selectedTestcaseProblem) return;
    const target = index + dir;
    if (target < 0 || target >= existingTestcases.length || saving) return;
    setSaving(true);
    try {
      const next = [...existingTestcases];
      [next[index], next[target]] = [next[target], next[index]];
      await api.updateProblemTestcases(selectedTestcaseProblem.id, next);
      setExpandedTestcases(new Set());
      setSelectedTestcases(new Set());
      addToast('success', t('admin.testcaseAdded'));
      const data = await api.getProblemTestcases(selectedTestcaseProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (saving) return;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(index)); } catch { /* ignore */ }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null) return;
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const from = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);
    if (from === null || from === index || saving || !selectedTestcaseProblem) return;
    setSaving(true);
    try {
      const next = [...existingTestcases];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      setExpandedTestcases(new Set());
      setSelectedTestcases(new Set());
      api.updateProblemTestcases(selectedTestcaseProblem.id, next)
        .then(() => {
          addToast('success', t('admin.testcaseAdded'));
          return api.getProblemTestcases(selectedTestcaseProblem.id);
        })
        .then((data) => setExistingTestcases(data.testcases))
        .catch((err: any) => addToast('error', err.message || t('common.error')))
        .finally(() => setSaving(false));
    } catch (err: any) {
      addToast('error', err.message || t('common.error'));
      setSaving(false);
    }
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // ── 就地编辑 ──
  const startEditTestcase = (index: number) => {
    if (saving) return;
    setEditingIdx(index);
    setEditingDraft({ ...existingTestcases[index] });
  };

  const cancelEditTestcase = () => {
    setEditingIdx(null);
    setEditingDraft(null);
  };

  const saveEditTestcase = async () => {
    if (!selectedTestcaseProblem || editingIdx === null || !editingDraft) return;
    const draft = editingDraft;
    if (!draft.input || !draft.expected_output) {
      addToast('error', t('admin.atLeastOneTestcase'));
      return;
    }
    setSaving(true);
    try {
      const next = [...existingTestcases];
      next[editingIdx] = {
        input: draft.input,
        expected_output: draft.expected_output,
        is_sample: !!draft.is_sample,
        score: parseInt(draft.score) || 10,
      };
      await api.updateProblemTestcases(selectedTestcaseProblem.id, next);
      setEditingIdx(null);
      setEditingDraft(null);
      addToast('success', t('admin.testcaseAdded'));
      const data = await api.getProblemTestcases(selectedTestcaseProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleBatchExport = () => {
    if (!existingTestcases || existingTestcases.length === 0) {
      addToast('error', t('admin.noTestcaseData'));
      return;
    }
    const exportData = existingTestcases.map((tc: any) => ({
      input: tc.input,
      expected_output: tc.expected_output,
      is_sample: !!tc.is_sample,
      score: tc.score || 10,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTestcaseProblem?.slug || 'testcases'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', t('admin.exportComplete'));
  };

  const toggleTestcaseExpand = (index: number) => {
    setExpandedTestcases(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleTestcaseSearchChange = useCallback((value: string) => {
    setTestcaseSearch(value);
    setSelectedTestcaseProblem(null);
    if (testcaseSearchTimerRef.current) {
      clearTimeout(testcaseSearchTimerRef.current);
    }
    if (!value.trim()) {
      setTestcaseSearchResults([]);
      return;
    }
    testcaseSearchTimerRef.current = setTimeout(async () => {
      try {
        const data = await api.getAdminProblems({ search: value, pageSize: 10 });
        setTestcaseSearchResults(data.problems);
      } catch (e) {
        console.error('Failed to search problems:', e);
        setTestcaseSearchResults([]);
      }
    }, 300);
  }, []);

  return (
    <div className="admin-form team-testcase-panel">
      <div className="form-group">
        <label>{t('admin.selectProblem')}</label>
        <div className="testcase-problem-select">
          <input
            type="text"
            placeholder={t('admin.searchProblem')}
            value={testcaseSearch}
            onChange={(e) => handleTestcaseSearchChange(e.target.value)}
          />
          {testcaseSearch && !selectedTestcaseProblem && (
            <div className="testcase-search-dropdown">
              {testcaseSearchResults.length === 0 ? (
                <div className="testcase-search-item" style={{ color: 'var(--text-muted)', cursor: 'default' }}>
                  {t('common.noData')}
                </div>
              ) : (
                testcaseSearchResults.map((p: any) => (
                  <div
                    key={p.id}
                    className="testcase-search-item"
                    onClick={() => {
                      handleSelectTestcaseProblem(p);
                      setTestcaseSearch('');
                      setTestcaseSearchResults([]);
                    }}
                  >
                    <span>{p.title}</span>
                    <span className="pm-col pm-col-difficulty">
                      <span className="difficulty-badge" style={{ color: DIFFICULTY_COLORS[p.difficulty] || '#8b8fa3' }}>
                        {p.difficulty}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
          {selectedTestcaseProblem && (
            <div className="selected-problem-info">
              <span>{selectedTestcaseProblem.title} (ID: {selectedTestcaseProblem.id})</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedTestcaseProblem(null)}>
                <X size={14} /> {t('admin.change')}
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedTestcaseProblem && (
        <>
          <div className="testcase-existing" style={{ marginTop: 12 }}>
            <h3><FileArchive size={16} style={{ color: 'var(--primary)' }} /> {t('admin.existingTestcases')} ({existingTestcases.length})</h3>
            {existingTestcases.length === 0 ? (
              <p className="testcase-empty">
                <Inbox size={36} />
                {t('admin.noTestcaseData')}
                <small>{t('teams.testcaseEmptyHint')}</small>
              </p>
            ) : (
              <>
                <div className="testcase-stats">
                  <span><FileCheck size={13} /> {t('admin.sampleCount').replace('{0}', String(existingTestcases.filter((tc: any) => tc.is_sample).length))}</span>
                  <span><FileText size={13} /> {t('admin.hiddenCount').replace('{0}', String(existingTestcases.filter((tc: any) => !tc.is_sample).length))}</span>
                  <span><Gauge size={13} /> {t('admin.totalScore').replace('{0}', String(existingTestcases.reduce((sum: number, tc: any) => sum + (tc.score || 0), 0)))}</span>
                  <span style={{ color: existingTotalSize > maxTotalTestcaseSize ? 'var(--error)' : undefined }}>
                    {t('teams.totalTestcaseSize').replace('{0}', formatBytes(existingTotalSize)).replace('{1}', formatBytes(maxTotalTestcaseSize))}
                  </span>
                  <button className="btn btn-secondary btn-sm" onClick={toggleSelectAll}>
                    <CheckSquare size={13} /> {selectedTestcases.size === existingTestcases.length ? t('admin.clearSelection') : t('admin.selectAll')}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleBatchExport}>
                    <Download size={14} /> {t('admin.exportProblems')}
                  </button>
                  {selectedTestcases.size > 0 && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleBatchSetSample(true)} disabled={saving}>
                        <FileCheck size={13} /> {t('admin.setSample')}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleBatchSetSample(false)} disabled={saving}>
                        <FileText size={13} /> {t('admin.setHidden')}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={handleBatchDeleteTestcases} disabled={saving}>
                        <Trash2 size={13} /> {t('admin.deleteSelected').replace('{0}', String(selectedTestcases.size))}
                      </button>
                    </>
                  )}
                </div>
                <div className="testcase-capacity">
                  <div className="testcase-capacity-track">
                    <div
                      className={`testcase-capacity-fill ${existingTotalSize > maxTotalTestcaseSize ? 'over' : ''}`}
                      style={{ width: `${Math.min(100, (existingTotalSize / Math.max(1, maxTotalTestcaseSize)) * 100)}%` }}
                    />
                  </div>
                  <span className={`testcase-capacity-label ${existingTotalSize > maxTotalTestcaseSize ? 'over' : ''}`}>
                    {existingTotalSize > maxTotalTestcaseSize
                      ? t('teams.totalTestcaseOver')
                      : Math.round((existingTotalSize / Math.max(1, maxTotalTestcaseSize)) * 100) + '%'}
                  </span>
                </div>
                <div className="testcase-list">
                  {existingTestcases.map((tc: any, idx: number) => (
                    <div
                      key={idx}
                      className={`testcase-item${selectedTestcases.has(idx) ? ' selected' : ''}${dragIndex === idx ? ' dragging' : ''}${dragOverIndex === idx ? ' drag-over' : ''}`}
                      draggable={!saving}
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={(e) => handleDragDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="testcase-summary-row" onClick={() => toggleTestcaseExpand(idx)}>
                        <input
                          type="checkbox"
                          className="testcase-select"
                          checked={selectedTestcases.has(idx)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelectTestcase(idx)}
                        />
                        <span className="testcase-index">#{idx + 1}</span>
                        <span className={`testcase-type-badge ${tc.is_sample ? 'sample' : 'hidden'}`}>
                          {tc.is_sample ? t('admin.sample') : t('admin.hidden')}
                        </span>
                        <span className="testcase-score">{t('admin.score')}: {tc.score}</span>
                        <span className="testcase-move">
                          <button
                            type="button"
                            className="btn-icon-sm"
                            disabled={idx === 0 || saving}
                            onClick={(e) => { e.stopPropagation(); moveTestcase(idx, -1); }}
                            title={t('teams.moveUp')}
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            className="btn-icon-sm"
                            disabled={idx === existingTestcases.length - 1 || saving}
                            onClick={(e) => { e.stopPropagation(); moveTestcase(idx, 1); }}
                            title={t('teams.moveDown')}
                          >
                            <ChevronDown size={13} />
                          </button>
                        </span>
                        <span className="testcase-expand-icon">
                          {expandedTestcases.has(idx) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </span>
                        <button
                          type="button"
                          className="btn-icon-sm"
                          disabled={saving}
                          onClick={(e) => { e.stopPropagation(); startEditTestcase(idx); }}
                          title={t('common.edit')}
                        >
                          <Pencil size={13} />
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleDeleteTestcase(idx); }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {editingIdx === idx ? (
                        <div className="testcase-edit-form">
                          <div className="form-group">
                            <label>{t('admin.input')}</label>
                            <textarea rows={3} value={editingDraft?.input || ''} onChange={(e) => setEditingDraft({ ...editingDraft, input: e.target.value })} />
                          </div>
                          <div className="form-group">
                            <label>{t('admin.expectedOutput')}</label>
                            <textarea rows={3} value={editingDraft?.expected_output || ''} onChange={(e) => setEditingDraft({ ...editingDraft, expected_output: e.target.value })} />
                          </div>
                          <div className="form-group small">
                            <label className="checkbox-label">
                              <input type="checkbox" checked={!!editingDraft?.is_sample} onChange={(e) => setEditingDraft({ ...editingDraft, is_sample: e.target.checked })} />
                              {t('admin.sample')}
                            </label>
                          </div>
                          <div className="form-group small">
                            <label>{t('admin.score')}</label>
                            <input type="number" value={editingDraft?.score ?? 10} onChange={(e) => setEditingDraft({ ...editingDraft, score: parseInt(e.target.value) })} />
                          </div>
                          <div className="form-actions">
                            <button type="button" className="btn btn-primary btn-sm" onClick={saveEditTestcase} disabled={saving}>
                              <Save size={14} /> {saving ? t('admin.saving') : t('common.save')}
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEditTestcase}>
                              <X size={14} /> {t('common.cancel')}
                            </button>
                          </div>
                        </div>
                      ) : expandedTestcases.has(idx) && (
                        <div className="testcase-detail">
                          <div className="testcase-item-body">
                            <div className="testcase-io">
                              <label>{t('admin.input')}:</label>
                              <pre>{tc.input}</pre>
                            </div>
                            <div className="testcase-io">
                              <label>{t('common.output')}:</label>
                              <pre>{tc.expected_output}</pre>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── SPJ 管理面板 ── */}
          <div className="testcase-spj-panel" style={{ marginTop: 16 }}>
            <h3><FileCode size={16} style={{ color: 'var(--primary)' }} /> {t('admin.specialJudge')}</h3>
            {spjLoading ? (
              <div className="tab-loading">
                <div className="loading-spinner" />
                <span>{t('common.loading')}</span>
              </div>
            ) : (
              <>
                <p className="spj-hint">{t('admin.spjHint')}</p>
                <div className="form-group">
                  <label>{t('admin.spjLanguage')}</label>
                  <select
                    className="form-select"
                    value={spjLanguage}
                    onChange={(e) => setSpjLanguage(e.target.value)}
                    disabled={spjSaving}
                  >
                    {SPJ_LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>{lang}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>{t('admin.spjCode')}</label>
                  <textarea
                    className="form-textarea spj-code-editor"
                    rows={12}
                    value={spjCode}
                    onChange={(e) => setSpjCode(e.target.value)}
                    placeholder={t('admin.spjPlaceholder')}
                    disabled={spjSaving}
                    style={{ fontFamily: 'monospace', fontSize: '13px' }}
                  />
                </div>
                <div className="form-actions">
                  {selectedProblemJudgeType === 'spj' && (
                    <button className="btn btn-danger btn-sm" onClick={handleDeleteSpj} disabled={spjSaving}>
                      <Trash2 size={14} /> {t('common.delete')}
                    </button>
                  )}
                  <button className="btn btn-primary btn-sm" onClick={handleSaveSpj} disabled={spjSaving || !spjCode.trim()}>
                    <Save size={14} /> {spjSaving ? t('admin.saving') : t('admin.spjSave')}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="testcase-existing testcase-format" style={{ marginTop: 16 }}>
            <h3><FileText size={16} style={{ color: 'var(--primary)' }} /> {t('admin.inputOutputFormat')}</h3>
            <div className="form-group">
              <label>{t('admin.inputFormat')}</label>
              <textarea
                className="form-input form-textarea"
                rows={3}
                value={formatForm.input_format}
                onChange={(e) => setFormatForm({ ...formatForm, input_format: e.target.value })}
                placeholder={t('admin.inputFormatPlaceholder')}
              />
            </div>
            <div className="form-group">
              <label>{t('admin.outputFormat')}</label>
              <textarea
                className="form-input form-textarea"
                rows={3}
                value={formatForm.output_format}
                onChange={(e) => setFormatForm({ ...formatForm, output_format: e.target.value })}
                placeholder={t('admin.outputFormatPlaceholder')}
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary btn-sm" onClick={handleSaveFormat} disabled={formatSaving}>
                <Save size={14} /> {formatSaving ? t('admin.saving') : t('admin.saveFormat')}
              </button>
            </div>
          </div>

          <div className="testcase-new" style={{ marginTop: 16 }}>
            <h3><Upload size={16} style={{ color: 'var(--primary)' }} /> {t('admin.addNewTestcases')}</h3>
            <div
              className={`testcase-dropzone${dragActive ? ' active' : ''}`}
              onClick={() => dropzoneFileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <Upload size={22} />
              <span>{t('teams.testcaseDropHint')}</span>
              <input
                ref={dropzoneFileInputRef}
                type="file"
                accept=".json,.zip"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (/\.(json)$/i.test(file.name)) importJsonFile(file);
                    else if (/\.(zip)$/i.test(file.name)) importZipFile(file);
                  }
                  e.target.value = '';
                }}
              />
            </div>
            {importPreview && (
              <div className="testcase-import-preview">
                <div className="testcase-import-preview-head">
                  <FileCheck size={15} />
                  <strong>{importPreview.fileName}</strong>
                  <span>{t('teams.importPreview').replace('{0}', String(importPreview.parsed.length))}</span>
                </div>
                <div className="testcase-import-preview-stats">
                  <span>{t('admin.sampleCount').replace('{0}', String(importPreview.parsed.filter((tc: any) => tc.is_sample).length))}</span>
                  <span>{t('admin.hiddenCount').replace('{0}', String(importPreview.parsed.filter((tc: any) => !tc.is_sample).length))}</span>
                  <span>{t('teams.totalTestcaseSize').replace('{0}', formatBytes(
                    importPreview.parsed.reduce((sum: number, tc: any) => sum + new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length, 0)
                  )).replace('{1}', formatBytes(maxTotalTestcaseSize))}</span>
                </div>
                <div className="testcase-import-preview-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={confirmImportPreview}>
                    <CheckSquare size={14} /> {t('common.confirm')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={cancelImportPreview}>
                    <X size={14} /> {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
            {testcases.map((tc, idx) => {
              const rowSize = new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length;
              return (
                <div key={idx} className="testcase-form-row">
                  <div className="testcase-form-row-head">
                    <span className="testcase-form-index">#{idx + 1}</span>
                    <span className="testcase-form-size">{formatBytes(rowSize)}</span>
                    <span className="testcase-form-row-actions">
                      <button type="button" className="btn-icon-sm" onClick={() => duplicateTestcaseRow(idx)} title={t('teams.duplicateTestcase')}>
                        <Copy size={13} />
                      </button>
                      <button type="button" className="btn-icon-sm danger" onClick={() => removeTestcaseRow(idx)} title={t('common.delete')}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                  <div className="form-group">
                    <label>{t('admin.input')}</label>
                    <textarea rows={3} value={tc.input} onChange={(e) => {
                      const updated = [...testcases];
                      updated[idx] = { ...updated[idx], input: e.target.value };
                      setTestcases(updated);
                    }} />
                  </div>
                  <div className="form-group">
                    <label>{t('admin.expectedOutput')}</label>
                    <textarea rows={3} value={tc.expected_output} onChange={(e) => {
                      const updated = [...testcases];
                      updated[idx] = { ...updated[idx], expected_output: e.target.value };
                      setTestcases(updated);
                    }} placeholder={selectedProblemJudgeType === 'spj' ? t('admin.spjOptional') : undefined} />
                  </div>
                  <div className="form-group small">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={tc.is_sample} onChange={(e) => {
                        const updated = [...testcases];
                        updated[idx] = { ...updated[idx], is_sample: e.target.checked };
                        setTestcases(updated);
                      }} />
                      {t('admin.sample')}
                    </label>
                  </div>
                  <div className="form-group small">
                    <label>{t('admin.score')}</label>
                    <input type="number" value={tc.score} onChange={(e) => {
                      const updated = [...testcases];
                      updated[idx] = { ...updated[idx], score: parseInt(e.target.value) };
                      setTestcases(updated);
                    }} />
                  </div>
                </div>
              );
            })}
            {overTotalLimit && (
              <span className="testcase-over-warning">
                <AlertCircle size={14} />
                {t('teams.predictedTotal').replace('{0}', formatBytes(predictedTotalSize)).replace('{1}', formatBytes(maxTotalTestcaseSize))}
              </span>
            )}
            <div className="form-actions">
              <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                <Upload size={14} /> {t('admin.addTestcases')}
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleBatchUpload} />
              </label>
              <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                <FileArchive size={14} /> {t('admin.importProblems')}
                <input type="file" accept=".zip" style={{ display: 'none' }} onChange={handleZipImport} />
              </label>
              <button className="btn btn-secondary" onClick={handleAddTestcaseRow}>
                <Plus size={14} /> {t('admin.addTestcase')}
              </button>
              <button className="btn btn-primary" onClick={handleSaveTestcases} disabled={saving || overTotalLimit} title={overTotalLimit ? t('teams.totalTestcaseOver') : undefined}>
                <Save size={16} />
                {saving ? t('admin.saving') : t('admin.saveTestcases')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
