-- Migration 0047: 代码分享短链(code_shares)
-- 提交代码生成只读分享链接,支持过期时间
CREATE TABLE IF NOT EXISTS code_shares (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT NOT NULL UNIQUE,            -- 短链随机 token(不可猜测)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,                   -- 分享的代码内容(独立存储,提交删除后仍可查看)
  language    TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT 'Code Share',
  expires_at  TEXT,                            -- NULL = 永不过期
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_code_shares_token ON code_shares(token);
CREATE INDEX IF NOT EXISTS idx_code_shares_user ON code_shares(user_id);
