-- Phase 2.7: 题目举报/纠错

CREATE TABLE IF NOT EXISTS problem_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id   INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL,    -- typo, wrong_answer, ambiguous, missing_data, other
  description  TEXT NOT NULL,
  status       TEXT DEFAULT 'open',  -- open, in_progress, resolved, closed
  admin_reply  TEXT DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_problem_reports_problem ON problem_reports(problem_id);
CREATE INDEX IF NOT EXISTS idx_problem_reports_status ON problem_reports(status, created_at DESC);
