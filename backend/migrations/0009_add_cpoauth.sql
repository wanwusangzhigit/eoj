-- Migration 0009: Add CP OAuth support
ALTER TABLE users ADD COLUMN cpoauth_id TEXT;

-- Only deduplicate non-null cpoauth_id values to avoid deleting valid users
DELETE FROM users
WHERE cpoauth_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM users
    WHERE cpoauth_id IS NOT NULL
    GROUP BY cpoauth_id
  );

CREATE UNIQUE INDEX idx_users_cpoauth_id ON users(cpoauth_id);