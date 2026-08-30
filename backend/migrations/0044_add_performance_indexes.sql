-- Migration 0044: Performance indexes based on audit findings
-- 审计报告 #10: 高频查询缺少复合索引

-- === 1. submissions: 用户按状态过滤 (user_id + status) ===
-- 覆盖 achievements.ts / problems.ts 的
--   SELECT ... FROM submissions WHERE user_id = ? AND status = 'accepted'
-- 现有 idx_submissions_user_problem_status(user_id, problem_id, status) 无法高效
-- 服务不带 problem_id 的 user_id+status 过滤,因此补充该复合索引。
CREATE INDEX IF NOT EXISTS idx_submissions_user_status
  ON submissions(user_id, status);

-- === 2. contest_participants: 报名/参赛校验 (contest_id + user_id) ===
-- 覆盖 contests.ts / submissions.ts 大量
--   SELECT ... FROM contest_participants WHERE contest_id = ? AND user_id = ?
-- 现有 idx_contest_participants_contest_virtual(contest_id, is_virtual) 无法服务该查询。
CREATE INDEX IF NOT EXISTS idx_contest_participants_contest_user
  ON contest_participants(contest_id, user_id);

-- === 3. email_verification_codes: 按邮箱取最新验证码 ===
-- 覆盖 auth.ts 的
--   SELECT ... FROM email_verification_codes WHERE email = ? ORDER BY id DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email
  ON email_verification_codes(email, id DESC);
