-- Add fog_enabled column to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN fog_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.user_profiles.fog_enabled IS 'Enable/disable distance fog rendering';