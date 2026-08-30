import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { Trophy, Calendar, Users, Filter, PlusCircle, AlertCircle, Clock, Play, CheckCircle, ChevronLeft, ChevronRight, CalendarPlus } from 'lucide-react';
import { t } from '../i18n';
import { usePermissions } from '../hooks/usePermissions';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNow } from '../hooks/useNow';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { parseContestTimeToMs, formatContestTime } from '../utils/contestTime';
import './Contests.css';

const STATUS_OPTIONS = ['all', 'upcoming', 'running', 'ended'] as const;

const STATUS_BADGE_CLASS: Record<string, string> = {
  upcoming: 'badge badge-info',
  running: 'badge badge-success',
  ended: 'badge badge-ended',
};

const STATUS_ICON: Record<string, any> = {
  upcoming: Clock,
  running: Play,
  ended: CheckCircle,
};

export default function Contests() {
  const perms = usePermissions();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const [contests, setContests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);
  const now = useNow();
  useDocumentTitle(t('contests.title'));

  const fetchContests = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getContests({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        page,
        pageSize: 20,
      });
      setContests(data.contests);
      setPagination(data.pagination);
    } catch (e) {
      console.error('Failed to fetch contests:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContests();
  }, [fetchContests]);

  // 切换状态筛选时回到第一页
  const changeStatusFilter = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  const getStatusLabel = (status: string) => {
    if (status === 'upcoming') return t('contests.upcoming');
    if (status === 'running') return t('contests.running');
    return t('contests.ended');
  };

  const getContestStatus = (contest: any): string => {
    // 以服务端时间为准:优先使用后端返回的 effective_status(按服务器时间动态计算)
    if (contest.effective_status) return contest.effective_status;
    // 兜底(旧接口未返回该字段时):本地按 UTC 解析计算,与后端 parseContestTimeToMs 一致
    const start = parseContestTimeToMs(contest.start_time);
    const end = parseContestTimeToMs(contest.end_time);
    if (now < start) return 'upcoming';
    if (now >= start && now < end) return 'running';
    return 'ended';
  };

  const formatDate = (dateStr: string) => {
    return formatContestTime(dateStr);
  };

  // 导出已报名比赛的 ICS 日历文件
  const handleExportIcs = async () => {
    try {
      await api.exportContestsIcs();
      addToast('success', t('contests.icsExported'));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="contests-page">
      <div className="contests-header">
        <div className="contests-title-section">
          <Trophy size={28} className="title-icon" />
          <div>
            <h1 className="page-title">{t('contests.title')}</h1>
          </div>
        </div>

        {user && (
          <button className="btn btn-secondary btn-sm" onClick={handleExportIcs} title={t('contests.exportIcs')}>
            <CalendarPlus size={14} />
            {t('contests.exportIcs')}
          </button>
        )}

        {perms.canManageContests && (
          <Link to="/match/new" className="btn btn-primary btn-sm">
            <PlusCircle size={14} />
            {t('contests.createContest')}
          </Link>
        )}

        <div className="status-filter">
          <Filter size={14} />
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status}
              className={`filter-btn ${statusFilter === status ? 'active' : ''}`}
              onClick={() => changeStatusFilter(status)}
            >
              {status === 'all' ? t('contests.all') : getStatusLabel(status)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : loadError ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchContests}>{t('common.retry')}</button>
        </div>
      ) : contests.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={t('contests.noContests')}
        />
      ) : (
        <div className="contests-list">
          {contests.map((contest) => {
            const status = getContestStatus(contest);
            return (
              <Link
                key={contest.id}
                to={`/match/${contest.id}`}
                className="contest-card"
              >
                <div className="contest-card-header">
                  <h3 className="contest-title">{contest.title}</h3>
                  <span className={`${STATUS_BADGE_CLASS[status] || 'badge'} contest-status-badge`}>
                    {(() => { const Icon = STATUS_ICON[status] || Clock; return <Icon size={12} />; })()}
                    {getStatusLabel(status)}
                  </span>
                </div>
                <div className="contest-card-body">
                  <div className="contest-info-row">
                    <Calendar size={14} />
                    <span className="contest-time">
                      {t('contests.startTime')}: {formatDate(contest.start_time)}
                    </span>
                    <span className="contest-time-separator">→</span>
                    <span className="contest-time">
                      {t('contests.endTime')}: {formatDate(contest.end_time)}
                    </span>
                  </div>
                  <div className="contest-info-row">
                    <Users size={14} />
                    <span>{t('contests.participants')}: {contest.participant_count ?? 0}</span>
                  </div>
                </div>
              </Link>
            );
          })}
          </div>
        )}
        {pagination && pagination.totalPages > 1 && (
          <div className="contests-pagination">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage(pagination.page - 1)}
            >
              <ChevronLeft size={14} /> {t('common.previous')}
            </button>
            <span className="contests-pagination-info">
              {t('common.page').replace('{0}', String(pagination.page)).replace('{1}', String(pagination.totalPages))}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage(pagination.page + 1)}
            >
              {t('common.next')} <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }
