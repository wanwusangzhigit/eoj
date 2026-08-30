-- Migration 0037: Add email verification codes for registration

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  used       INTEGER DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evc_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_evc_email_code ON email_verification_codes(email, code);
