import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { usePermissions } from '../../hooks/usePermissions';
import { useSSRPage } from '../../ssr/useSSRPage';
import { t } from '../../i18n';
import {
  Search, Shield, User, ChevronLeft, ChevronRight, CheckSquare, Square, ShieldCheck, Users as UsersIcon,
} from 'lucide-react';
import '../Admin.css';

export default function AdminUsers() {
  useDocumentTitle(t('admin.userManagement'));
  const addToast = useToastStore((s) => s.addToast);
  // 与后端权限对齐:编辑权限是 super admin 专属接口(superAdminMiddleware),
  // 普通 admin 不应看到入口,避免点击后看到 403 困惑
  const perms = usePermissions();
  const ssr = useSSRPage<{ users?: { users?: any[]; pagination?: any } }>('adminUsers');
  const firstRunRef = useRef(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const [userList, setUserList] = useState<any[]>(ssr?.users?.users ?? []);
  const [userSearch, setUserSearch] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [userPage, setUserPage] = useState(1);
  const [userPagination, setUserPagination] = useState<any>(ssr?.users?.pagination ?? null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [editingPermissions, setEditingPermissions] = useState<number | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);

  // ── 权限组分配(super admin) ──
  const [allGroups, setAllGroups] = useState<any[]>([]);
  const [userGroups, setUserGroups] = useState<Record<number, any[]>>({});
  const [editingGroupsFor, setEditingGroupsFor] = useState<number | null>(null);
  const [draftGroupIds, setDraftGroupIds] = useState<number[]>([]);

  const fetchUserList = useCallback(async () => {
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
  }, [userPage, debouncedUserSearch]);

  useEffect(() => {
    // SSR 已注入则跳过首次拉取
    if (ssr?.users && firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    firstRunRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUserList();
  }, [fetchUserList, refreshKey, ssr]);

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

  const handleRoleChange = async (userId: number, newRole: string) => {
    try {
      await api.updateUserRole(userId, newRole);
      addToast('success', t('admin.roleUpdated'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
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
      addToast('success', t('admin.permissionsUpdated'));
      refresh();
    } catch (e: any) {
      console.error('Failed to update permissions:', e);
      addToast('error', e.message || t('common.error'));
    }
  };

  const togglePermission = (perm: string) => {
    setUserPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  // ── 权限组:加载组列表 + 每个用户的组 ──
  const fetchGroupsAndMembership = useCallback(async () => {
    if (!perms.isSuperAdmin) return;
    try {
      const groupsData = await api.getPermissionGroups();
      setAllGroups(groupsData.groups);
      // 并发拉取当前页每个用户的组(数量可控:pageSize<=20)
      const entries = await Promise.all(
        userList.map(async (u: any) => {
          try {
            const r = await api.getUserGroups(u.id);
            return [u.id, r.groups] as const;
          } catch {
            return [u.id, [] as any[]] as const;
          }
        })
      );
      setUserGroups(Object.fromEntries(entries));
    } catch (e) {
      console.error('Failed to load permission groups:', e);
    }
  }, [perms.isSuperAdmin, userList]);

  useEffect(() => {
    // 首屏由 SSR 注入,但仍需补全组信息
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard mount-time fetch
    fetchGroupsAndMembership();
  }, [fetchGroupsAndMembership]);

  const startEditGroups = async (userId: number) => {
    setEditingGroupsFor(userId);
    const current = userGroups[userId]?.map((g) => g.id) ?? [];
    setDraftGroupIds(current);
    if (allGroups.length === 0) {
      try {
        const data = await api.getPermissionGroups();
        setAllGroups(data.groups);
      } catch { /* ignore */ }
    }
  };

  const toggleDraftGroup = (gid: number) => {
    setDraftGroupIds((prev) => prev.includes(gid) ? prev.filter((x) => x !== gid) : [...prev, gid]);
  };

  const saveGroups = async (userId: number) => {
    try {
      await api.updateUserGroups(userId, draftGroupIds);
      addToast('success', t('permissionGroups.userGroupsUpdated'));
      setEditingGroupsFor(null);
      const r = await api.getUserGroups(userId);
      setUserGroups((prev) => ({ ...prev, [userId]: r.groups }));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleToggleBan = async (userId: number, currentlyBanned: boolean) => {
    try {
      await api.setUserBanned(userId, !currentlyBanned);
      addToast('success', t('common.success'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  // ── Batch operations ──
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectable = userList.filter((u: any) => u.id !== 1 && u.role !== 'super_admin');
    if (selectedIds.size === selectable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map((u: any) => u.id)));
    }
  };

  const batchBan = async (ban: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { addToast('error', t('admin.selectUsersFirst')); return; }
    let done = 0;
    for (const id of ids) {
      try {
        await api.setUserBanned(id, ban);
        done++;
      } catch { /* skip failed */ }
    }
    addToast('success', t(ban ? 'admin.batchBanDone' : 'admin.batchUnbanDone').replace('{done}', String(done)).replace('{total}', String(ids.length)));
    setSelectedIds(new Set());
    refresh();
  };

  const batchSetRole = async (role: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { addToast('error', t('admin.selectUsersFirst')); return; }
    let done = 0;
    for (const id of ids) {
      try {
        await api.updateUserRole(id, role);
        done++;
      } catch { /* skip failed */ }
    }
    addToast('success', t('admin.batchSetRoleDone').replace('{done}', String(done)).replace('{total}', String(ids.length)).replace('{role}', role));
    setSelectedIds(new Set());
    refresh();
  };

  return (
    <div className="admin-form">
      <div className="admin-page-header">
        <div className="admin-page-header-left">
          <h1 className="admin-page-title">
            <UsersIcon size={22} />
            {t('admin.userManagement')}
          </h1>
          <span className="admin-page-subtitle">
            {t('admin.usersSubtitle')}
          </span>
        </div>
      </div>
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

      {userList.length > 0 && (
        <div className="batch-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={toggleSelectAll} title="全选/取消">
            {selectedIds.size === userList.filter((u: any) => u.id !== 1 && u.role !== 'super_admin').length ? <CheckSquare size={16} /> : <Square size={16} />}
            {selectedIds.size > 0 ? `已选 ${selectedIds.size}` : '全选'}
          </button>
          {selectedIds.size > 0 && (
            <>
              <button className="btn btn-danger btn-sm" onClick={() => batchBan(true)}>
                批量封禁
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => batchBan(false)}>
                批量解封
              </button>
              <select
                className="form-input"
                style={{ width: 140, height: 32, fontSize: 13 }}
                onChange={(e) => { if (e.target.value) batchSetRole(e.target.value); }}
                defaultValue=""
              >
                <option value="">设为角色...</option>
                <option value="admin">管理员</option>
                <option value="user">普通用户</option>
              </select>
            </>
          )}
        </div>
      )}

      <div className="user-list">
        {userList.map((u) => (
          <div key={u.id} className={`user-item${u.banned ? ' user-banned' : ''}`}>
            <div className="user-checkbox" onClick={() => (u.id !== 1 && u.role !== 'super_admin') && toggleSelect(u.id)} style={{ cursor: (u.id !== 1 && u.role !== 'super_admin') ? 'pointer' : 'default', display: 'flex', alignItems: 'center', paddingRight: 8 }}>
              {(u.id === 1 || u.role === 'super_admin') ? null : selectedIds.has(u.id) ? <CheckSquare size={16} /> : <Square size={16} />}
            </div>
            <div className="user-info">
              <span className="user-name">
                {u.username}
                {!!u.banned && <span className="user-banned-badge">{t('admin.banned')}</span>}
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
              {u.id === 1 || u.role === 'super_admin' ? (
                // 超级管理员(id=1 或 role='super_admin'):不显示任何"设为/撤销/封禁"按钮。
                // 与后端校验对齐:H5 已禁止普通 admin 修改 super_admin 角色或 ban 超级管理员。
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
            {u.id !== 1 && u.role !== 'super_admin' && perms.isSuperAdmin && (
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
                        const uPerms = u.permissions ? JSON.parse(u.permissions) : [];
                        return uPerms.length > 0 ? uPerms.map((perm: string) => (
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
            {/* 权限组(super admin 才能分配;超级管理员 id=1 不需要分配) */}
            {u.id !== 1 && perms.isSuperAdmin && (
              <div className="user-permissions" style={{ borderTop: '1px dashed var(--border)', marginTop: 8, paddingTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                  <ShieldCheck size={12} /> {t('permissionGroups.nav')}
                </div>
                {editingGroupsFor === u.id ? (
                  <div className="permission-editor" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                    {allGroups.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('permissionGroups.loading')}</span>}
                    {allGroups.map((g) => (
                      <label key={g.id} className="permission-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={draftGroupIds.includes(g.id)}
                          onChange={() => toggleDraftGroup(g.id)}
                        />
                        <span className="perm-label" style={{ color: g.color || undefined }}>{g.name}</span>
                      </label>
                    ))}
                    <button className="btn btn-primary btn-xs" onClick={() => saveGroups(u.id)}>{t('admin.save')}</button>
                    <button className="btn btn-secondary btn-xs" onClick={() => setEditingGroupsFor(null)}>{t('common.cancel')}</button>
                  </div>
                ) : (
                  <div className="permission-tags">
                    {(userGroups[u.id] || []).length > 0
                      ? userGroups[u.id].map((g) => (
                        <span key={g.id} className="perm-tag" style={{ color: g.color || undefined }}>
                          {g.name}
                        </span>
                      ))
                      : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('permissionGroups.notAssigned')}</span>
                    }
                    <button className="btn btn-secondary btn-xs" onClick={() => startEditGroups(u.id)}>{t('permissionGroups.assign')}</button>
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
