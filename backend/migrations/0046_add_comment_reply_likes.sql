-- Migration 0046: 评论增强(回复 + 点赞)
-- 博客/讨论评论支持回复(引用父评论)与点赞

-- 博客评论增加父评论引用(回复功能)
ALTER TABLE blog_comments ADD COLUMN parent_id INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_blog_comments_parent ON blog_comments(parent_id);

-- 博客评论点赞
CREATE TABLE IF NOT EXISTS blog_comment_likes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id  INTEGER NOT NULL REFERENCES blog_comments(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_blog_comment_likes_comment ON blog_comment_likes(comment_id);

-- 讨论回复增加父回复引用(回复功能)
ALTER TABLE discussion_replies ADD COLUMN parent_id INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_discussion_replies_parent ON discussion_replies(parent_id);

-- 讨论回复点赞
CREATE TABLE IF NOT EXISTS discussion_reply_likes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reply_id    INTEGER NOT NULL REFERENCES discussion_replies(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(reply_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_discussion_reply_likes_reply ON discussion_reply_likes(reply_id);
