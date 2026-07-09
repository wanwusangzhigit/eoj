-- Migration 0009: Add CP OAuth support
ALTER TABLE users ADD COLUMN cpoauth_id TEXT;

DELETE FROM users
WHERE rowid NOT IN (
    SELECT MIN(rowid) FROM users GROUP BY cpoauth_id
);

CREATE UNIQUE INDEX idx_users_cpoauth_id ON users(cpoauth_id);