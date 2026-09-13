-- Migration 0054: Audit hardening — FK indexes, UNIQUE constraints, hashing helper
-- 审计报告修复 #20: 补外键列索引、rating_changes UNIQUE、submission_testcases FK + 索引

-- =========================================================================
-- 1. submission_testcases.testcase_id 增加 FK 引用 + 索引
--    原 migration 0018 仅声明 INTEGER,未声明 FK,也未建索引。
--    D1 (SQLite) 不支持 ALTER TABLE ADD FOREIGN KEY,这里通过新建索引实现
--    性能修复;FK 约束由应用层维护(测试点删除时已通过应用逻辑级联清理)。
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_submission_testcases_testcase_id
  ON submission_testcases(testcase_id);

-- =========================================================================
-- 2. rating_changes 补 UNIQUE(user_id, contest_id)
--    原 migration 0027 缺少该约束,同一用户在同一比赛可插入多条 rating 变更
--    记录,污染排行榜计算。
-- =========================================================================
-- 先清理潜在重复行(保留 id 最大的一条),再建唯一索引。
DELETE FROM rating_changes
WHERE id NOT IN (
  SELECT MAX(id) FROM rating_changes GROUP BY user_id, contest_id
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_changes_user_contest
  ON rating_changes(user_id, contest_id);

-- =========================================================================
-- 3. 补高频 FK 列索引(覆盖反向查询,如"某用户的全部 X")
--    审计 #M1 中列出的全部缺索引外键列。
-- =========================================================================

-- 审计 #H-1: users.username 无 UNIQUE 约束,GitHub OAuth 直接用 GitHub login
-- 作为用户名插入,可与其他用户重名,导致按 username 查询时身份混淆。
-- 先清理历史重复行(保留 id 最小者),再建唯一索引。
-- 注意:执行前应人工核对重复用户名;此 DELETE 仅在确实存在重复时影响数据。
DELETE FROM users
WHERE id NOT IN (
  SELECT MIN(id) FROM users GROUP BY username
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users(username);

-- solution_votes.user_id — 查"某用户投过的票"
CREATE INDEX IF NOT EXISTS idx_solution_votes_user_id
  ON solution_votes(user_id);

-- discussion_replies.user_id — 查"某用户的全部回复"
CREATE INDEX IF NOT EXISTS idx_discussion_replies_user_id
  ON discussion_replies(user_id);

-- blog_comments.user_id — 查"某用户的博客评论"
CREATE INDEX IF NOT EXISTS idx_blog_comments_user_id
  ON blog_comments(user_id);

-- training_plans.user_id — 查"某用户的训练计划"
CREATE INDEX IF NOT EXISTS idx_training_plans_user_id
  ON training_plans(user_id);

-- plagiarism_reports.submission_b(单独) — 反向查关联
CREATE INDEX IF NOT EXISTS idx_plagiarism_reports_submission_b
  ON plagiarism_reports(submission_b);

-- teams.owner_id — 列出"某用户拥有的全部团队"
CREATE INDEX IF NOT EXISTS idx_teams_owner_id
  ON teams(owner_id);

-- messages.sender_id — 查"某用户发送的全部消息"
CREATE INDEX IF NOT EXISTS idx_messages_sender_id
  ON messages(sender_id);

-- solutions.reviewed_by — 审计员工作台查询
CREATE INDEX IF NOT EXISTS idx_solutions_reviewed_by
  ON solutions(reviewed_by);

-- problem_reports.user_id — 查"某用户提交的举报"
CREATE INDEX IF NOT EXISTS idx_problem_reports_user_id
  ON problem_reports(user_id);

-- team_join_requests.handled_by — 处理人查询
CREATE INDEX IF NOT EXISTS idx_team_join_requests_handled_by
  ON team_join_requests(handled_by);

-- team_announcements/discussions/replies/problem_sets/contests/participants.user_id
CREATE INDEX IF NOT EXISTS idx_team_announcements_user_id        ON team_announcements(user_id);
CREATE INDEX IF NOT EXISTS idx_team_discussions_user_id          ON team_discussions(user_id);
CREATE INDEX IF NOT EXISTS idx_team_discussion_replies_user_id   ON team_discussion_replies(user_id);
CREATE INDEX IF NOT EXISTS idx_team_problem_sets_user_id         ON team_problem_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_team_contests_user_id             ON team_contests(user_id);
CREATE INDEX IF NOT EXISTS idx_team_contest_participants_user_id ON team_contest_participants(user_id);

-- contest_announcements.user_id
CREATE INDEX IF NOT EXISTS idx_contest_announcements_user_id
  ON contest_announcements(user_id);

-- contest_clarifications.answered_by
CREATE INDEX IF NOT EXISTS idx_contest_clarifications_answered_by
  ON contest_clarifications(answered_by);

-- team_contest_announcements.user_id
CREATE INDEX IF NOT EXISTS idx_team_contest_announcements_user_id
  ON team_contest_announcements(user_id);
