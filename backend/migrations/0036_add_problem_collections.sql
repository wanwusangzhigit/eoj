-- Migration 0036: Add problem collections (folders for favorites)

CREATE TABLE IF NOT EXISTS problem_collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_public   INTEGER DEFAULT 0,
  sort_order  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_problem_collections_user ON problem_collections(user_id);

CREATE TABLE IF NOT EXISTS problem_collection_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES problem_collections(id) ON DELETE CASCADE,
  problem_id    INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  note          TEXT DEFAULT '',
  sort_order    INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(collection_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_pci_collection ON problem_collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_pci_problem ON problem_collection_items(problem_id);