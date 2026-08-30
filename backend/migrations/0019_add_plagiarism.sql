-- Phase 1.5: 代码查重系统

CREATE TABLE IF NOT EXISTS plagiarism_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id    INTEGER REFERENCES contests(id) ON DELETE CASCADE,
  submission_a  INTEGER NOT NULL REFERENCES submissions(id),
  submission_b  INTEGER NOT NULL REFERENCES submissions(id),
  similarity    REAL NOT NULL,
  method        TEXT DEFAULT 'winnowing',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plagiarism_contest ON plagiarism_reports(contest_id);
CREATE INDEX IF NOT EXISTS idx_plagiarism_submissions ON plagiarism_reports(submission_a, submission_b);
