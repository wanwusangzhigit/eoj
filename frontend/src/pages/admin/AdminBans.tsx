import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToastStore } from '../../store/toast';
import { t } from '../../i18n';
import { Shield, Trash2, Plus, ChevronLeft, ChevronRight, Smartphone, Globe } from 'lucide-react';
import '../Admin.css';

export default function AdminBans() {
  useDocumentTitle(t('admin.banManagement'));
  const [tab, setTab] = useState<'ips' | 'devices'>('ips');

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1><Shield size={22} /> {t('admin.banManagement')}</h1>
      </div>

      <div className="filter-bar" style={{ gap: 8 }}>
        <button
          className={`btn btn-sm ${tab === 'ips' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('ips')}
        >
          <Globe size={14} /> {t('admin.bannedIPs')}
        </button>
        <button
          className={`btn btn-sm ${tab === 'devices' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('devices')}
        >
          <Smartphone size={14} /> {t('admin.bannedDevices')}
        </button>
      </div>

      {tab === 'ips' ? <BannedIPsList /> : <BannedDevicesList />}
    </div>
  );
}

function BannedIPsList() {
  const addToast = useToastStore((s) => s.addToast);
  const [bans, setBans] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [newIP, setNewIP] = useState('');
  const [newReason, setNewReason] = useState('');

  useEffect(() => { fetchBans(); }, [page]);

  const fetchBans = async () => {
    setLoading(true);
    try {
      const data = await api.getBannedIPs({ page, pageSize: 20 });
      setBans(data.bans);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch { setBans([]); } finally { setLoading(false); }
  };

  const handleBan = async () => {
    if (!newIP.trim()) return;
    try {
      await api.banIP(newIP.trim(), newReason);
      setNewIP('');
      setNewReason('');
      fetchBans();
    } catch (e: any) {
      addToast('error', e.message || t('admin.banFailed'));
    }
  };

  const handleUnban = async (id: number) => {
    if (!confirm(t('admin.confirmUnban'))) return;
    try {
      await api.unbanIP(id);
      fetchBans();
    } catch {
      addToast('error', t('admin.unbanFailed'));
    }
  };

  return (
    <>
      <div className="filter-bar" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          className="form-input"
          placeholder={t('admin.ipAddressPlaceholder')}
          value={newIP}
          onChange={(e) => setNewIP(e.target.value)}
          style={{ width: 180 }}
        />
        <input
          type="text"
          className="form-input"
          placeholder={t('admin.banReasonPlaceholder')}
          value={newReason}
          onChange={(e) => setNewReason(e.target.value)}
          style={{ flex: 1, minWidth: 150 }}
        />
        <button className="btn btn-primary btn-sm" onClick={handleBan} disabled={!newIP.trim()}>
          <Plus size={14} /> {t('admin.banIP')}
        </button>
      </div>

      <span className="badge" style={{ marginBottom: 8 }}>{total} {t('admin.totalRecords')}</span>

      {loading ? (
        <div className="loading-container"><div className="loading-spinner" /></div>
      ) : bans.length === 0 ? (
        <div className="empty-page"><p>{t('admin.noBannedIPs')}</p></div>
      ) : (
        <div className="table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('common.id')}</th>
                <th>{t('admin.ipAddress')}</th>
                <th>{t('admin.banReason')}</th>
                <th>{t('admin.bannedBy')}</th>
                <th>{t('admin.banTime')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {bans.map((ban: any) => (
                <tr key={ban.id}>
                  <td>{ban.id}</td>
                  <td><span className="tag-chip active">{ban.ip}</span></td>
                  <td>{ban.reason || '-'}</td>
                  <td>{ban.banned_by_username || ban.banned_by || '-'}</td>
                  <td className="cell-value" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(ban.created_at + 'Z').toLocaleString()}
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleUnban(ban.id)}>
                      <Trash2 size={12} /> {t('admin.unban')}
                    </button>
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
    </>
  );
}

function BannedDevicesList() {
  const addToast = useToastStore((s) => s.addToast);
  const [bans, setBans] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [newFP, setNewFP] = useState('');
  const [newReason, setNewReason] = useState('');

  useEffect(() => { fetchBans(); }, [page]);

  const fetchBans = async () => {
    setLoading(true);
    try {
      const data = await api.getBannedDevices({ page, pageSize: 20 });
      setBans(data.bans);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch { setBans([]); } finally { setLoading(false); }
  };

  const handleBan = async () => {
    if (!newFP.trim()) return;
    try {
      await api.banDevice(newFP.trim(), newReason);
      setNewFP('');
      setNewReason('');
      fetchBans();
    } catch (e: any) {
      addToast('error', e.message || t('admin.banFailed'));
    }
  };

  const handleUnban = async (id: number) => {
    if (!confirm(t('admin.confirmUnban'))) return;
    try {
      await api.unbanDevice(id);
      fetchBans();
    } catch {
      addToast('error', t('admin.unbanFailed'));
    }
  };

  return (
    <>
      <div className="filter-bar" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          className="form-input"
          placeholder={t('admin.deviceFPPlaceholder')}
          value={newFP}
          onChange={(e) => setNewFP(e.target.value)}
          style={{ width: 220 }}
        />
        <input
          type="text"
          className="form-input"
          placeholder={t('admin.banReasonPlaceholder')}
          value={newReason}
          onChange={(e) => setNewReason(e.target.value)}
          style={{ flex: 1, minWidth: 150 }}
        />
        <button className="btn btn-primary btn-sm" onClick={handleBan} disabled={!newFP.trim()}>
          <Plus size={14} /> {t('admin.banDevice')}
        </button>
      </div>

      <span className="badge" style={{ marginBottom: 8 }}>{total} {t('admin.totalRecords')}</span>

      {loading ? (
        <div className="loading-container"><div className="loading-spinner" /></div>
      ) : bans.length === 0 ? (
        <div className="empty-page"><p>{t('admin.noBannedDevices')}</p></div>
      ) : (
        <div className="table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('common.id')}</th>
                <th>{t('admin.deviceFingerprint')}</th>
                <th>{t('admin.banReason')}</th>
                <th>{t('admin.bannedBy')}</th>
                <th>{t('admin.banTime')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {bans.map((ban: any) => (
                <tr key={ban.id}>
                  <td>{ban.id}</td>
                  <td><span className="tag-chip small active">{ban.device_fingerprint}</span></td>
                  <td>{ban.reason || '-'}</td>
                  <td>{ban.banned_by_username || ban.banned_by || '-'}</td>
                  <td className="cell-value" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(ban.created_at + 'Z').toLocaleString()}
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleUnban(ban.id)}>
                      <Trash2 size={12} /> {t('admin.unban')}
                    </button>
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
    </>
  );
}
