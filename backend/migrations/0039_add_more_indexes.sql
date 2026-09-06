-- Migration 0039: Additional indexes for query performance
-- Based on analysis of frequent query patterns

-- === 1. discussions: global discussion listing ===
CREATE INDEX IF NOT EXISTS idx_discussions_created
  ON discussions(created_at DESC);

-- === 2. discussion_replies: listing by discussion ===
CREATE INDEX IF NOT EXISTS idx_discussion_replies_discussion
  ON discussion_replies(discussion_id, created_at ASC);

-- === 3. favorites: user's favorites with problem join ===
CREATE INDEX IF NOT EXISTS idx_favorites_user_problem
  ON favorites(user_id, problem_id);

-- === 4. submissions: admin stats by date ===
CREATE INDEX IF NOT EXISTS idx_submissions_date
  ON submissions(created_at);

-- === 5. tickets: admin listing by status ===
CREATE INDEX IF NOT EXISTS idx_tickets_status
  ON tickets(status, updated_at DESC);

-- === 6. contest_problems: contest problem listing ===
CREATE INDEX IF NOT EXISTS idx_contest_problems_label
  ON contest_problems(contest_id, label);

-- === 7. problem_list_items: list problem listing ===
CREATE INDEX IF NOT EXISTS idx_problem_list_items_list
  ON problem_list_items(list_id, sort_order);

-- === 8. follows: user follow queries ===
CREATE INDEX IF NOT EXISTS idx_user_follows_follower
  ON user_follows(follower_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_follows_following
  ON user_follows(following_id, created_at DESC);

-- === 9. submissions: daily stats query (for admin dashboard) ===
CREATE INDEX IF NOT EXISTS idx_submissions_date_status
  ON submissions(created_at, status);

-- === 10. uploads: user's upload listing ===
CREATE INDEX IF NOT EXISTS idx_uploads_user
  ON uploads(user_id, created_at DESC);

-- === 11. teams: member lookups ===
CREATE INDEX IF NOT EXISTS idx_team_members_team
  ON team_members(team_id);

-- === 12. password_reset_tokens: lookup by token ===
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token
  ON password_reset_tokens(token);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email
  ON password_reset_tokens(email);
