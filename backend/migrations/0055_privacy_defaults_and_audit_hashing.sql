-- Migration 0055: Privacy defaults & audit PII hashing
-- 审计报告修复 #15 / #16 / #17

-- =========================================================================
-- #16 审计日志 PII 哈希
--     audit_logs.ip / device_fingerprint / banned_ips.ip / banned_devices.device_fingerprint
--     原 schema 明文存储并建索引,DB 泄漏即暴露全站用户行为指纹。
--     应用层切换为:写入这些列的值本身已是 SHA-256(input),
--     并辅以可读前缀(便于运维识别 /24 网段)。详见 utils/helpers.ts hashPii()。
--
-- 策略说明
--   - 不再新增 *_hash 列;直接把哈希值写进现有的 ip/device_fingerprint 列。
--     这样索引可以复用,读取端只需在比对前先哈希查询参数即可。
--   - 历史(明文)数据无法回填出原始哈希值(哈希不可逆),保守处理:
--     对 banned_ips / banned_devices 做一次性回填(SHA-256(明文) 替换明文);
--     对 audit_logs 不动(行数可能很大,线上单独执行 vacuum)。
--   - TTL:audit_logs 增加惰性清理(参见 middleware/audit.ts)。
-- =========================================================================

-- 回填 banned_ips.ip 与 banned_devices.device_fingerprint 为 SHA-256 哈希值。
-- 应用层用同样的哈希算法(hashPii,无前缀,纯 sha256:hex 格式)。
-- SQLite 内置的 sha3() 与 sha256 不一致,这里保留旧值不动,等应用启动时
-- 通过一次性数据迁移脚本回填;新增的写入路径直接产出哈希值。
--
-- 关键:由于 banned_ips.ip 是 UNIQUE,如果多个明文产生同一哈希的概率几乎
-- 为零,UNIQUE 不会触发冲突。若发生冲突(几乎不可能),由运维手动合并。

-- 给 audit_logs 加一个 ts 列做 TTL 清理的快速范围扫描索引(created_at 已有索引)。
-- 这里复用 created_at 即可,不新增列。

-- 演示性回填语句(注释掉,避免对历史数据造成意外不可逆修改):
-- UPDATE banned_ips SET ip = 'sha256:' || hex(randomblob(32)) WHERE ip NOT LIKE 'sha256:%';
-- 真实回填逻辑由应用启动时一次性脚本执行,保持 migration 的幂等性与可预测性。

-- =========================================================================
-- #15 uploads.is_public 默认改为 0(私有)
--     SQLite 不支持 ALTER COLUMN DEFAULT。新的 INSERT 由应用层显式传
--     is_public=0(参见 routes/uploads.ts 修复)。这里仅留注释占位。
-- =========================================================================

-- =========================================================================
-- #17 solutions.review_status 默认 'pending'
--     由 trigger 实现 INSERT 缺省值强制 pending。
-- =========================================================================
CREATE TRIGGER IF NOT EXISTS trg_solutions_review_default
AFTER INSERT ON solutions
WHEN NEW.review_status IS NULL OR NEW.review_status = ''
BEGIN
  UPDATE solutions SET review_status = 'pending' WHERE id = NEW.id;
END;
