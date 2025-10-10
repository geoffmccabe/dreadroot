-- Clean up orphaned user profiles
-- Keep only the profile for the current active user
DELETE FROM public.user_profiles 
WHERE user_id != '837caa16-a587-429f-a0d9-a77da554a739';

-- Also clean up orphaned inventory items
DELETE FROM public.user_inventory
WHERE user_id IS NOT NULL 
  AND user_id != '837caa16-a587-429f-a0d9-a77da554a739';