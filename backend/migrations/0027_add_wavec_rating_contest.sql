-- Migration 0027: Wave C — Rating system + IOI/Virtual contest support
-- Fixes: ratings.ts already SELECTs from rating_changes but the table was never created.
-- Adds: rating_changes table, contests.scoring_type/is_rated/allow_virtual/duration_minutes,
--       contest_participants.is_virtual/virtual_start_time/final_rank/final_rating_delta,
--       submissions.contest_id (for accurate contest attribution + virtual tracking).

-- === 1. rating_changes table (referenced by ratings.ts but missing) ===
CREATE TABLE IF NOT EXISTS rating_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  contest_id INTEGER,
  old_rating INTEGER NOT NULL DEFAULT 0,
  new_rating INTEGER NOT NULL DEFAULT 0,
  delta INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_rating_changes_user ON rating_changes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rating_changes_contest ON rating_changes(contest_id);

-- === 2. contests table extensions ===
ALTER TABLE contests ADD COLUMN scoring_type TEXT NOT NULL DEFAULT 'acm';     -- 'acm' | 'ioi'
ALTER TABLE contests ADD COLUMN is_rated INTEGER NOT NULL DEFAULT 0;            -- 0 = unrated, 1 = rated
ALTER TABLE contests ADD COLUMN allow_virtual INTEGER NOT NULL DEFAULT 1;       -- 0 = disabled, 1 = enabled
ALTER TABLE contests ADD COLUMN duration_minutes INTEGER;                        -- virtual contest duration (null = use base contest duration)
ALTER TABLE contests ADD COLUMN base_contest_id INTEGER;                        -- if this is a virtual instance, the source contest id
ALTER TABLE contests ADD COLUMN rating_finalized INTEGER NOT NULL DEFAULT 0;     -- 0 = not finalized, 1 = rating computed

-- === 3. contest_participants extensions ===
ALTER TABLE contest_participants ADD COLUMN is_virtual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contest_participants ADD COLUMN virtual_start_time DATETIME;          -- virtual participant personal start time
ALTER TABLE contest_participants ADD COLUMN final_rank INTEGER;
ALTER TABLE contest_participants ADD COLUMN final_rating_delta INTEGER;

-- === 4. submissions.contest_id (allows virtual participants' submissions to be attributed correctly) ===
ALTER TABLE submissions ADD COLUMN contest_id INTEGER;
ALTER TABLE submissions ADD COLUMN virtual_participant_id INTEGER;                -- if submitted in virtual mode, the contest_participants row id
CREATE INDEX IF NOT EXISTS idx_submissions_contest ON submissions(contest_id);
CREATE INDEX IF NOT EXISTS idx_submissions_virtual ON submissions(virtual_participant_id);

-- === 5. recommended_problems cache table (for /problems/recommend, refreshed periodically) ===
CREATE TABLE IF NOT EXISTS recommended_problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  problem_id INTEGER NOT NULL,
  reason TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, problem_id)
);
CREATE INDEX IF NOT EXISTS idx_recommended_user ON recommended_problems(user_id, score DESC);
