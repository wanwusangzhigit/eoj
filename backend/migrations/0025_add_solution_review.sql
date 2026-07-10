-- Phase 2.6: 题解审核机制
-- 既有题解默认 approved，新创建的题解在 INSERT 时显式指定 review_status='pending'

ALTER TABLE solutions ADD COLUMN review_status TEXT DEFAULT 'approved';
ALTER TABLE solutions ADD COLUMN reviewed_by INTEGER;
ALTER TABLE solutions ADD COLUMN reviewed_at DATETIME;
ALTER TABLE solutions ADD COLUMN reject_reason TEXT DEFAULT '';
