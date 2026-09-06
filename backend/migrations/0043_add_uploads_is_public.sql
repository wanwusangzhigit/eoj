-- 文件上传增加 is_public 字段:
-- 默认 1(公开)——已上传的文件保持公开可下载;新上传由用户选择公开/私有
ALTER TABLE uploads ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_uploads_user_public ON uploads(user_id, is_public);
