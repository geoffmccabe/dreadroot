-- Add visual_distance column to user_profiles table
ALTER TABLE public.user_profiles 
ADD COLUMN visual_distance INTEGER NOT NULL DEFAULT 4;

-- Add constraint to ensure visual_distance is between 1 and 20
ALTER TABLE public.user_profiles 
ADD CONSTRAINT visual_distance_range CHECK (visual_distance >= 1 AND visual_distance <= 20);

COMMENT ON COLUMN public.user_profiles.visual_distance IS 'Controls how many chunks (16x16 blocks) the user can see. Range: 1-20, Default: 4';