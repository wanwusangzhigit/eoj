-- 审计 #H-17: 引入 token_invalid_before 字段实现 JWT 服务端吊销。
--
-- 背景：JWT 是无状态的，旧实现中即使用户修改密码 / 重置密码 / 登出，
-- 已签发的 token 仍在其 7 天有效期内可被使用。攻击者拿到 token 后，
-- 受害者即使改密也无法把攻击者踢下线。
--
-- 方案：在 users 表加 token_invalid_before 列，记录 Unix 时间戳（秒）。
--   - 登录时 signJWT 自动写入 iat（issued at）到 payload
--   - authMiddleware / optionalAuthMiddleware 在校验时同时读取
--     token_invalid_before，若 token.iat < token_invalid_before 则拒绝
--   - 修改密码 / 重置密码 / 显式登出时，把 token_invalid_before 设为当前时间
--
-- 兼容性：默认 0，意味着所有已签发 token 都被认为有效（向后兼容）。
-- 仅在用户触发敏感操作时才会更新此值。

ALTER TABLE users ADD COLUMN token_invalid_before INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_token_invalid_before ON users(token_invalid_before);
