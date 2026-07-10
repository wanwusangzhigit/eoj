import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { ChevronRight, Clock, MemoryStick, Code2, ChevronDown, ChevronUp, FileQuestion, RefreshCw, AlertCircle, RotateCcw, Terminal } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { useThemeStore } from '../store/theme';
import { t } from '../i18n';
import './SubmissionDetail.css';

const getLangExtension = (lang: string) => {
  switch (lang) {
    case 'python': return python();
    case 'cpp': case 'c': return cpp();
    case 'java': return java();
    case 'javascript': return javascript();
    default: return python();
  }
};

export default function SubmissionDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const { theme } = useThemeStore();
  const [submission, setSubmission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedTestCases, setExpandedTestCases] = useState<number[]>([]);
  const [rejudging, setRejudging] = useState(false);
  const [testcases, setTestcases] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Polling cleanup refs (Bug 2 fix)
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const isPolling = (status: string) => status === 'pending' || status === 'running';

  const fetchTestcasesAndLogs = useCallback(async (submissionId: number) => {
    try {
      const [tcData, logData] = await Promise.all([
        api.getSubmissionTestcases(submissionId),
        api.getSubmissionLogs(submissionId),
      ]);
      if (!isMountedRef.current) return;
      setTestcases(tcData.testcases);
      setLogs(logData.logs);
    } catch {
      // Silently ignore — testcases/logs are supplementary data
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  const fetchSubmission = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getSubmission(parseInt(id));
      if (!isMountedRef.current) return;
      setSubmission(data.submission);

      if (isPolling(data.submission.status)) {
        pollingRef.current = setTimeout(fetchSubmission, 3000);
      } else {
        // Judging finished — fetch detailed testcases and logs
        fetchTestcasesAndLogs(data.submission.id);
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      setLoadError(t('submissionDetail.loadError'));
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [id, fetchTestcasesAndLogs]);

  useEffect(() => {
    fetchSubmission();
  }, [fetchSubmission]);

  const toggleTestCase = (index: number) => {
    setExpandedTestCases(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  const handleRejudge = async () => {
    if (!submission || rejudging) return;
    setRejudging(true);
    try {
      await api.rejudgeSubmission(submission.id);
      fetchSubmission();
    } catch {
      useToastStore().addToast('error', t('submissionDetail.rejudgeFailed'));
    } finally {
      setRejudging(false);
    }
  };

  const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');

  if (!user) {
    return (
      <div className="empty-page">
        <h2>{t('submissionDetail.pleaseLogin')}</h2>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner message={t('submissionDetail.loadingSubmission')} />;
  }

  if (loadError) {
    return (
      <div className="submission-detail-page">
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{loadError}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchSubmission}>
            <RefreshCw size={14} /> {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!submission) {
    return <EmptyState icon={FileQuestion} title={t('submissionDetail.notFound')} />;
  }

  const isStillPolling = isPolling(submission.status);

  return (
    <div className="submission-detail-page">
      <div className="breadcrumb">
        <Link to="/submissions">{t('submissions.title')}</Link>
        <ChevronRight size={14} />
        <span>#{submission.id}</span>
      </div>

      <div className="submission-header">
        <h1>{t('submissionDetail.title')} #{submission.id}</h1>
        <div className="submission-header-actions">
          <StatusBadge status={submission.status} />
          {isAdmin && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleRejudge}
              disabled={rejudging}
            >
              <RotateCcw size={14} /> {rejudging ? t('submissionDetail.rejudging') : t('submissionDetail.rejudge')}
            </button>
          )}
        </div>
      </div>

      <div className="submission-info-grid">
        {submission.username && (
          <div className="info-card">
            <label>{t('submissionDetail.user')}</label>
            <Link to={`/users/${submission.username}`}>{submission.username}</Link>
          </div>
        )}
        <div className="info-card">
          <label>{t('submissionDetail.problem')}</label>
          <Link to={`/problems/${submission.problem_slug}`}>{submission.problem_title}</Link>
        </div>
        <div className="info-card">
          <label>{t('submissionDetail.language')}</label>
          <span>{submission.language}</span>
        </div>
        <div className="info-card">
          <label>{t('submissionDetail.score')}</label>
          <span className="score-value">{submission.score || 0}</span>
        </div>
        <div className="info-card">
          <label><Clock size={14} /> {t('submissionDetail.time')}</label>
          <span>{submission.time_used ? `${submission.time_used}ms` : '-'}</span>
        </div>
        <div className="info-card">
          <label><MemoryStick size={14} /> {t('submissionDetail.memory')}</label>
          <span>{submission.memory_used ? `${submission.memory_used}KB` : '-'}</span>
        </div>
        <div className="info-card">
          <label>{t('submissionDetail.submitted')}</label>
          <span>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(submission.created_at))}</span>
        </div>
      </div>

      {/* Testcase Results Table */}
      {!isStillPolling && testcases.length > 0 && (
        <div className="testcase-results">
          <h2>{t('submissionDetail.testResults')}</h2>
          <div className="testcase-table-wrapper">
            <table className="testcase-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('submissionDetail.status')}</th>
                  <th>{t('submissionDetail.time')}</th>
                  <th>{t('submissionDetail.memory')}</th>
                  <th>{t('submissionDetail.score')}</th>
                  <th>{t('submissionDetail.detail')}</th>
                </tr>
              </thead>
              <tbody>
                {testcases.map((tc: any, idx: number) => {
                  const isExpanded = expandedTestCases.includes(idx);
                  return (
                    <tr key={tc.id || idx} className={`testcase-row ${tc.status === 'accepted' ? 'passed' : 'failed'}`}>
                      <td className="tc-idx">{idx + 1}</td>
                      <td><StatusBadge status={tc.status} /></td>
                      <td>{tc.time_used || 0}ms</td>
                      <td>{tc.memory_used || 0}KB</td>
                      <td className="score-value">{tc.score || 0}</td>
                      <td>
                        {tc.detail ? (
                          <div className="tc-detail-cell">
                            <span
                              className="tc-detail-toggle"
                              onClick={() => toggleTestCase(idx)}
                            >
                              {tc.detail.length > 80
                                ? isExpanded ? tc.detail : tc.detail.slice(0, 80) + '...'
                                : tc.detail}
                              {tc.detail.length > 80 && (
                                isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                              )}
                            </span>
                          </div>
                        ) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fallback: old-style details JSON when testcases table is empty */}
      {!isStillPolling && testcases.length === 0 && (() => {
        let details: any[] = [];
        try { details = JSON.parse(submission.details || '[]'); } catch {}
        return details.length > 0 ? (
          <div className="testcase-results">
            <h2>{t('submissionDetail.testResults')}</h2>
            <div className="testcase-list">
              {details.map((tc: any, idx: number) => {
                const isExpanded = expandedTestCases.includes(idx);
                return (
                  <div
                    key={idx}
                    className={`testcase-item ${tc.status === 'accepted' ? 'passed' : 'failed'}`}
                  >
                    <div className="tc-header" onClick={() => toggleTestCase(idx)}>
                      <div className="tc-header-left">
                        <span className="tc-name">{t('submissionDetail.testcase')} {idx + 1}</span>
                        <StatusBadge status={tc.status} />
                      </div>
                      <div className="tc-details">
                        {tc.time_used && <span>{t('submissions.time')}: {tc.time_used}ms</span>}
                        {tc.memory_used && <span>{t('submissions.memory')}: {tc.memory_used}KB</span>}
                        {tc.score !== undefined && <span>{t('submissions.score')}: {tc.score}</span>}
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="tc-content">
                        {tc.input && (
                          <div className="tc-section">
                            <label>{t('submissionDetail.input')}</label>
                            <pre>{tc.input}</pre>
                          </div>
                        )}
                        {tc.expected_output && (
                          <div className="tc-section">
                            <label>{t('submissionDetail.expected')}</label>
                            <pre>{tc.expected_output}</pre>
                          </div>
                        )}
                        {tc.actual_output && (
                          <div className="tc-section">
                            <label>{t('submissionDetail.actual')}</label>
                            <pre>{tc.actual_output}</pre>
                          </div>
                        )}
                        {tc.error_output && (
                          <div className="tc-section error">
                            <label>{t('submissionDetail.error')}</label>
                            <pre>{tc.error_output}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null;
      })()}

      {/* Judge Logs Collapsible Panel */}
      {!isStillPolling && logs.length > 0 && (
        <div className="judge-logs-section">
          <div className="judge-logs-header" onClick={() => setLogsExpanded(!logsExpanded)}>
            <h2><Terminal size={18} /> {t('submissionDetail.judgeLogs')}</h2>
            {logsExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
          {logsExpanded && (
            <div className="judge-logs-content">
              {logs.map((log: any) => (
                <div key={log.id} className={`judge-log-item log-${log.log_type}`}>
                  <span className="log-type-badge">{log.log_type}</span>
                  <span className="log-message">{log.message}</span>
                  <span className="log-time">{log.created_at}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="source-code-section">
        <h2><Code2 size={18} /> {t('submissionDetail.sourceCode')}</h2>
        <div className="source-code-editor">
          <CodeMirror
            value={submission.source_code}
            height="auto"
            theme={theme === 'dark' ? oneDark : undefined}
            extensions={[getLangExtension(submission.language)]}
            readOnly={true}
            basicSetup={{ lineNumbers: true, foldGutter: false }}
          />
        </div>
      </div>
    </div>
  );
}
