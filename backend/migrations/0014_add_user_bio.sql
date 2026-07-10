-- Migration 0014: Add bio column to users
ALTER TABLE users ADD COLUMN bio TEXT DEFAULT '';
