-- Phase 1.1: 题目难度评级
ALTER TABLE problems ADD COLUMN rating INTEGER DEFAULT 0;
-- rating 范围: 0=未评分, 800-3500 已评分
-- 对应颜色: 800-1199 红, 1200-1599 橙, 1600-1999 黄, 2000-2399 绿, 2400-2799 蓝, 2800-3199 紫, 3200+ 黑

-- 用户 Rating 表
CREATE TABLE IF NOT EXISTS user_ratings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating        INTEGER DEFAULT 0,
  max_rating    INTEGER DEFAULT 0,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_ratings_user ON user_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ratings_rating ON user_ratings(rating DESC);

-- Phase 1.2: 标签分类体系
CREATE TABLE IF NOT EXISTS tag_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  icon          TEXT DEFAULT '',
  sort_order    INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER REFERENCES tag_categories(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  sort_order    INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS problem_tags (
  problem_id    INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(problem_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_problem_tags_tag ON problem_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_problem_tags_problem ON problem_tags(problem_id);
CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);
CREATE INDEX IF NOT EXISTS idx_tag_categories_slug ON tag_categories(slug);

-- 预置标签分类
INSERT INTO tag_categories (name, slug, sort_order) VALUES
  ('动态规划', 'dp', 1),
  ('图论', 'graph', 2),
  ('数学', 'math', 3),
  ('数据结构', 'data-structure', 4),
  ('搜索', 'search', 5),
  ('字符串', 'string', 6),
  ('贪心', 'greedy', 7),
  ('分治', 'divide-conquer', 8),
  ('模拟', 'simulation', 9),
  ('计算几何', 'geometry', 10);

-- 预置二级标签
INSERT INTO tags (category_id, name, slug) VALUES
  (1, '背包', 'knapsack'),
  (1, '区间DP', 'interval-dp'),
  (1, '树形DP', 'tree-dp'),
  (1, '状压DP', 'bitmask-dp'),
  (1, '数位DP', 'digit-dp'),
  (1, 'DP优化', 'dp-optimization'),
  (2, '最短路', 'shortest-path'),
  (2, '最小生成树', 'mst'),
  (2, '拓扑排序', 'topological-sort'),
  (2, '二分图', 'bipartite'),
  (2, '网络流', 'network-flow'),
  (3, '数论', 'number-theory'),
  (3, '组合数学', 'combinatorics'),
  (3, '概率期望', 'probability'),
  (3, '线性代数', 'linear-algebra'),
  (4, '线段树', 'segment-tree'),
  (4, '树状数组', 'fenwick'),
  (4, '并查集', 'dsu'),
  (4, '堆', 'heap'),
  (4, 'ST表', 'sparse-table'),
  (5, 'DFS', 'dfs'),
  (5, 'BFS', 'bfs'),
  (5, '双向搜索', 'bidirectional'),
  (5, 'A*', 'a-star'),
  (6, 'KMP', 'kmp'),
  (6, 'Trie', 'trie'),
  (6, 'AC自动机', 'ac-automaton'),
  (6, '后缀数组', 'suffix-array'),
  (6, '哈希', 'string-hash'),
  (7, '区间贪心', 'interval-greedy'),
  (7, '哈夫曼', 'huffman'),
  (8, '归并排序', 'merge-sort'),
  (8, '快速幂', 'fast-power'),
  (9, '高精度', 'big-integer'),
  (9, '日期', 'date'),
  (10, '凸包', 'convex-hull'),
  (10, '线段交', 'line-intersection');
