-- Add empty gun click sound for no-fire zone
-- This sound plays when player tries to shoot within the FSZ + 1 chunk buffer

INSERT INTO public.game_sounds (sound_key, display_name, description, sound_url, default_url, is_3d_sound) VALUES
  ('empty_gun_click', 'Empty Gun Click', 'Sound when trying to fire in the no-fire zone (FSZ + 1 chunk)', '/empty_gun_click.mp3', '/empty_gun_click.mp3', false)
ON CONFLICT (sound_key) DO NOTHING;
