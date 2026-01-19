-- Add points and level columns to user_profiles
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS total_points INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_level INTEGER NOT NULL DEFAULT 1;

-- Add index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_points ON public.user_profiles(total_points DESC);