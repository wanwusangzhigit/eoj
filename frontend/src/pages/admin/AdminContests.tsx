import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { formatContestTime, parseContestTimeToMs } from '../../utils/contestTime';
import {
  Trash2, ChevronLeft, ChevronRight, ExternalLink, Clock, Play, CheckCircle, Users,
} from 'lucide-react';
import '../Admin.css';

// 计算比赛进度百分比(0-100):未开始 0,进行中按时间比例,已结束 100
function contestProgress(c: any): number {
  const now = Date.now();
  const start = parseContestTimeToMs(c.start_time);
  const end = parseContestTimeToMs(c.end_time);
  if (!isFinite(start) || !isFinite(end)) return 0;
  if (now < start) return 0;
  if (now >= end) return 100;
  return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
}

// 按当前时间动态计算比赛状态(不依赖可能过期的 status 静态字段,与后端 effectiveContestStatus 一致)
function contestStatus(c: any): 'upcoming' | 'running' | 'ended' {
  const now = Date.now();
  const start = parseContestTimeToMs(c.start_time);
  const end = parseContestTimeToMs(c.end_time);
  if (!isFinite(start) || !isFinite(end)) return 'upcoming';
  if (now >= start && now < end) return 'running';
  if (now >= end) return 'ended';
  return 'upcoming';
}

export default function AdminContests() {
  useDocumentTitle(t('admin.contestManagement'));
  const addToast = useToastStore((s) => s.addToast);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const [adminContests, setAdminContests] = useState<any[]>([]);
  const [contestPagination, setContestPagination] = useState<any>(null);
  const [contestPage, setContestPage] = useState(1);

  const fetchAdminContests = useCallback(async () => {
    try {
      const data = await api.getAdminContests({ page: contestPage, pageSize: 10 });
      setAdminContests(data.contests);
      setContestPagination(data.pagination);
    } catch (e) { console.error('Failed to fetch contests:', e); }
  }, [contestPage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAdminContests();
  }, [fetchAdminContests, refreshKey]);

  const handleDeleteContest = async (id: number) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return;
    try {
      await api.deleteContest(id);
      addToast('success', t('common.deleteSuccess'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.contestManagement')}</h2>
      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">{t('common.id')}</span>
          <span className="pm-col pm-col-title">{t('contests.title')}</span>
          <span className="pm-col" style={{width:'110px'}}>{t('contests.status')}</span>
          <span className="pm-col" style={{width:'160px'}}>{t('contests.startTime')}</span>
          <span className="pm-col" style={{width:'100px'}}>{t('contests.participants')}</span>
          <span className="pm-col" style={{width:'150px'}}>{t('admin.progress')}</span>
          <span className="pm-col" style={{width:'140px'}}>{t('common.actions')}</span>
        </div>
        {adminContests.length === 0 ? (
          <div className="pm-empty">{t('common.noData')}</div>
        ) : (
          adminContests.map((c: any) => {
            const progress = contestProgress(c);
            const status = contestStatus(c);
            return (
              <div key={c.id} className="pm-table-row">
                <span className="pm-col pm-col-id">{c.id}</span>
                <span className="pm-col pm-col-title">
                  <a href={`/match/${c.id}`} style={{color:'inherit',textDecoration:'none'}}>{c.title}</a>
                </span>
                <span className="pm-col" style={{width:'110px'}}>
                  <span className={`badge ${status === 'running' ? 'badge-success' : status === 'upcoming' ? 'badge-info' : 'badge-ended'} contest-admin-status`}>
                    {status === 'running' ? <Play size={12} /> : status === 'upcoming' ? <Clock size={12} /> : <CheckCircle size={12} />}
                    {status}
                  </span>
                </span>
                <span className="pm-col" style={{width:'160px', fontSize:'12px', color:'var(--text-secondary)'}}>
                  {c.start_time ? formatContestTime(c.start_time) : '-'}
                </span>
                <span className="pm-col" style={{width:'100px'}}>
                  <span className="contest-admin-participants">
                    <Users size={13} /> {c.participant_count ?? 0}
                  </span>
                </span>
                <span className="pm-col" style={{width:'150px'}}>
                  <div className="contest-admin-progress" title={`${progress}%`}>
                    <div className={`contest-admin-progress-fill ${status === 'running' ? 'running' : status === 'ended' ? 'done' : ''}`} style={{ width: `${progress}%` }} />
                  </div>
                  <span className="contest-admin-progress-label">{progress}%</span>
                </span>
                <span className="pm-col" style={{width:'140px'}}>
                  <div className="admin-row-actions">
                    <a href={`/match/${c.id}`} className="btn-text-sm" title={t('admin.viewContest')}>
                      <ExternalLink size={13} /> {t('admin.viewContest')}
                    </a>
                    <button className="btn-icon-sm danger" title={t('common.delete')} onClick={() => handleDeleteContest(c.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </span>
              </div>
            );
          })
        )}
      </div>
      {contestPagination && contestPagination.totalPages > 1 && (
        <div className="pm-pagination">
          <button className="btn btn-secondary btn-sm" disabled={contestPage <= 1} onClick={() => setContestPage(contestPage - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span className="pm-page-info">{contestPage} / {contestPagination.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={contestPage >= contestPagination.totalPages} onClick={() => setContestPage(contestPage + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
