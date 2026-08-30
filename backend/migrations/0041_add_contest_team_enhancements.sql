-- Migration 0041: Contest system (OI/ICPC/IOI) + Team enhancements
-- (team-private problems, groups, member notes, sub-permissions,
--  contest announcements, private clarifications, team contest submissions)

-- === 1. contests: publicity type (official / team) ===
ALTER TABLE contests ADD COLUMN contest_type TEXT DEFAULT 'official';

-- === 2. scoring_type: migrate legacy 'acm' -> 'icpc' ===
UPDATE contests SET scoring_type = 'icpc' WHERE scoring_type = 'acm';
UPDATE team_contests SET scoring_type = 'icpc' WHERE scoring_type = 'acm';

-- === 3. team_members: note + sub-permissions + group assignment ===
ALTER TABLE team_members ADD COLUMN note TEXT DEFAULT '';
ALTER TABLE team_members ADD COLUMN can_edit_problems INTEGER DEFAULT 0;
ALTER TABLE team_members ADD COLUMN can_edit_contests INTEGER DEFAULT 0;
ALTER TABLE team_members ADD COLUMN can_edit_lists INTEGER DEFAULT 0;
ALTER TABLE team_members ADD COLUMN group_id INTEGER;

-- === 4. team_groups (分组管理, e.g. by grade) ===
CREATE TABLE IF NOT EXISTS team_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_team_groups_team ON team_groups(team_id);

-- === 5. team_problems (team-private problems) ===
CREATE TABLE IF NOT EXISTS team_problems (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  added_by    INTEGER NOT NULL REFERENCES users(id),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, problem_id)
);
CREATE INDEX IF NOT EXISTS idx_team_problems_team ON team_problems(team_id);
CREATE INDEX IF NOT EXISTS idx_team_problems_problem ON team_problems(problem_id);

-- === 6. contest_announcements (赛时公告) ===
CREATE TABLE IF NOT EXISTS contest_announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id  INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_pinned   INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contest_announcements_contest ON contest_announcements(contest_id);

-- === 7. contest_clarifications (赛时私密答疑: 选手提问 -> 主办方回答) ===
CREATE TABLE IF NOT EXISTS contest_clarifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id  INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  question    TEXT NOT NULL,
  answer      TEXT,
  answered_by INTEGER REFERENCES users(id),
  status      TEXT DEFAULT 'pending',  -- pending, answered
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  answered_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_contest_clarifications_contest ON contest_clarifications(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_clarifications_user ON contest_clarifications(user_id);

-- === 8. submissions: team contest attribution ===
ALTER TABLE submissions ADD COLUMN team_contest_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_submissions_team_contest ON submissions(team_contest_id);
