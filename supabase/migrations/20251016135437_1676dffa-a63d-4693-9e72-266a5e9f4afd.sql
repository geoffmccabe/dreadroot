-- Phase 2A: Clean up orphaned data before adding constraints

-- Step 1: Delete orphaned user_profiles (where user_id doesn't exist in auth.users)
DELETE FROM public.user_profiles
WHERE user_id IS NOT NULL 
  AND user_id NOT IN (SELECT id FROM auth.users);

-- Step 2: Delete orphaned user_inventory
DELETE FROM public.user_inventory
WHERE user_id IS NOT NULL 
  AND user_id NOT IN (SELECT id FROM auth.users);

-- Step 3: Delete profiles with NULL user_id
DELETE FROM public.user_profiles WHERE user_id IS NULL;

-- Step 4: Delete inventory with NULL user_id
DELETE FROM public.user_inventory WHERE user_id IS NULL;