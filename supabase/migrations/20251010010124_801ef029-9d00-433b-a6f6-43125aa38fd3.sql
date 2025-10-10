-- First, reassign all placed blocks to the current active user
-- This preserves all existing blocks in the fortress
UPDATE public.placed_blocks 
SET user_id = '837caa16-a587-429f-a0d9-a77da554a739'
WHERE user_id IS NOT NULL 
  AND user_id != '837caa16-a587-429f-a0d9-a77da554a739';

-- Now safely delete old users from auth.users
-- The billboard system (walls, media, URLs) has no user_id columns so won't be affected
DELETE FROM auth.users 
WHERE id != '837caa16-a587-429f-a0d9-a77da554a739';