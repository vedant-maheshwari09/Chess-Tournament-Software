-- Migration: Add email verification and update password reset to use codes
-- Run this in your Supabase SQL Editor to fix the "2BP01: cannot drop index" error

-- 1. Add email_verified column to users table (idempotent)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- 2. Update password_resets table to use code instead of token
DO $ 
BEGIN
  -- Add code column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'password_resets' AND column_name = 'code'
  ) THEN
    ALTER TABLE password_resets 
    ADD COLUMN code VARCHAR(6);
  END IF;
  
  -- Delete any existing password reset records to ensure clean state
  DELETE FROM password_resets;
  
  -- Now make code NOT NULL
  ALTER TABLE password_resets 
  ALTER COLUMN code SET NOT NULL;
  
  -- Safely drop the token column and its constraints
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'password_resets' AND column_name = 'token'
  ) THEN
    -- First, try to drop the constraint by name if it exists
    BEGIN
      ALTER TABLE password_resets DROP CONSTRAINT IF EXISTS password_resets_token_key;
    EXCEPTION
      WHEN undefined_object THEN
        NULL; -- Constraint doesn't exist, carry on
    END;

    -- Explicitly drop the index if it still exists
    DROP INDEX IF EXISTS password_resets_token_key;
    
    -- Finally drop the column
    ALTER TABLE password_resets DROP COLUMN token;
  END IF;
END $;

-- 3. Create verification_codes table
CREATE TABLE IF NOT EXISTS verification_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(6) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'email_verification',
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_verification_codes_user_code_type 
ON verification_codes(user_id, code, type);

CREATE INDEX IF NOT EXISTS idx_verification_codes_user_type 
ON verification_codes(user_id, type);

CREATE INDEX IF NOT EXISTS idx_password_resets_user_code 
ON password_resets(user_id, code);
