-- Add proximity_sound_url column to shtickman_definitions
-- This sound plays when shtickman gets within one chunk of the player
ALTER TABLE public.shtickman_definitions
ADD COLUMN IF NOT EXISTS proximity_sound_url TEXT DEFAULT NULL;

-- Add comment explaining the field
COMMENT ON COLUMN public.shtickman_definitions.proximity_sound_url IS 'Sound URL played when shtickman enters same chunk as player. Falls back to /sounds/shtickman_sound.mp3 if null.';
