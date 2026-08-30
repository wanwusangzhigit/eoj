-- Migration 0045: 公告中心(site_announcements)
-- 独立于首页单条 announcement 设置的全站公告列表,支持置顶/发布状态
CREATE TABLE IF NOT EXISTS site_announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  is_pinned  INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'published',  -- published / draft
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_site_announcements_status_created
  ON site_announcements(status, created_at DESC);
