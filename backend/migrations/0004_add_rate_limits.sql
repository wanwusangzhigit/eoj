CREATE TABLE IF NOT EXISTS rate_limits (
  key         TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_created ON rate_limits(created_at);
