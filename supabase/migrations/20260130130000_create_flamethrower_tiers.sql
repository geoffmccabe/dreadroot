-- Flamethrower per-tier settings (admin-configurable)
CREATE TABLE IF NOT EXISTS public.flamethrower_tiers (
  id SERIAL PRIMARY KEY,
  tier INTEGER NOT NULL UNIQUE CHECK (tier >= 1 AND tier <= 10),
  width DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  distance DOUBLE PRECISION NOT NULL DEFAULT 10.0,
  speed DOUBLE PRECISION NOT NULL DEFAULT 21.6,
  particles INTEGER NOT NULL DEFAULT 80,
  transparency DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (transparency >= 0 AND transparency <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed all 10 tiers with sensible defaults
INSERT INTO public.flamethrower_tiers (tier, width, distance, speed, particles, transparency) VALUES
  (1,  1.0,  4.0,  21.6, 80, 1.0),
  (2,  1.0,  5.0,  21.6, 80, 1.0),
  (3,  1.0,  6.0,  21.6, 80, 1.0),
  (4,  1.0,  7.0,  21.6, 80, 1.0),
  (5,  1.0,  8.0,  21.6, 80, 1.0),
  (6,  1.0,  9.0,  21.6, 80, 1.0),
  (7,  1.0, 10.0,  21.6, 80, 1.0),
  (8,  1.0, 11.0,  21.6, 80, 1.0),
  (9,  1.0, 12.0,  21.6, 80, 1.0),
  (10, 1.0, 13.0,  21.6, 80, 1.0)
ON CONFLICT (tier) DO NOTHING;

-- Enable RLS
ALTER TABLE public.flamethrower_tiers ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read (global game settings)
CREATE POLICY "Anyone can read flamethrower_tiers"
  ON public.flamethrower_tiers FOR SELECT
  USING (true);

-- Only superadmins can modify
CREATE POLICY "Superadmins can update flamethrower_tiers"
  ON public.flamethrower_tiers FOR UPDATE
  USING (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Superadmins can insert flamethrower_tiers"
  ON public.flamethrower_tiers FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

-- Auto-update updated_at
CREATE TRIGGER update_flamethrower_tiers_updated_at
  BEFORE UPDATE ON public.flamethrower_tiers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
