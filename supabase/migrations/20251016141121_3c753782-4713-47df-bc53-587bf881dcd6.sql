-- Phase 6: Final Cleanup & Constraints

-- Step 1: Delete orphaned blocks (from deleted users)
DELETE FROM public.placed_blocks
WHERE user_id NOT IN (SELECT id FROM auth.users);

-- Step 2: Add NOT NULL constraint to placed_blocks.user_id
-- First set any remaining NULL user_ids to a system user or delete them
DELETE FROM public.placed_blocks WHERE user_id IS NULL;

-- Now add the constraint
ALTER TABLE public.placed_blocks 
  ALTER COLUMN user_id SET NOT NULL;

-- Step 3: Add foreign key constraint for data integrity
ALTER TABLE public.placed_blocks
  ADD CONSTRAINT placed_blocks_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;