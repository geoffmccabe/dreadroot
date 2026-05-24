-- Set the default hop sound URL on every tier that hasn't been
-- customised yet. The file is bundled into /public, so it's served
-- from the site root.
UPDATE public.shpider_definitions
SET hop_sound_url = '/shpider_jump.mp3'
WHERE hop_sound_url IS NULL OR hop_sound_url = '';
