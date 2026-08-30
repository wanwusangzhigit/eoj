-- Add permissions column for fine-grained admin access control
ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '[]';

-- Update existing admin users to have all permissions
UPDATE users SET permissions = '["contest_admin","problem_admin","list_admin","ticket_admin"]' WHERE role = 'admin';
