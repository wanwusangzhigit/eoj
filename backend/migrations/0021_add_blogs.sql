-- Phase 2.2: 博客系统

CREATE TABLE IF NOT EXISTS blogs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT DEFAULT '',
  status      TEXT DEFAULT 'published',  -- draft, published
  view_count  INTEGER DEFAULT 0,
  like_count  INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blogs_user ON blogs(user_id);
CREATE INDEX IF NOT EXISTS idx_blogs_status ON blogs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_likes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id   INTEGER NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(blog_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_blog_likes_blog ON blog_likes(blog_id);
CREATE INDEX IF NOT EXISTS idx_blog_likes_user ON blog_likes(user_id);

CREATE TABLE IF NOT EXISTS blog_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id    INTEGER NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  content    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blog_comments_blog ON blog_comments(blog_id, created_at);
