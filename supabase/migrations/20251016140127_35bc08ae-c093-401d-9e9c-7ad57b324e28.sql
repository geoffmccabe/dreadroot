-- Phase 2C: Fix Missing INSERT Policy for Auto-Profile Creation

-- CRITICAL FIX: Add INSERT policy for user_profiles
-- The handle_new_user() trigger needs this to auto-create profiles
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'user_profiles' 
    AND policyname = 'Users can insert their own profile'
  ) THEN
    CREATE POLICY "Users can insert their own profile"
      ON public.user_profiles
      FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Also ensure the foreign key constraint exists (idempotent)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'user_profiles_user_id_fkey'
  ) THEN
    ALTER TABLE public.user_profiles 
      ADD CONSTRAINT user_profiles_user_id_fkey 
      FOREIGN KEY (user_id) 
      REFERENCES auth.users(id) 
      ON DELETE CASCADE;
  END IF;
END $$;