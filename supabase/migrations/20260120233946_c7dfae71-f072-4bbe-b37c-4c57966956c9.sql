-- Create table for bullet tier definitions
CREATE TABLE public.bullet_definitions (
  id SERIAL PRIMARY KEY,
  tier INTEGER NOT NULL UNIQUE CHECK (tier >= 1 AND tier <= 10),
  colors TEXT[] NOT NULL DEFAULT ARRAY['#FFFFFF'],
  burn_time REAL NOT NULL DEFAULT 0.5,
  burn_width REAL NOT NULL DEFAULT 0.25,
  burn_height REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default values for all 10 tiers
INSERT INTO public.bullet_definitions (tier, colors, burn_time, burn_width, burn_height) VALUES
  (1, ARRAY['#FFFF00'], 0.5, 0.25, 0.5),
  (2, ARRAY['#00FF00'], 0.55, 0.275, 0.55),
  (3, ARRAY['#0088FF'], 0.6, 0.3, 0.6),
  (4, ARRAY['#8B00FF'], 0.65, 0.325, 0.65),
  (5, ARRAY['#FF0000'], 0.7, 0.35, 0.7),
  (6, ARRAY['#FFFFFF'], 0.75, 0.375, 0.75),
  (7, ARRAY['#FF69B4'], 0.8, 0.4, 0.8),
  (8, ARRAY['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#8B00FF'], 0.85, 0.425, 0.85),
  (9, ARRAY['#1a1a1a'], 0.9, 0.45, 0.9),
  (10, ARRAY['#FFD700'], 0.95, 0.475, 0.95);

-- Enable RLS
ALTER TABLE public.bullet_definitions ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read bullet definitions (they're global game settings)
CREATE POLICY "Anyone can read bullet definitions"
  ON public.bullet_definitions FOR SELECT
  USING (true);

-- Only superadmins can modify bullet definitions
CREATE POLICY "Superadmins can update bullet definitions"
  ON public.bullet_definitions FOR UPDATE
  USING (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Superadmins can insert bullet definitions"
  ON public.bullet_definitions FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

-- Add updated_at trigger
CREATE TRIGGER update_bullet_definitions_updated_at
  BEFORE UPDATE ON public.bullet_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();