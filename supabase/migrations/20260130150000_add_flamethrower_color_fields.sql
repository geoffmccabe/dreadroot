-- Add color and opacity fields to flamethrower_tiers
ALTER TABLE public.flamethrower_tiers
  ADD COLUMN IF NOT EXISTS color1 TEXT NOT NULL DEFAULT '#FFFFFF',
  ADD COLUMN IF NOT EXISTS color2 TEXT NOT NULL DEFAULT '#00FFFF',
  ADD COLUMN IF NOT EXISTS color3 TEXT NOT NULL DEFAULT '#0044FF',
  ADD COLUMN IF NOT EXISTS fire_opacity DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (fire_opacity >= 0 AND fire_opacity <= 1),
  ADD COLUMN IF NOT EXISTS smoke_opacity DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (smoke_opacity >= 0 AND smoke_opacity <= 1);

-- Set per-tier color defaults
UPDATE public.flamethrower_tiers SET color1 = '#FFFF88', color2 = '#FF8800', color3 = '#553300' WHERE tier = 1;  -- yellow/brown
UPDATE public.flamethrower_tiers SET color1 = '#88FF88', color2 = '#00FF00', color3 = '#005500' WHERE tier = 2;  -- green
UPDATE public.flamethrower_tiers SET color1 = '#FFFFFF', color2 = '#00FFFF', color3 = '#0044FF' WHERE tier = 3;  -- blue (current look)
UPDATE public.flamethrower_tiers SET color1 = '#DD88FF', color2 = '#8800FF', color3 = '#440088' WHERE tier = 4;  -- purple
UPDATE public.flamethrower_tiers SET color1 = '#FFFF00', color2 = '#FF4400', color3 = '#880000' WHERE tier = 5;  -- red
UPDATE public.flamethrower_tiers SET color1 = '#FFFFFF', color2 = '#EEEEFF', color3 = '#AAAACC' WHERE tier = 6;  -- white
UPDATE public.flamethrower_tiers SET color1 = '#FFAAFF', color2 = '#FF00FF', color3 = '#880088' WHERE tier = 7;  -- pink/fuchsia
UPDATE public.flamethrower_tiers SET color1 = '#FF4444', color2 = '#44FF44', color3 = '#4444FF' WHERE tier = 8;  -- rainbow (R/G/B)
UPDATE public.flamethrower_tiers SET color1 = '#FF6600', color2 = '#FF0000', color3 = '#220000' WHERE tier = 9;  -- apocalyptic
UPDATE public.flamethrower_tiers SET color1 = '#FFFFCC', color2 = '#FFD700', color3 = '#AA8800' WHERE tier = 10; -- cosmic gold
