-- Add banned column to users table for ban/unban functionality
ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0;
