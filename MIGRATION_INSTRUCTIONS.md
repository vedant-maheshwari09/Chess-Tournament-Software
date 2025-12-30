# Database Migration Instructions

## Email Verification Migration

To add the new email verification features, you need to run a SQL migration in your Supabase database.

### Steps:

1. **Open Supabase Dashboard**
   - Go to your Supabase project dashboard
   - Navigate to the SQL Editor

2. **Run the Migration Script**
   - Copy the contents of `migrations/add_email_verification.sql`
   - Paste it into the SQL Editor
   - Click "Run" to execute the migration

3. **Verify the Migration**
   - The migration will:
     - Add `email_verified` column to `users` table
     - Update `password_resets` table to use `code` instead of `token`
     - Create the new `verification_codes` table
     - Add necessary indexes for performance

4. **Important Notes**
   - Existing users will have `email_verified = false` by default
   - Existing password reset records (if any) will need to be cleaned up manually if needed
   - The migration is idempotent (safe to run multiple times)

### Alternative: Manual Steps

If you prefer to run the commands individually, here's what each does:

1. Add email_verified column:
   ```sql
   ALTER TABLE users 
   ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
   ```

2. Update password_resets table:
   ```sql
   -- Remove old token column (if exists)
   ALTER TABLE password_resets DROP COLUMN IF EXISTS token;
   
   -- Add code column
   ALTER TABLE password_resets 
   ADD COLUMN IF NOT EXISTS code VARCHAR(6) NOT NULL;
   ```

3. Create verification_codes table:
   ```sql
   CREATE TABLE IF NOT EXISTS verification_codes (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     code VARCHAR(6) NOT NULL,
     type VARCHAR(20) NOT NULL DEFAULT 'email_verification',
     expires_at TIMESTAMP NOT NULL,
     used BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMP NOT NULL DEFAULT NOW()
   );
   ```

4. Add indexes:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_verification_codes_user_code_type 
   ON verification_codes(user_id, code, type);
   
   CREATE INDEX IF NOT EXISTS idx_verification_codes_user_type 
   ON verification_codes(user_id, type);
   
   CREATE INDEX IF NOT EXISTS idx_password_resets_user_code 
   ON password_resets(user_id, code);
   ```

