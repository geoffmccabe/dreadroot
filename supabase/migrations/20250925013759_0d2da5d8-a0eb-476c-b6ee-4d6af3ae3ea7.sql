-- First, let's see the duplicate profiles issue
-- Clean up duplicate user profiles - keep only the most recent one for each user_id
WITH ranked_profiles AS (
  SELECT id, user_id, 
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY updated_at DESC, created_at DESC) as rn
  FROM user_profiles
)
DELETE FROM user_profiles 
WHERE id IN (
  SELECT id FROM ranked_profiles WHERE rn > 1
);

-- Add unique constraint to prevent future duplicates
ALTER TABLE user_profiles ADD CONSTRAINT unique_user_id UNIQUE (user_id);