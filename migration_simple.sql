-- Simplified Migration Script (No complex blocks)
-- Run these commands in your Supabase SQL Editor

-- 1. Add email_verified column
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- 2. Add code column to password_resets
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS code VARCHAR(6);

-- 3. Clear old data to prevent conflicts
DELETE FROM password_resets;

-- 4. Make code required
ALTER TABLE password_resets ALTER COLUMN code SET NOT NULL;

-- 5. Remove old token constraints and column safely
ALTER TABLE password_resets DROP CONSTRAINT IF EXISTS password_resets_token_key;
DROP INDEX IF EXISTS password_resets_token_key;
ALTER TABLE password_resets DROP COLUMN IF EXISTS token;

-- 6. Create verification_codes table
CREATE TABLE IF NOT EXISTS verification_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(6) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'email_verification',
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 7. Add Indexes
CREATE INDEX IF NOT EXISTS idx_verification_codes_user_code_type ON verification_codes(user_id, code, type);
CREATE INDEX IF NOT EXISTS idx_verification_codes_user_type ON verification_codes(user_id, type);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_code ON password_resets(user_id, code);
