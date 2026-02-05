-- Game Sounds System
-- Allows admins to configure and upload custom sounds for various game events

-- Create the game_sounds table
CREATE TABLE public.game_sounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sound_key TEXT UNIQUE NOT NULL,           -- Unique identifier (e.g., 'axe_chop', 'gunshot')
  display_name TEXT NOT NULL,               -- Human-readable name (e.g., 'Axe Chop')
  description TEXT,                         -- Optional description of when this sound plays
  sound_url TEXT NOT NULL,                  -- URL to the sound file (default or custom)
  default_url TEXT NOT NULL,                -- Original default URL (for reset functionality)
  is_3d_sound BOOLEAN DEFAULT false,        -- Whether this sound uses 3D positional audio
  volume NUMERIC DEFAULT 1.0,               -- Volume multiplier (0.0 - 2.0)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for fast lookups by key
CREATE INDEX idx_game_sounds_key ON public.game_sounds(sound_key);

-- Enable RLS
ALTER TABLE public.game_sounds ENABLE ROW LEVEL SECURITY;

-- Anyone can read sounds
CREATE POLICY "game_sounds_read_all"
ON public.game_sounds
FOR SELECT
USING (true);

-- Only admins can modify sounds
CREATE POLICY "game_sounds_admin_write"
ON public.game_sounds
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'superadmin')
  )
);

-- Updated_at trigger
CREATE TRIGGER update_game_sounds_updated_at
  BEFORE UPDATE ON public.game_sounds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default sounds (alphabetical by display_name)
INSERT INTO public.game_sounds (sound_key, display_name, description, sound_url, default_url, is_3d_sound) VALUES
  ('axe_chop', 'Axe Chop', 'Sound when chopping trees or collecting fruit', '/axe_chop.mp3', '/axe_chop.mp3', false),
  ('block_place', 'Block Place', 'Sound when placing a block', '/wooden_thud_sound.mp3', '/wooden_thud_sound.mp3', false),
  ('block_remove', 'Block Remove', 'Sound when removing/deleting a block', '/bubble_pop.mp3', '/bubble_pop.mp3', false),
  ('bullet_ricochet', 'Bullet Ricochet', 'Sound when bullet hits a surface', '/ricochet_sound.mp3', '/ricochet_sound.mp3', false),
  ('coin_collect', 'Coin Collect', 'Sound when collecting coins or rewards', '/coin_hit_sound.mp3', '/coin_hit_sound.mp3', false),
  ('flamethrower', 'Flamethrower', 'Sound when using the flamethrower', '/flame_glove.mp3', '/flame_glove.mp3', false),
  ('gunshot', 'Gunshot', 'Sound when firing the gun', '/space_gunshot.mp3', '/space_gunshot.mp3', false),
  ('jet_boots', 'Jet Boots', 'Sound when using jet boots to fly', '/jet_boots_1.mp3', '/jet_boots_1.mp3', false),
  ('pentabullet_charging', 'Pentabullet Charging', 'Looping sound while charging pentabullet', '/pentabullet_power_steady.mp3', '/pentabullet_power_steady.mp3', false),
  ('pentabullet_fire', 'Pentabullet Fire', 'Sound when firing the pentabullet', '/pentabullet_sound.mp3', '/pentabullet_sound.mp3', false),
  ('pentabullet_powerdown', 'Pentabullet Powerdown', 'Sound when pentabullet charge is released', '/pentabullet_powerdown.mp3', '/pentabullet_powerdown.mp3', false),
  ('pentabullet_powerup', 'Pentabullet Powerup', 'Sound when starting to charge pentabullet', '/pentabullet_powerup.mp3', '/pentabullet_powerup.mp3', false),
  ('pistol_cock', 'Pistol Cock', 'Sound when readying the pistol', '/pistol_cocking_sound.mp3', '/pistol_cocking_sound.mp3', false),
  ('pistol_holster', 'Pistol Holster', 'Sound when holstering the pistol', '/holster_pistol_sound.mp3', '/holster_pistol_sound.mp3', false),
  ('timber_falling', 'Timber Falling', 'Sound when a tree falls after being chopped', '/timber_falling_sound.mp3', '/timber_falling_sound.mp3', false),
  ('tree_plant', 'Tree Plant', 'Sound when planting a tree', '/planting_tree_sound.mp3', '/planting_tree_sound.mp3', false),
  ('victory', 'Victory Sound', 'Celebratory sound for achievements', '/yay_sound.mp3', '/yay_sound.mp3', false),
  ('yodel', 'Yodel', 'Yodel sound (Ctrl+Y at high altitude)', '/yodel_1.mp3', '/yodel_1.mp3', true)
ON CONFLICT (sound_key) DO NOTHING;

-- Note: Storage bucket 'game-sounds' should be created in Supabase dashboard
-- with public access for reading
