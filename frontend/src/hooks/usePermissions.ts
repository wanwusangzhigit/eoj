import { useAuthStore } from '../store/auth';

const ALL_PERMISSIONS = ['contest_admin', 'problem_admin', 'list_admin', 'ticket_admin', 'upload_admin'] as const;
export type Permission = typeof ALL_PERMISSIONS[number];

export function usePermissions() {
  const { user } = useAuthStore();

  // 超管唯一判定:users.id === 1,与后端 superAdminMiddleware 严格对齐。
  // role='super_admin' 只是高权限管理员角色(仍拥有全部细粒度权限),
  // 早期前端把两者都当超管,导致这类用户能看到超管按钮/菜单却处处 403。
  const isSuperAdmin = user?.id === 1;
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  // Full admin or super admin has all permissions
  const hasAllPermissions = isAdmin || isSuperAdmin;

  function hasPermission(permission: Permission): boolean {
    if (isSuperAdmin || isAdmin) return true;
    return (user?.permissions || []).includes(permission);
  }

  return {
    isSuperAdmin,
    isAdmin,
    hasAllPermissions,
    hasPermission,
    canManageContests: hasPermission('contest_admin'),
    canManageProblems: hasPermission('problem_admin'),
    canManageLists: hasPermission('list_admin'),
    canManageTickets: hasPermission('ticket_admin'),
    canManageUploads: hasPermission('upload_admin'),
    allPermissions: ALL_PERMISSIONS,
  };
}
