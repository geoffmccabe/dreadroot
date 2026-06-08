-- =====================================================================
-- Vortax — new enemy, a clone of the Shroomer rendered as orbiting
-- sphere-clouds. ~20m tall, TIER 1 ONLY.
-- =====================================================================
-- Definitions table mirrors shroomer_definitions EXACTLY (same columns,
-- constraints, RLS, updated_at trigger). ONE tier-1 row is copied from the
-- shombie (fallback shroomer) so vortaxes spawn with a texture immediately.
-- =====================================================================

-- 1) Table (same shape as shroomer_definitions)
CREATE TABLE IF NOT EXISTS public.vortax_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tier INTEGER NOT NULL UNIQUE DEFAULT 1,
  name TEXT NOT NULL DEFAULT 'Vortax',
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

-- 2) RLS — read-public, write-admin (matches shroomer_definitions policies)
ALTER TABLE public.vortax_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view vortax definitions" ON public.vortax_definitions;
CREATE POLICY "Anyone can view vortax definitions"
ON public.vortax_definitions
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins can manage vortax definitions" ON public.vortax_definitions;
CREATE POLICY "Admins can manage vortax definitions"
ON public.vortax_definitions
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- 3) updated_at trigger (same function the other definition tables use)
DROP TRIGGER IF EXISTS update_vortax_definitions_updated_at ON public.vortax_definitions;
CREATE TRIGGER update_vortax_definitions_updated_at
BEFORE UPDATE ON public.vortax_definitions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Copy the tier-1 shombie row so the vortax spawns with a texture.
--    (Idempotent / safe re-run via ON CONFLICT.)
INSERT INTO public.vortax_definitions
  (tier, name, texture_url, texture_url_ktx2, texture_tier,
   speed, health, damage_per_hit, knockback_received,
   spawn_chance_per_minute, ai_config)
SELECT
  1,
  'Vortax',
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
WHERE s.tier = 1
ON CONFLICT (tier) DO NOTHING;
