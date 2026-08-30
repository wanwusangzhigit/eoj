-- Add Special Judge (SPJ) support to problems table
ALTER TABLE problems ADD COLUMN judge_type TEXT DEFAULT 'default';
ALTER TABLE problems ADD COLUMN spj_language TEXT;
