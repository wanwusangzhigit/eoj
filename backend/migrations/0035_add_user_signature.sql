-- Migration 0035: Add signature field to users table

ALTER TABLE users ADD COLUMN signature TEXT DEFAULT '';