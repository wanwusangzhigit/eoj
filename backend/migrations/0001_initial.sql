-- Migration 0001: Initial schema

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id     INTEGER UNIQUE,
  username      TEXT NOT NULL,
  avatar_url    TEXT,
  role          TEXT DEFAULT 'user',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS problems (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  description   TEXT NOT NULL,
  input_format  TEXT,
  output_format TEXT,
  sample_input  TEXT,
  sample_output TEXT,
  time_limit    INTEGER DEFAULT 1000,
  memory_limit  INTEGER DEFAULT 256,
  tags          TEXT DEFAULT '[]',
  difficulty    TEXT DEFAULT 'Easy', -- 'Easy', 'Medium', 'Hard'
  is_public     INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS testcases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id    INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  input         TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  is_sample     INTEGER DEFAULT 0,
  score         INTEGER DEFAULT 10
);

CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  problem_id    INTEGER NOT NULL REFERENCES problems(id),
  language      TEXT NOT NULL,
  source_code   TEXT NOT NULL,
  status        TEXT DEFAULT 'pending',
  score         INTEGER DEFAULT 0,
  time_used     INTEGER,
  memory_used   INTEGER,
  details       TEXT,
  github_sha    TEXT,
  github_run_id TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_problems_slug ON problems(slug);
CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_testcases_problem ON testcases(problem_id);
