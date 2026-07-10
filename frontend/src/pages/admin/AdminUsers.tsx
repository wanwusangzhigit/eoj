import { useState, useEffect, useRef } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import {
  Search, Shield, User, ChevronLeft, ChevronRight,
} from 'lucide-react';
import '../Admin.css';

export default function AdminUsers() {
  useDocumentTitle(t('admin.userManagement'));
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const [userList, setUserList] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [userPage, setUserPage] = useState(1);
  const [userPagination, setUserPagination] = useState<any>(null);

  const [editingPermissions, setEditingPermissions] = useState<number | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);

  useEffect(() => {
    fetchUserList();
  }, [userPage, debouncedUserSearch, refreshKey]);

  // Debounce user search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedUserSearch(userSearch);
    }, 400);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [userSearch]);

  const fetchUserList = async () => {
    try {
      const data = await api.getUserList({
        page: userPage,
        pageSize: 20,
        search: debouncedUserSearch || undefined,
      });
      setUserList(data.users);
      setUserPagination(data.pagination);
    } catch (e) {
      console.error('Failed to fetch users:', e);
    }
  };

  const handleRoleChange = async (userId: number, newRole: string) => {
    try {
      await api.updateUserRole(userId, newRole);
      useToastStore().addToast('success', t('admin.roleUpdated'));
      refresh();
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    }
  };

  const handleEditPermissions = (userId: number, currentPermissions: string[]) => {
    setEditingPermissions(userId);
    setUserPermissions(currentPermissions || []);
  };

  const handleSavePermissions = async (userId: number) => {
    try {
      await api.updateUserPermissions(userId, userPermissions);
      setEditingPermissions(null);
      useToastStore().addToast('success', t('admin.permissionsUpdated'));
      refresh();
    } catch (e: any) {
      console.error('Failed to update permissions:', e);
      useToastStore().addToast('error', e.message || t('common.error'));
    }
  };

  const togglePermission = (perm: string) => {
    setUserPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  const handleToggleBan = async (userId: number, currentlyBanned: boolean) => {
    try {
      await api.setUserBanned(userId, !currentlyBanned);
      useToastStore().addToast('success', t('common.success'));
      refresh();
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.userManagement')}</h2>
      <div className="user-search">
        <Search size={16} />
        <input
          type="text"
          placeholder={t('admin.searchUsers')}
          name="user_search"
          autoComplete="off"
          value={userSearch}
          onChange={(e) => {
            setUserSearch(e.target.value);
            setUserPage(1);
          }}
        />
      </div>
      <div className="user-list">
        {userList.map((u) => (
          <div key={u.id} className={`user-item${u.banned ? ' user-banned' : ''}`}>
            <div className="user-info">
              <span className="user-name">
                {u.username}
                {u.banned && <span className="user-banned-badge">{t('admin.banned')}</span>}
              </span>
              <span className="user-role-badge" style={{ color: u.role === 'admin' ? '#ef4444' : '#3b82f6' }}>
                {u.role === 'admin' ? <Shield size={14} /> : <User size={14} />}
                {u.role}
              </span>
              {u.created_at && (
                <span className="user-date">
                  {t('admin.joined')} {new Date(u.created_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="user-actions">
              {u.id === 1 ? (
                <span style={{fontSize:'12px',color:'var(--text-muted)'}}>{t('admin.superAdmin')}</span>
              ) : (
                <>
                  {u.role !== 'admin' ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleRoleChange(u.id, 'admin')}>
                      {t('admin.makeAdmin')}
                    </button>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleRoleChange(u.id, 'user')}>
                      {t('admin.revokeAdmin')}
                    </button>
                  )}
                  {u.banned ? (
                    <button className="btn-text-sm success" onClick={() => handleToggleBan(u.id, true)}>
                      {t('admin.unbanUser')}
                    </button>
                  ) : (
                    <button className="btn-text-sm danger" onClick={() => handleToggleBan(u.id, false)}>
                      {t('admin.banUser')}
                    </button>
                  )}
                </>
              )}
            </div>
            {u.id !== 1 && (
              <div className="user-permissions">
                {editingPermissions === u.id ? (
                  <div className="permission-editor">
                    {['contest_admin', 'problem_admin', 'list_admin', 'ticket_admin', 'upload_admin'].map(perm => (
                      <label key={perm} className="permission-checkbox">
                        <input
                          type="checkbox"
                          checked={userPermissions.includes(perm)}
                          onChange={() => togglePermission(perm)}
                        />
                        <span className="perm-label">{perm.replace('_admin', '')}</span>
                      </label>
                    ))}
                    <button className="btn btn-primary btn-xs" onClick={() => handleSavePermissions(u.id)}>
                      {t('admin.save')}
                    </button>
                    <button className="btn btn-secondary btn-xs" onClick={() => setEditingPermissions(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="permission-tags">
                    {(() => {
                      try {
                        const perms = u.permissions ? JSON.parse(u.permissions) : [];
                        return perms.length > 0 ? perms.map((perm: string) => (
                          <span key={perm} className="perm-tag">{perm.replace('_admin', '')}</span>
                        )) : (
                          <span style={{fontSize:'12px',color:'var(--text-muted)'}}>{u.role === 'admin' ? t('admin.allPermissions') : t('admin.noPermissions')}</span>
                        );
                      } catch {
                        return <span style={{fontSize:'12px',color:'var(--text-muted)'}}>{u.role === 'admin' ? t('admin.allPermissions') : t('admin.noPermissions')}</span>;
                      }
                    })()}
                    <button className="btn btn-secondary btn-xs" onClick={() => {
                      try {
                        handleEditPermissions(u.id, u.permissions ? JSON.parse(u.permissions) : []);
                      } catch {
                        handleEditPermissions(u.id, []);
                      }
                    }}>
                      {t('admin.editPermissions')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {userPagination && userPagination.totalPages > 1 && (
        <div className="pm-pagination">
          <button
            className="btn btn-secondary btn-sm"
            disabled={userPage <= 1}
            onClick={() => setUserPage(userPage - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="pm-page-info">
            {t('common.page').replace('{0}', String(userPagination.page)).replace('{1}', String(userPagination.totalPages))}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={userPage >= userPagination.totalPages}
            onClick={() => setUserPage(userPage + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
