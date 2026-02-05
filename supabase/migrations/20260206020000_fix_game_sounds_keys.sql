-- Fix game_sounds keys to match what the code expects

-- Update keys that don't match
UPDATE public.game_sounds SET sound_key = 'ricochet' WHERE sound_key = 'bullet_ricochet';
UPDATE public.game_sounds SET sound_key = 'coin_hit' WHERE sound_key = 'coin_collect';
UPDATE public.game_sounds SET sound_key = 'planting_tree' WHERE sound_key = 'tree_plant';
UPDATE public.game_sounds SET sound_key = 'level_up' WHERE sound_key = 'victory';

-- Add missing sounds
INSERT INTO public.game_sounds (sound_key, display_name, description, sound_url, default_url, is_3d_sound) VALUES
  ('bubble_pop', 'Bubble Pop', 'Sound when inspector-deleting a block', '/bubble_pop.mp3', '/bubble_pop.mp3', false),
  ('forge_background', 'Forge Background', 'Background ambience while forging items', '/forge_bkgd_noise.mp3', '/forge_bkgd_noise.mp3', false),
  ('forge_hammer', 'Forge Hammer', 'Hammer strike sound during forging', '/forge_hammer.mp3', '/forge_hammer.mp3', false),
  ('fruit_pickup', 'Fruit Pickup', 'Sound when harvesting fruit from trees', '/axe_chop.mp3', '/axe_chop.mp3', false)
ON CONFLICT (sound_key) DO NOTHING;
