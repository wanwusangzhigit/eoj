-- Migration 0005: Contests, Tickets, Problem Lists

-- Contests
CREATE TABLE IF NOT EXISTS contests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  start_time    DATETIME NOT NULL,
  end_time      DATETIME NOT NULL,
  status        TEXT DEFAULT 'upcoming', -- upcoming, running, ended
  is_public     INTEGER DEFAULT 1,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contest_problems (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id    INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  problem_id    INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  label         TEXT DEFAULT 'A', -- A, B, C, ...
  score         INTEGER DEFAULT 100,
  UNIQUE(contest_id, problem_id)
);

CREATE TABLE IF NOT EXISTS contest_participants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id    INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(contest_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status);
CREATE INDEX IF NOT EXISTS idx_contest_problems_contest ON contest_problems(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_participants_contest ON contest_participants(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_participants_user ON contest_participants(user_id);

-- Tickets (工单系统)
CREATE TABLE IF NOT EXISTS tickets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  category      TEXT DEFAULT 'question', -- bug, suggestion, question, other
  status        TEXT DEFAULT 'open', -- open, in_progress, resolved, closed
  priority      TEXT DEFAULT 'normal', -- low, normal, high, urgent
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id     INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  content       TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket ON ticket_replies(ticket_id);

-- Problem Lists (题单)
CREATE TABLE IF NOT EXISTS problem_lists (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  user_id       INTEGER NOT NULL REFERENCES users(id),
  is_public     INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS problem_list_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id       INTEGER NOT NULL REFERENCES problem_lists(id) ON DELETE CASCADE,
  problem_id    INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  sort_order    INTEGER DEFAULT 0,
  note          TEXT DEFAULT '',
  UNIQUE(list_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_problem_lists_user ON problem_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_problem_list_items_list ON problem_list_items(list_id);
