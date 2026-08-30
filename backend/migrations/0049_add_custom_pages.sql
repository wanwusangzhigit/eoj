-- Migration 0049: 自定义静态页面(custom_pages)
CREATE TABLE IF NOT EXISTS custom_pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,           -- 页面标识,如 about / help / friends
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',       -- Markdown 内容
  show_in_footer INTEGER NOT NULL DEFAULT 0,  -- 是否显示在页脚导航
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_custom_pages_slug ON custom_pages(slug);
