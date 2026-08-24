-- OAuth pending state / return_url
-- 解决跨域社交登录下 state 校对竞态(cookie 被并发点击覆盖导致 state_mismatch)。
-- 状态值(高熵随机)仍由 /github、/cpoauth 在发起时写入 DB;回调时以 state 查询
-- 绑定到 DB,取回 return_url 并删除(一次性)。state 本身就是 CSRF 秘密,必须由
-- 浏览器从授权服务商带回,DB 持久化不削弱其防伪性。
CREATE TABLE IF NOT EXISTS oauth_pending (
  state        TEXT PRIMARY KEY,
  oauth_type   TEXT NOT NULL,             -- 'github' | 'cpoauth'
  return_url   TEXT,                      -- 发起登录的 origin(可空)
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_pending_expires ON oauth_pending(expires_at);