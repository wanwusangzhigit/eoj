-- Migration 0042: Team contest announcements & clarifications
-- (团队比赛赛时公告 / 私密答疑,与全局比赛 contest_announcements / contest_clarifications 平行)

-- === 1. team_contest_announcements (团队比赛赛时公告) ===
CREATE TABLE IF NOT EXISTS team_contest_announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_contest_id INTEGER NOT NULL REFERENCES team_contests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_pinned   INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_team_contest_announcements_contest ON team_contest_announcements(team_contest_id);

-- === 2. team_contest_clarifications (团队比赛赛时私密答疑) ===
CREATE TABLE IF NOT EXISTS team_contest_clarifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_contest_id INTEGER NOT NULL REFERENCES team_contests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  question    TEXT NOT NULL,
  answer      TEXT,
  answered_by INTEGER REFERENCES users(id),
  status      TEXT DEFAULT 'pending',  -- pending, answered
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  answered_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_team_contest_clarifications_contest ON team_contest_clarifications(team_contest_id);
CREATE INDEX IF NOT EXISTS idx_team_contest_clarifications_user ON team_contest_clarifications(user_id);
