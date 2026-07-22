-- Migration 0031: Add captcha attempts tracking for retry limit

ALTER TABLE captcha_codes ADD COLUMN attempts INTEGER DEFAULT 0;