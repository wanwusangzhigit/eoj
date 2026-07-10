-- Migration 0015: Add audit logs and ban management tables

-- Audit logs table: records all significant API operations
CREATE TABLE IF NOT EXISTS audit_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username          TEXT,
  ip                TEXT NOT NULL,
  device_fingerprint TEXT,
  page              TEXT,
  action            TEXT NOT NULL,
  method            TEXT NOT NULL,
  path              TEXT NOT NULL,
  user_agent        TEXT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip ON audit_logs(ip);
CREATE INDEX IF NOT EXISTS idx_audit_logs_device_fingerprint ON audit_logs(device_fingerprint);

-- Banned IPs table
CREATE TABLE IF NOT EXISTS banned_ips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ip          TEXT UNIQUE NOT NULL,
  reason      TEXT DEFAULT '',
  banned_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_banned_ips_ip ON banned_ips(ip);

-- Banned devices table
CREATE TABLE IF NOT EXISTS banned_devices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  device_fingerprint TEXT UNIQUE NOT NULL,
  reason            TEXT DEFAULT '',
  banned_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_banned_devices_device_fingerprint ON banned_devices(device_fingerprint);
