-- Migration 0040: Add contest freeze board support

ALTER TABLE contests ADD COLUMN freeze_minutes INTEGER DEFAULT 0;
ALTER TABLE contests ADD COLUMN board_frozen INTEGER DEFAULT 0;
