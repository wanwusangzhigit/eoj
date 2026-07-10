import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { Search, Trash2, ChevronLeft, ChevronRight, Globe, Lock, Eye } from 'lucide-react';
import '../Admin.css';

export default function AdminTeams() {
  useDocumentTitle(t('admin.teamManagement'));
  const addToast = useToastStore((s) => s.addToast);

  const [teams, setTeams] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchTeams();
  }, [page, debouncedSearch]);

  const fetchTeams = async () => {
    setLoading(true);
    try {
      const data = await api.getAdminTeams({
        page,
        pageSize: 20,
        search: debouncedSearch || undefined,
      });
      setTeams(data.teams);
      setPagination(data.pagination);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleVisibility = async (team: any) => {
    const newVisibility = !team.is_public;
    try {
      await api.updateTeamVisibility(team.id, newVisibility);
      addToast('success', t('admin.teamVisibilityUpdated'));
      await fetchTeams();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleDelete = async (team: any) => {
    const msg = t('admin.teamDeleteConfirm').replace('{name}', team.name);
    if (!confirm(msg)) return;
    try {
      await api.deleteTeamAdmin(team.id);
      addToast('success', t('admin.teamDeleted'));
      await fetchTeams();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.teamManagement')}</h2>

      <div className="admin-filters" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder={t('admin.searchTeams')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">ID</span>
          <span className="pm-col pm-col-title">{t('admin.teamName')}</span>
          <span className="pm-col" style={{ width: '120px' }}>{t('admin.owner')}</span>
          <span className="pm-col" style={{ width: '80px' }}>{t('admin.members')}</span>
          <span className="pm-col" style={{ width: '90px' }}>{t('admin.visibility')}</span>
          <span className="pm-col" style={{ width: '120px' }}>{t('common.actions')}</span>
        </div>
        {loading ? (
          <div className="pm-empty">{t('common.loading')}</div>
        ) : teams.length === 0 ? (
          <div className="pm-empty">{t('admin.noTeams')}</div>
        ) : (
          teams.map((team) => (
            <div key={team.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{team.id}</span>
              <span className="pm-col pm-col-title">
                <a href={`/teams/${team.slug}`} target="_blank" rel="noopener" className="link">
                  {team.name}
                </a>
                {team.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {team.description.length > 60 ? team.description.slice(0, 60) + '...' : team.description}
                  </div>
                )}
              </span>
              <span className="pm-col" style={{ width: '120px' }}>
                <a href={`/users/${team.owner_name}`} target="_blank" rel="noopener" className="link">
                  {team.owner_name}
                </a>
              </span>
              <span className="pm-col" style={{ width: '80px' }}>{team.member_count ?? 0}</span>
              <span className="pm-col" style={{ width: '90px' }}>
                <button
                  className={`visibility-toggle ${team.is_public ? 'public' : 'private'}`}
                  onClick={() => handleToggleVisibility(team)}
                  title={team.is_public ? t('admin.makePrivate') : t('admin.makePublic')}
                >
                  {team.is_public ? <Globe size={12} /> : <Lock size={12} />}
                  {team.is_public ? t('admin.teamPublic') : t('admin.teamPrivate')}
                </button>
              </span>
              <span className="pm-col" style={{ width: '120px', display: 'flex', gap: 6 }}>
                <a
                  href={`/teams/${team.slug}`}
                  target="_blank"
                  rel="noopener"
                  className="btn-text-sm"
                  title={t('admin.viewTeam')}
                >
                  <Eye size={14} />
                </a>
                <button
                  className="btn-text-sm danger"
                  onClick={() => handleDelete(team)}
                  title={t('common.delete')}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn-icon-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>{t('common.page').replace('{0}', String(page)).replace('{1}', String(pagination.totalPages))}</span>
          <button className="btn-icon-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
