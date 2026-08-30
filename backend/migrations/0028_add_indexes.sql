-- Migration 0028: Add missing indexes for query performance
-- Based on analysis of frequent query patterns in the codebase

-- === 1. submissions: composite index for solved/attempted checks ===
CREATE INDEX IF NOT EXISTS idx_submissions_user_problem_status
  ON submissions(user_id, problem_id, status);

CREATE INDEX IF NOT EXISTS idx_submissions_created
  ON submissions(created_at DESC);

-- === 2. notifications: user's unread notification queries ===
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, is_read, created_at DESC);

-- === 3. problems: public problem listing (most common query) ===
CREATE INDEX IF NOT EXISTS idx_problems_public
  ON problems(is_public, id);

-- === 4. solutions: review status filtering (admin) ===
CREATE INDEX IF NOT EXISTS idx_solutions_review
  ON solutions(review_status, created_at DESC);

-- === 5. blogs: published blog listing ===
CREATE INDEX IF NOT EXISTS idx_blogs_published
  ON blogs(status, created_at DESC);

-- === 6. training: chapter lookups by plan ===
CREATE INDEX IF NOT EXISTS idx_training_chapters_plan
  ON training_chapters(plan_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_training_chapter_problems_chapter
  ON training_chapter_problems(chapter_id, sort_order);

-- === 7. messages: conversation messages list ===
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at DESC);

-- === 8. audit_logs: admin audit listing ===
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);

-- === 9. user_ratings: leaderboard ===
CREATE INDEX IF NOT EXISTS idx_user_ratings_rating
  ON user_ratings(rating DESC);

-- === 10. contest_participants: contest rankings + virtual filter ===
CREATE INDEX IF NOT EXISTS idx_contest_participants_contest_virtual
  ON contest_participants(contest_id, is_virtual);

-- === 11. blog_comments: listing by blog ===
CREATE INDEX IF NOT EXISTS idx_blog_comments_blog
  ON blog_comments(blog_id, created_at ASC);

-- === 12. problem_reports: admin filtering by status ===
CREATE INDEX IF NOT EXISTS idx_problem_reports_status_date
  ON problem_reports(status, created_at DESC);