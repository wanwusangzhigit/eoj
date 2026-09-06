-- OAuth one-time exchange codes
-- 替代把 JWT 直接放入 redirect fragment 的旧流程:
--   1) OAuth 成功后,后端生成一次性随机 code 并将 JWT 存入此表(TTL 短)
--   2) 重定向到前端 /auth/callback?code=<随机串> (URL 内不再含 JWT)
--   3) 前端调用 POST /api/v1/auth/exchange { code } 取出 JWT,出站即删
-- 这避免 JWT 通过 Referer / 浏览器历史 / 共享设备泄漏。
CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
  code         TEXT PRIMARY KEY,
  jwt          TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0
);

-- 加速清理过期项
CREATE INDEX IF NOT EXISTS idx_oauth_exchange_expires ON oauth_exchange_codes(expires_at);
