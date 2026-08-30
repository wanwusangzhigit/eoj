-- Migration 0050: 代码分享短链支持密码保护
ALTER TABLE code_shares ADD COLUMN password_hash TEXT;
