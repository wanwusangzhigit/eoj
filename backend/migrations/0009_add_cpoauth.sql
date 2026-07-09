-- Migration 0009: Add CP OAuth support
-- 第一步：先新增普通字段，不能带UNIQUE
ALTER TABLE users ADD COLUMN cpoauth_id TEXT;

-- 第二步：清理重复数据（避免唯一索引创建失败）
DELETE FROM users
WHERE rowid NOT IN (
    SELECT MIN(rowid) FROM users GROUP BY cpoauth_id
);

-- 第三步：创建唯一索引，实现和列UNIQUE完全一样的约束效果
CREATE UNIQUE INDEX idx_users_cpoauth_id ON users(cpoauth_id);