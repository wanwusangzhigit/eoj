-- Migration 0029: Add captcha_codes table for image verification

CREATE TABLE IF NOT EXISTS captcha_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT UNIQUE NOT NULL,
  answer     TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used       INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_captcha_uuid ON captcha_codes(uuid);
CREATE INDEX IF NOT EXISTS idx_captcha_expires ON captcha_codes(expires_at);