-- Phase 3: 团队功能完善（对标 Luogu）
-- 加入方式、公告、讨论区、题目集、竞赛

-- 1. 团队表增加 join_method 字段
ALTER TABLE teams ADD COLUMN join_method TEXT DEFAULT 'free';  -- free, approval, invite

-- 2. 加入申请
CREATE TABLE IF NOT EXISTS team_join_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT DEFAULT '',
  status      TEXT DEFAULT 'pending',  -- pending, approved, rejected
  handled_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_join_requests_team ON team_join_requests(team_id);
CREATE INDEX IF NOT EXISTS idx_team_join_requests_user ON team_join_requests(user_id);

-- 3. 团队公告
CREATE TABLE IF NOT EXISTS team_announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_pinned   INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_announcements_team ON team_announcements(team_id);

-- 4. 团队讨论区
CREATE TABLE IF NOT EXISTS team_discussions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  is_pinned     INTEGER DEFAULT 0,
  reply_count   INTEGER DEFAULT 0,
  view_count    INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_discussions_team ON team_discussions(team_id);

CREATE TABLE IF NOT EXISTS team_discussion_replies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id   INTEGER NOT NULL REFERENCES team_discussions(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_discussion_replies_disc ON team_discussion_replies(discussion_id);

-- 5. 团队题目集
CREATE TABLE IF NOT EXISTS team_problem_sets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_public   INTEGER DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_problem_sets_team ON team_problem_sets(team_id);

CREATE TABLE IF NOT EXISTS team_problem_set_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_set_id  INTEGER NOT NULL REFERENCES team_problem_sets(id) ON DELETE CASCADE,
  problem_id      INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  sort_order      INTEGER DEFAULT 0,
  note            TEXT DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(problem_set_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_team_problem_set_items_set ON team_problem_set_items(problem_set_id);

-- 6. 团队竞赛
CREATE TABLE IF NOT EXISTS team_contests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  start_time      DATETIME NOT NULL,
  end_time        DATETIME NOT NULL,
  scoring_type    TEXT DEFAULT 'acm',  -- acm, ioi
  is_public       INTEGER DEFAULT 0,  -- 0=team only, 1=visible to all
  status          TEXT DEFAULT 'pending',  -- pending, running, finished
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_contests_team ON team_contests(team_id);

CREATE TABLE IF NOT EXISTS team_contest_problems (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_contest_id INTEGER NOT NULL REFERENCES team_contests(id) ON DELETE CASCADE,
  problem_id      INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  sort_order      INTEGER DEFAULT 0,
  score           INTEGER DEFAULT 100,
  UNIQUE(team_contest_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_team_contest_problems_contest ON team_contest_problems(team_contest_id);

CREATE TABLE IF NOT EXISTS team_contest_participants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_contest_id INTEGER NOT NULL REFERENCES team_contests(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_contest_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_contest_participants_contest ON team_contest_participants(team_contest_id);