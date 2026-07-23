-- Migration 0033: Add code templates for users

CREATE TABLE IF NOT EXISTS code_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language   TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  name       TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, language, name)
);

CREATE INDEX IF NOT EXISTS idx_code_templates_user ON code_templates(user_id);