-- Phase 1.3: 训练计划系统

-- 训练计划
CREATE TABLE IF NOT EXISTS training_plans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  cover_image   TEXT DEFAULT '',
  category      TEXT DEFAULT 'algorithm',  -- algorithm, math, data-structure, etc.
  difficulty    TEXT DEFAULT 'beginner',   -- beginner, intermediate, advanced
  user_id       INTEGER NOT NULL REFERENCES users(id),
  is_official   INTEGER DEFAULT 0,
  sort_order    INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_training_plans_category ON training_plans(category);
CREATE INDEX IF NOT EXISTS idx_training_plans_difficulty ON training_plans(difficulty);
CREATE INDEX IF NOT EXISTS idx_training_plans_official ON training_plans(is_official, sort_order);

-- 训练计划章节
CREATE TABLE IF NOT EXISTS training_chapters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id       INTEGER NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  sort_order    INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_training_chapters_plan ON training_chapters(plan_id);

-- 章节题目
CREATE TABLE IF NOT EXISTS training_chapter_problems (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id    INTEGER NOT NULL REFERENCES training_chapters(id) ON DELETE CASCADE,
  problem_id    INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  sort_order    INTEGER DEFAULT 0,
  note          TEXT DEFAULT '',
  UNIQUE(chapter_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_training_chapter_problems_chapter ON training_chapter_problems(chapter_id);
CREATE INDEX IF NOT EXISTS idx_training_chapter_problems_problem ON training_chapter_problems(problem_id);

-- 用户训练进度
CREATE TABLE IF NOT EXISTS training_progress (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id       INTEGER NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  completed     INTEGER DEFAULT 0,
  total         INTEGER DEFAULT 0,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_training_progress_user ON training_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_training_progress_plan ON training_progress(plan_id);

-- 预置官方训练计划：算法入门
INSERT INTO training_plans (title, description, category, difficulty, user_id, is_official, sort_order)
SELECT
  '算法入门训练',
  '从基础的循环结构到经典算法，系统化提升算法能力。每个章节循序渐进，适合刚入门的选手。',
  'algorithm',
  'beginner',
  u.id,
  1,
  1
FROM users u
WHERE u.id = (SELECT id FROM users ORDER BY id LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM training_plans
    WHERE title = '算法入门训练'
      AND is_official = 1
  );

INSERT INTO training_chapters (plan_id, title, description, sort_order)
SELECT tp.id, '第 1 章：基础输入输出', '熟悉变量、循环与基本输入输出操作。', 1
FROM training_plans tp
WHERE tp.title = '算法入门训练'
  AND tp.is_official = 1
  AND NOT EXISTS (
    SELECT 1 FROM training_chapters
    WHERE plan_id = tp.id
      AND title = '第 1 章：基础输入输出'
  );

INSERT INTO training_chapters (plan_id, title, description, sort_order)
SELECT tp.id, '第 2 章：枚举与贪心', '掌握简单枚举与贪心思想。', 2
FROM training_plans tp
WHERE tp.title = '算法入门训练'
  AND tp.is_official = 1
  AND NOT EXISTS (
    SELECT 1 FROM training_chapters
    WHERE plan_id = tp.id
      AND title = '第 2 章：枚举与贪心'
  );

INSERT INTO training_chapters (plan_id, title, description, sort_order)
SELECT tp.id, '第 3 章：二分与排序', '掌握二分查找与排序算法。', 3
FROM training_plans tp
WHERE tp.title = '算法入门训练'
  AND tp.is_official = 1
  AND NOT EXISTS (
    SELECT 1 FROM training_chapters
    WHERE plan_id = tp.id
      AND title = '第 3 章：二分与排序'
  );
