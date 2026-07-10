import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { ShieldAlert, Search, ArrowLeft, Play } from 'lucide-react';
import CodeDiff from '../../components/CodeDiff';
import '../Admin.css';

const SIMILARITY_COLORS = (sim: number) => {
  if (sim >= 0.85) return { color: '#fe2c55', label: 'veryHighSimilarity' };
  if (sim >= 0.7) return { color: '#ff7c00', label: 'highSimilarity' };
  return { color: '#ffc800', label: 'lowSimilarity' };
};

export default function AdminPlagiarism() {
  useDocumentTitle(t('plagiarism.title'));
  const addToast = useToastStore((s) => s.addToast);
  const [contests, setContests] = useState<any[]>([]);
  const [selectedContestId, setSelectedContestId] = useState<number | null>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);

  useEffect(() => {
    fetchContests();
  }, []);

  useEffect(() => {
    if (selectedContestId) {
      fetchReports();
      setSelectedReport(null);
    } else {
      setReports([]);
    }
  }, [selectedContestId]);

  const fetchContests = async () => {
    try {
      const data = await api.getContests({ pageSize: 100 });
      setContests(data.contests);
    } catch (e) {
      console.error('Failed to fetch contests:', e);
    }
  };

  const fetchReports = async () => {
    if (!selectedContestId) return;
    setLoading(true);
    try {
      const data = await api.getPlagiarismReports(selectedContestId);
      setReports(data.reports);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleTrigger = async () => {
    if (!selectedContestId) return;
    setTriggering(true);
    try {
      const result = await api.triggerPlagiarismCheck(selectedContestId);
      addToast('success', `${t('plagiarism.checked')}: ${result.checked} | ${t('plagiarism.suspiciousPairs')}: ${result.reports}`);
      await fetchReports();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setTriggering(false);
    }
  };

  const handleViewDetail = async (id: number) => {
    setLoading(true);
    try {
      const data = await api.getPlagiarismReport(id);
      setSelectedReport(data);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  if (selectedReport) {
    const { report, submission_a, submission_b } = selectedReport;
    const simInfo = SIMILARITY_COLORS(report.similarity);
    return (
      <div className="admin-form">
        <button className="btn btn-secondary btn-sm" onClick={() => setSelectedReport(null)}>
          <ArrowLeft size={14} />
          {t('plagiarism.backToList')}
        </button>
        <h2 style={{ marginTop: 16 }}>{t('plagiarism.reportDetail')} #{report.id}</h2>
        <div className="admin-card">
          <div className="report-meta-grid">
            <div><strong>{t('plagiarism.contestId')}:</strong> {report.contest_id}</div>
            <div><strong>{t('plagiarism.similarity')}:</strong>
              <span style={{ color: simInfo.color, fontWeight: 600 }}>
                {(report.similarity * 100).toFixed(1)}% ({t(`plagiarism.${simInfo.label}`)})
              </span>
            </div>
            <div><strong>{t('plagiarism.method')}:</strong> {report.method}</div>
            <div><strong>{t('common.time')}:</strong> {report.created_at}</div>
            <div>
              <strong>{t('plagiarism.userA')}:</strong> {submission_a?.username}
              <span className="muted"> (#{submission_a?.id}, {submission_a?.problem_title})</span>
            </div>
            <div>
              <strong>{t('plagiarism.userB')}:</strong> {submission_b?.username}
              <span className="muted"> (#{submission_b?.id}, {submission_b?.problem_title})</span>
            </div>
          </div>
        </div>
        <h3 style={{ marginTop: 24 }}>{t('plagiarism.codeCompare')}</h3>
        <CodeDiff
          codeA={submission_a?.source_code || ''}
          codeB={submission_b?.source_code || ''}
          language={submission_a?.language}
        />
      </div>
    );
  }

  return (
    <div className="admin-form">
      <h2>{t('plagiarism.title')}</h2>

      <div className="admin-card">
        <div className="plagiarism-controls">
          <label>
            <span>{t('plagiarism.selectContest')}</span>
            <select
              value={selectedContestId || ''}
              onChange={(e) => setSelectedContestId(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">{t('plagiarism.selectContest')}</option>
              {contests.map((c) => (
                <option key={c.id} value={c.id}>#{c.id} {c.title}</option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary btn-sm"
            disabled={!selectedContestId || triggering}
            onClick={handleTrigger}
          >
            <Play size={14} />
            {triggering ? t('plagiarism.triggering') : t('plagiarism.trigger')}
          </button>
          <span className="muted">{t('plagiarism.similarityThreshold')}</span>
        </div>
      </div>

      {selectedContestId && (
        <>
          <h3 style={{ marginTop: 24 }}>{t('plagiarism.reports')}</h3>
          <div className="admin-table-container">
            <div className="pm-table-header">
              <span className="pm-col pm-col-id">{t('common.id')}</span>
              <span className="pm-col" style={{ width: '160px' }}>{t('plagiarism.userA')}</span>
              <span className="pm-col" style={{ width: '160px' }}>{t('plagiarism.userB')}</span>
              <span className="pm-col" style={{ width: '110px' }}>{t('plagiarism.similarity')}</span>
              <span className="pm-col" style={{ width: '120px' }}>{t('common.actions')}</span>
            </div>
            {loading ? (
              <div className="pm-empty">{t('common.loading')}</div>
            ) : reports.length === 0 ? (
              <div className="pm-empty">{t('plagiarism.noReports')}</div>
            ) : (
              reports.map((r: any) => {
                const simInfo = SIMILARITY_COLORS(r.similarity);
                return (
                  <div key={r.id} className="pm-table-row">
                    <span className="pm-col pm-col-id">{r.id}</span>
                    <span className="pm-col" style={{ width: '160px' }}>
                      {r.user_a_name}
                      <div className="muted">#{r.submission_a}</div>
                    </span>
                    <span className="pm-col" style={{ width: '160px' }}>
                      {r.user_b_name}
                      <div className="muted">#{r.submission_b}</div>
                    </span>
                    <span className="pm-col" style={{ width: '110px', color: simInfo.color, fontWeight: 600 }}>
                      {(r.similarity * 100).toFixed(1)}%
                    </span>
                    <span className="pm-col" style={{ width: '120px' }}>
                      <button className="btn-text-sm" onClick={() => handleViewDetail(r.id)}>
                        <Search size={13} /> {t('plagiarism.reportDetail')}
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {!selectedContestId && (
        <div className="pm-empty" style={{ marginTop: 24 }}>
          <ShieldAlert size={36} />
          <p>{t('plagiarism.selectContest')}</p>
        </div>
      )}
    </div>
  );
}
