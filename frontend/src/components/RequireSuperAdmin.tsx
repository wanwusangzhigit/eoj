import type { ReactNode } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import type { Permission } from '../hooks/usePermissions';
import { t } from '../i18n';

/**
 * 访问被拒绝时的兜底页面(与 AdminLayout 入口拦截保持一致的视觉)
 */
function AccessDenied() {
  return (
    <div className="empty-page">
      <h2>{t('admin.accessDenied')}</h2>
    </div>
  );
}

/**
 * 超级管理员守卫:仅允许 user.id === 1 或 role === 'super_admin' 通过。
 * 用于 SQL 编辑器等高危功能。
 *
 * 注意:此处不调用任何 hook 之外的副作用,内部仅依赖 usePermissions,
 * 把 children 在条件外渲染,符合 React Hooks 规则。
 */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const perms = usePermissions();
  if (!perms.isSuperAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * 通用权限守卫:满足以下任一条件即可访问:
 *  - 当前用户是超级管理员(userId===1 或 role==='super_admin')
 *  - 当前用户是管理员角色(role==='admin' 或 'super_admin'),等价于原 hasAllPermissions
 *  - 拥有 requirePermissions 中的任一具体权限(如 'contest_admin')
 *
 * 设计动机:管理后台的菜单虽已按权限过滤,但直接通过 URL 访问
 * 仍能进入页面并看到接口报错或空内容。路由层守卫作为第二道防线,
 * 与菜单过滤保持一致的判定逻辑,避免无权限用户看到任何管理内容。
 *
 * @param requirePermissions 任一具体权限即可放行;空数组表示仅 admin/super_admin 可访问
 */
export function RequirePermission({
  children,
  requirePermissions = [],
}: {
  children: ReactNode;
  requirePermissions?: Permission[];
}) {
  const perms = usePermissions();
  // admin / super_admin 角色直接放行
  if (perms.hasAllPermissions) return <>{children}</>;
  // 否则必须命中至少一个具体权限
  if (requirePermissions.length > 0 && requirePermissions.some((p) => perms.hasPermission(p))) {
    return <>{children}</>;
  }
  return <AccessDenied />;
}
