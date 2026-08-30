-- 评测详细结果（每个测试点）
CREATE TABLE IF NOT EXISTS submission_testcases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  testcase_id   INTEGER,
  status        TEXT NOT NULL,
  time_used     INTEGER DEFAULT 0,
  memory_used   INTEGER DEFAULT 0,
  score         INTEGER DEFAULT 0,
  detail        TEXT DEFAULT '',
  sort_order    INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_submission_testcases_submission ON submission_testcases(submission_id);

-- 评测日志
CREATE TABLE IF NOT EXISTS judge_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  log_type      TEXT NOT NULL,
  message       TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_judge_logs_submission ON judge_logs(submission_id);
