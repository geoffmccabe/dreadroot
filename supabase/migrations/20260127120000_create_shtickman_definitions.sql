-- Create shtickman_definitions table (tall stick humanoid enemy tier configurations)
CREATE TABLE public.shtickman_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tier INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Shtickman',

  -- Visuals
  body_texture_url TEXT DEFAULT NULL,
  head_texture_url TEXT DEFAULT NULL,
  face_texture_url TEXT DEFAULT NULL,

  -- Audio per tier
  roar_sound_url TEXT DEFAULT NULL,
  throw_sound_url TEXT DEFAULT NULL,
  death_sound_url TEXT DEFAULT NULL,

  -- Gameplay
  speed REAL NOT NULL DEFAULT 3.0,
  health REAL NOT NULL DEFAULT 300,
  damage_per_hit REAL NOT NULL DEFAULT 0,
  knockback_received REAL NOT NULL DEFAULT 1.0,

  ai_config JSONB DEFAULT NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.shtickman_definitions ENABLE ROW LEVEL SECURITY;

-- Allow all users to read definitions
CREATE POLICY "Anyone can view shtickman definitions"
ON public.shtickman_definitions
FOR SELECT
USING (true);

-- Allow admins to modify definitions
CREATE POLICY "Admins can manage shtickman definitions"
ON public.shtickman_definitions
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- Add updated_at trigger
CREATE TRIGGER update_shtickman_definitions_updated_at
BEFORE UPDATE ON public.shtickman_definitions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Seed 10 tiers with scaling stats
-- Height: Tier 1 = 22 blocks, +2 per tier = Tier 10 = 40 blocks
-- Head: Tier 1 = 3x3x3, Tier 10 = 6x6x6
INSERT INTO public.shtickman_definitions (tier, name, speed, health, knockback_received)
VALUES
  (1, 'Shtickman', 3.0, 300, 1.0),
  (2, 'Shtickman', 3.1, 350, 1.0),
  (3, 'Shtickman', 3.2, 400, 1.0),
  (4, 'Shtickman', 3.3, 450, 1.0),
  (5, 'Shtickman', 3.4, 500, 1.0),
  (6, 'Shtickman', 3.5, 550, 1.0),
  (7, 'Shtickman', 3.6, 600, 1.0),
  (8, 'Shtickman', 3.7, 650, 1.0),
  (9, 'Shtickman', 3.8, 700, 1.0),
  (10, 'Shtickman', 4.0, 800, 1.0);
