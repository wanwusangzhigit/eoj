-- 按比赛粒度授权:把单场比赛的管理权授予指定用户,无需拥有全局 contest_admin。
--
-- 适用场景:多场比赛并行举办时,各比赛组织者独立管理自己的比赛,
-- 不必拥有跨比赛的全部管理权限。授权后用户可对该 contest_id 执行
-- 比赛 admin 范围内的所有操作(编辑比赛信息、发布公告、回复/修改 clarifications、
-- 查看报名/排名等),但无法克隆/删除/终评比赛——这些敏感操作仍要求全局 contest_admin。
--
-- 权限合并规则(见 backend/src/middleware/auth.ts):
--   isContestAdmin(user, contestId) =
--     user.userId === 1 (super admin) ||
--     user.role === 'admin' || 'super_admin' ||
--     user.permissions.includes('contest_admin') ||           -- 全局 contest admin
--     EXISTS(user_contest_admin WHERE user_id=user.userId AND contest_id=contestId)
--
-- 类似的"按资源粒度授权"未来可扩展为 problem/list/ticket,只需新增同形表即可,
-- 表名采用 user_<resource>_admin 命名约定,与现有 user_permission_groups 风格一致。

CREATE TABLE IF NOT EXISTS user_contest_admin (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, contest_id)
);

CREATE INDEX IF NOT EXISTS idx_uca_user ON user_contest_admin(user_id);
CREATE INDEX IF NOT EXISTS idx_uca_contest ON user_contest_admin(contest_id);
