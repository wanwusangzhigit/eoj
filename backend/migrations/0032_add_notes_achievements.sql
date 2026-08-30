-- Migration 0032: Add problem notes, achievements, and global search index

-- 1. 题目笔记
CREATE TABLE IF NOT EXISTS problem_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  is_public  INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_problem_notes_user ON problem_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_problem_notes_problem ON problem_notes(problem_id);

-- 2. 用户成就
CREATE TABLE IF NOT EXISTS user_achievements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  achieved_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);

-- 3. 用户等级/经验值
ALTER TABLE users ADD COLUMN experience INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN level    INTEGER DEFAULT 1;