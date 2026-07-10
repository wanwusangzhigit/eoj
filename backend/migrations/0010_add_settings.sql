CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT (datetime('now'));
