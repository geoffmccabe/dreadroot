-- =====================================================================
-- Shroomer — new enemy, a clone of the Shombie with mushroom geometry.
-- =====================================================================
-- Definitions table mirrors shombie_definitions EXACTLY (same columns,
-- constraints, RLS, updated_at trigger). Existing shombie rows are copied
-- so shroomers spawn with shombie data + textures immediately.
-- =====================================================================

-- 1) Table (same shape as shombie_definitions: base cols + ktx2 + texture_tier)
CREATE TABLE IF NOT EXISTS public.shroomer_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tier INTEGER NOT NULL UNIQUE DEFAULT 1,
  name TEXT NOT NULL DEFAULT 'Shroomer',
  texture_url TEXT DEFAULT NULL,
  texture_url_ktx2 TEXT DEFAULT NULL,
  texture_tier TEXT NOT NULL DEFAULT 'standard'
    CHECK (texture_tier IN ('standard','premium')),
  speed REAL NOT NULL DEFAULT 2.0,
  health REAL NOT NULL DEFAULT 100,
  damage_per_hit REAL NOT NULL DEFAULT 10,
  knockback_received REAL NOT NULL DEFAULT 2.0,
  spawn_chance_per_minute REAL NOT NULL DEFAULT 1.0,
  ai_config JSONB DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2) RLS — read-public, write-admin (matches shombie_definitions policies)
ALTER TABLE public.shroomer_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view shroomer definitions" ON public.shroomer_definitions;
CREATE POLICY "Anyone can view shroomer definitions"
ON public.shroomer_definitions
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins can manage shroomer definitions" ON public.shroomer_definitions;
CREATE POLICY "Admins can manage shroomer definitions"
ON public.shroomer_definitions
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- 3) updated_at trigger (same function the shombie table uses)
DROP TRIGGER IF EXISTS update_shroomer_definitions_updated_at ON public.shroomer_definitions;
CREATE TRIGGER update_shroomer_definitions_updated_at
BEFORE UPDATE ON public.shroomer_definitions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Copy existing shombie rows so shroomers look + behave like shombies
--    out of the box. Skips tiers already present (idempotent / safe re-run).
INSERT INTO public.shroomer_definitions
  (tier, name, texture_url, texture_url_ktx2, texture_tier,
   speed, health, damage_per_hit, knockback_received,
   spawn_chance_per_minute, ai_config)
SELECT
  s.tier,
  'Shroomer',
  s.texture_url,
  s.texture_url_ktx2,
  s.texture_tier,
  s.speed,
  s.health,
  s.damage_per_hit,
  s.knockback_received,
  s.spawn_chance_per_minute,
  s.ai_config
FROM public.shombie_definitions s
ON CONFLICT (tier) DO NOTHING;
