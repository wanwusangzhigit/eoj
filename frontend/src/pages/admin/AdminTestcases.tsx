import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { DIFFICULTY_COLORS } from '../../constants';
import { t } from '../../i18n';
import {
  Plus, Save, Trash2, X, ChevronUp, ChevronDown, Upload,
} from 'lucide-react';
import '../Admin.css';

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
  const [selectedProblemJudgeType, setSelectedProblemJudgeType] = useState<string>('default');
  const testcaseSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      handleSelectTestcaseProblem(problem);
    }
  }, []);

  const handleSelectTestcaseProblem = async (problem: any) => {
    setSelectedTestcaseProblem(problem);
    setSelectedProblemJudgeType(problem.judge_type || 'default');
    setTestcaseSearch('');
    try {
      const data = await api.getProblemTestcases(problem.id);
      setExistingTestcases(data.testcases);
    } catch (e) {
      console.error('Failed to fetch testcases:', e);
      setExistingTestcases([]);
    }
  };

  const handleAddTestcaseRow = () => {
    setTestcases([...testcases, { input: '', expected_output: '', is_sample: false, score: 10 }]);
  };

  const handleBatchUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
        if (parsed.length === 0) {
          addToast('error', '文件中没有有效的测试数据');
          return;
        }
        setTestcases(parsed);
        addToast('success', `已导入 ${parsed.length} 个测试用例`);
      } catch {
        addToast('error', 'JSON 格式错误');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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
    <div className="admin-form">
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
          <div className="testcase-existing">
            <h3>{t('admin.existingTestcases')}</h3>
            {existingTestcases.length === 0 ? (
              <p className="testcase-empty">{t('admin.noTestcaseData')}</p>
            ) : (
              <>
                <div className="testcase-stats">
                  <span>{t('admin.totalTestcases').replace('{0}', String(existingTestcases.length))}</span>
                  <span>{t('admin.sampleCount').replace('{0}', String(existingTestcases.filter((tc: any) => tc.is_sample).length))}</span>
                  <span>{t('admin.hiddenCount').replace('{0}', String(existingTestcases.filter((tc: any) => !tc.is_sample).length))}</span>
                  <span>{t('admin.totalScore').replace('{0}', String(existingTestcases.reduce((sum: number, tc: any) => sum + (tc.score || 0), 0)))}</span>
                </div>
                <div className="testcase-list">
                  {existingTestcases.map((tc: any, idx: number) => (
                    <div key={idx} className="testcase-item">
                      <div
                        className="testcase-summary-row"
                        onClick={() => toggleTestcaseExpand(idx)}
                        title={expandedTestcases.has(idx) ? t('admin.clickToCollapse') : t('admin.clickToExpand')}
                      >
                        <span className="testcase-index">#{idx + 1}</span>
                        <span className={`testcase-type-badge ${tc.is_sample ? 'sample' : 'hidden'}`}>
                          {tc.is_sample ? t('admin.sample') : t('admin.hidden')}
                        </span>
                        <span className="testcase-score">{t('admin.score')}: {tc.score}</span>
                        <span className="testcase-expand-icon">
                          {expandedTestcases.has(idx) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </span>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={(e) => { e.stopPropagation(); handleDeleteTestcase(idx); }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {expandedTestcases.has(idx) && (
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

          <div className="testcase-new">
            <h3>{t('admin.addNewTestcases')}</h3>
            {testcases.map((tc, idx) => (
              <div key={idx} className="testcase-form-row">
                <div className="form-group">
                  <label>{t('admin.input')}</label>
                  <textarea
                    rows={3}
                    value={tc.input}
                    onChange={(e) => {
                      const updated = [...testcases];
                      updated[idx] = { ...updated[idx], input: e.target.value };
                      setTestcases(updated);
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>{t('admin.expectedOutput')}</label>
                  <textarea
                    rows={3}
                    value={tc.expected_output}
                    onChange={(e) => {
                      const updated = [...testcases];
                      updated[idx] = { ...updated[idx], expected_output: e.target.value };
                      setTestcases(updated);
                    }}
                    placeholder={selectedProblemJudgeType === 'spj' ? t('admin.spjOptional') : undefined}
                  />
                </div>
                <div className="form-group small">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={tc.is_sample}
                      onChange={(e) => {
                        const updated = [...testcases];
                        updated[idx] = { ...updated[idx], is_sample: e.target.checked };
                        setTestcases(updated);
                      }}
                    />
                    {t('admin.sample')}
                  </label>
                </div>
                <div className="form-group small">
                  <label>{t('admin.score')}</label>
                  <input
                    type="number"
                    value={tc.score}
                    onChange={(e) => {
                      const updated = [...testcases];
                      updated[idx] = { ...updated[idx], score: parseInt(e.target.value) };
                      setTestcases(updated);
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="form-actions">
              <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                <Upload size={14} /> 批量导入
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleBatchUpload} />
              </label>
              <button className="btn btn-secondary" onClick={handleAddTestcaseRow}>
                <Plus size={14} /> {t('admin.addTestcase')}
              </button>
              <button className="btn btn-primary" onClick={handleSaveTestcases} disabled={saving}>
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
