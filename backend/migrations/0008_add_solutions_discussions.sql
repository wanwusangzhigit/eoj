-- Migration 0008: Solutions and Discussions

-- Solutions (题解)
CREATE TABLE IF NOT EXISTS solutions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id    INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  language      TEXT DEFAULT '',
  vote_count    INTEGER DEFAULT 0,
  view_count    INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS solution_votes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  solution_id   INTEGER NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  UNIQUE(solution_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_solutions_problem ON solutions(problem_id);
CREATE INDEX IF NOT EXISTS idx_solutions_user ON solutions(user_id);
CREATE INDEX IF NOT EXISTS idx_solution_votes_solution ON solution_votes(solution_id);

-- Discussions (讨论区)
CREATE TABLE IF NOT EXISTS discussions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id    INTEGER REFERENCES problems(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  category      TEXT DEFAULT 'question', -- question, share, general
  reply_count   INTEGER DEFAULT 0,
  view_count    INTEGER DEFAULT 0,
  is_pinned     INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discussion_replies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  content       TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discussions_problem ON discussions(problem_id);
CREATE INDEX IF NOT EXISTS idx_discussions_user ON discussions(user_id);
CREATE INDEX IF NOT EXISTS idx_discussion_replies_discussion ON discussion_replies(discussion_id);
