import { useState, useEffect, useRef } from 'react';
import { api } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToastStore } from '../../store/toast';
import { t } from '../../i18n';
import { Search, FileText, ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import '../Admin.css';

export default function AdminAuditLogs() {
  useDocumentTitle(t('admin.auditLogs'));
  const [logs, setLogs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { setDebouncedSearch(search); }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search]);

  useEffect(() => {
    fetchLogs();
  }, [page, debouncedSearch, ipFilter]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await api.getAuditLogs({
        page,
        pageSize: 20,
        search: debouncedSearch || undefined,
        ip: ipFilter || undefined,
      });
      setLogs(data.logs);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const [banTarget, setBanTarget] = useState<{ type: 'ip' | 'device'; value: string } | null>(null);
  const [banReason, setBanReason] = useState('');

  const handleBanIP = (ip: string) => {
    if (!ip || ip === 'unknown') return;
    setBanTarget({ type: 'ip', value: ip });
    setBanReason('');
  };

  const handleBanDevice = (fp: string) => {
    if (!fp) return;
    setBanTarget({ type: 'device', value: fp });
    setBanReason('');
  };

  const confirmBan = async () => {
    if (!banTarget) return;
    try {
      if (banTarget.type === 'ip') {
        await api.banIP(banTarget.value, banReason);
      } else {
        await api.banDevice(banTarget.value, banReason);
      }
      useToastStore.getState().addToast('success', t('admin.banSuccess'));
    } catch (e: any) {
      useToastStore.getState().addToast('error', e.message || t('admin.banFailed'));
    } finally {
      setBanTarget(null);
      setBanReason('');
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1><FileText size={22} /> {t('admin.auditLogs')}</h1>
        <span className="badge">{total} {t('admin.totalRecords')}</span>
      </div>

      <div className="filter-bar">
        <div className="search-input-wrapper">
          <Search size={16} />
          <input
            type="text"
            className="form-input"
            placeholder={t('admin.searchAuditPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            name="audit_search"
            autoComplete="off"
          />
        </div>
        <input
          type="text"
          className="form-input"
          placeholder={t('admin.filterByIP')}
          value={ipFilter}
          onChange={(e) => { setIpFilter(e.target.value); setPage(1); }}
          style={{ width: 160 }}
          name="ip_filter"
          autoComplete="off"
        />
      </div>

      {loading ? (
        <div className="loading-container"><div className="loading-spinner" /></div>
      ) : logs.length === 0 ? (
        <div className="empty-page"><p>{t('admin.noAuditLogs')}</p></div>
      ) : (
        <div className="table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('admin.auditTime')}</th>
                <th>{t('admin.auditUser')}</th>
                <th>{t('admin.auditIP')}</th>
                <th>{t('admin.auditDevice')}</th>
                <th>{t('admin.auditAction')}</th>
                <th>{t('admin.auditPage')}</th>
                <th>{t('admin.auditUserAgent')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id}>
                  <td className="cell-value" style={{ whiteSpace: 'nowrap' }}>
                    {new Intl.DateTimeFormat(undefined, {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit', second: '2-digit',
                      hour12: false,
                    }).format(new Date(log.created_at + 'Z'))}
                  </td>
                  <td>{log.username || '-'}</td>
                  <td>
                    <span className="tag-chip">{log.ip}</span>
                  </td>
                  <td>
                    <span className="tag-chip small">{log.device_fingerprint || '-'}</span>
                  </td>
                  <td>
                    <span className={`tag-chip ${log.method === 'POST' || log.method === 'PUT' || log.method === 'DELETE' ? 'active' : ''}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="cell-value" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {log.page}
                  </td>
                  <td className="cell-value" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.8em' }}>
                    {log.user_agent || '-'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {log.ip && log.ip !== 'unknown' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => handleBanIP(log.ip)} title={t('admin.banIP')}>
                          <Shield size={12} /> IP
                        </button>
                      )}
                      {log.device_fingerprint && (
                        <button className="btn btn-secondary btn-sm" onClick={() => handleBanDevice(log.device_fingerprint)} title={t('admin.banDevice')}>
                          <Shield size={12} /> FP
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>{page} / {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {banTarget && (
        <div className="modal-overlay" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="modal-content" style={{
            background: 'var(--bg-card)', borderRadius: 8, padding: 24,
            maxWidth: 400, width: '90%', boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ marginBottom: 16 }}>
              <Shield size={18} style={{ display: 'inline', marginRight: 8 }} />
              {banTarget.type === 'ip' ? t('admin.banIP') : t('admin.banDevice')}
            </h3>
            <p style={{ marginBottom: 8, fontSize: '0.9em', color: 'var(--text-secondary)' }}>
              {banTarget.type === 'ip' ? t('admin.ipAddress') : t('admin.deviceFingerprint')}:
            </p>
            <p style={{ marginBottom: 16, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {banTarget.value}
            </p>
            <label htmlFor="ban-reason-input" style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
              {t('admin.banReason')}
            </label>
            <input
              id="ban-reason-input"
              type="text"
              className="form-input"
              placeholder={t('admin.banReasonPlaceholder')}
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setBanTarget(null); setBanReason(''); }}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={confirmBan}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
