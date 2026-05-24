-- =====================================================================
-- Shpider — new hopping spider enemy
-- =====================================================================
-- Phase 1: definitions table + 10 tiers seeded with Shombie textures
-- as placeholders. Admins can change the three textures (body, legs,
-- face) per tier from the admin panel later.
--
-- Movement: shpider holds still 0.5–1.5s, then hops fast along a
-- parabolic arc to a new position 1m to (5 + tier)m away. Can climb
-- trees by hopping onto block-tops.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.shpider_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tier INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Shpider',

  -- Visuals (3 textures + KTX2 siblings matching the new compressed
  -- texture system).
  body_texture_url       TEXT DEFAULT NULL,
  leg_texture_url        TEXT DEFAULT NULL,
  face_texture_url       TEXT DEFAULT NULL,
  body_texture_url_ktx2  TEXT DEFAULT NULL,
  leg_texture_url_ktx2   TEXT DEFAULT NULL,
  face_texture_url_ktx2  TEXT DEFAULT NULL,
  texture_tier           TEXT NOT NULL DEFAULT 'standard'
                         CHECK (texture_tier IN ('standard','premium')),

  -- Per-tier audio
  hop_sound_url     TEXT DEFAULT NULL,
  attack_sound_url  TEXT DEFAULT NULL,
  death_sound_url   TEXT DEFAULT NULL,

  -- Gameplay
  health                  REAL NOT NULL DEFAULT 80,
  damage_per_hit          REAL NOT NULL DEFAULT 6,
  knockback_received      REAL NOT NULL DEFAULT 1.0,
  speed_during_hop        REAL NOT NULL DEFAULT 12.0,
  spawn_chance_per_minute REAL NOT NULL DEFAULT 0.5,

  -- Hop physics
  hop_interval_min_ms INTEGER NOT NULL DEFAULT 1000,
  hop_interval_max_ms INTEGER NOT NULL DEFAULT 1500,
  hop_distance_min    REAL    NOT NULL DEFAULT 1.0,
  hop_distance_max    REAL    NOT NULL DEFAULT 6.0,
  hop_arc_factor      REAL    NOT NULL DEFAULT 0.4,
  hop_duration_ms     INTEGER NOT NULL DEFAULT 280,

  -- Body geometry
  body_size REAL NOT NULL DEFAULT 1.4,
  head_size REAL NOT NULL DEFAULT 0.7,

  -- Behavior
  can_climb_trees BOOLEAN NOT NULL DEFAULT TRUE,

  ai_config JSONB DEFAULT NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS — read-public, write-admin (mirrors shtickman_definitions)
ALTER TABLE public.shpider_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view shpider definitions" ON public.shpider_definitions;
CREATE POLICY "Anyone can view shpider definitions"
  ON public.shpider_definitions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can manage shpider definitions" ON public.shpider_definitions;
CREATE POLICY "Admins can manage shpider definitions"
  ON public.shpider_definitions
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  );

-- updated_at trigger
DROP TRIGGER IF EXISTS update_shpider_definitions_updated_at ON public.shpider_definitions;
CREATE TRIGGER update_shpider_definitions_updated_at
  BEFORE UPDATE ON public.shpider_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Seed 10 tiers. Each tier's three texture columns default to the
-- matching-tier Shombie texture_url, so they look like *something*
-- in-game before admins upload real Shpider art.
-- ---------------------------------------------------------------------
INSERT INTO public.shpider_definitions (
  tier, name,
  body_texture_url, leg_texture_url, face_texture_url,
  health, damage_per_hit, speed_during_hop, spawn_chance_per_minute,
  hop_interval_min_ms, hop_interval_max_ms,
  hop_distance_min, hop_distance_max,
  body_size, head_size, can_climb_trees
)
SELECT
  t.tier,
  'Shpider',
  s.texture_url AS body_texture_url,
  s.texture_url AS leg_texture_url,
  s.texture_url AS face_texture_url,
  t.health, t.damage, t.speed, t.spawn,
  t.imin, t.imax,
  t.dmin, t.dmax,
  t.body, t.head, TRUE
FROM (VALUES
  -- tier, health, damage, speed, spawn/min, imin, imax, dmin, dmax, body, head
  (1,   80.0,  6.0, 12.0, 0.50, 1000, 1500, 1.0,  6.0, 1.40, 0.70),
  (2,  110.0,  8.0, 14.0, 0.35,  900, 1400, 1.0,  7.0, 1.50, 0.75),
  (3,  150.0, 10.0, 16.0, 0.25,  850, 1350, 1.0,  8.0, 1.60, 0.80),
  (4,  200.0, 13.0, 18.0, 0.18,  800, 1300, 1.0,  9.0, 1.70, 0.85),
  (5,  260.0, 16.0, 20.0, 0.12,  750, 1250, 1.0, 10.0, 1.85, 0.90),
  (6,  330.0, 20.0, 22.0, 0.08,  700, 1200, 1.0, 11.0, 2.00, 1.00),
  (7,  420.0, 25.0, 25.0, 0.05,  650, 1150, 1.0, 12.0, 2.15, 1.10),
  (8,  540.0, 30.0, 28.0, 0.03,  600, 1100, 1.0, 13.0, 2.30, 1.20),
  (9,  700.0, 36.0, 32.0, 0.02,  550, 1050, 1.0, 14.0, 2.45, 1.30),
  (10, 900.0, 45.0, 36.0, 0.01,  500, 1000, 1.0, 15.0, 2.60, 1.40)
) AS t(tier, health, damage, speed, spawn, imin, imax, dmin, dmax, body, head)
LEFT JOIN public.shombie_definitions s ON s.tier = t.tier
ON CONFLICT (tier) DO NOTHING;
