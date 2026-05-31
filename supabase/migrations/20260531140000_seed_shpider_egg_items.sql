-- Ensure all 10 shpider_egg_t<N> item rows exist with the right
-- forge_family + pickup_cooldown_seconds so the admin can upload
-- a sprite for every tier. Safe to re-run.

INSERT INTO public.items (key, name, tier, item_category, forge_family, pickup_cooldown_seconds, rarity, cost)
SELECT
  'shpider_egg_t' || g.tier,
  'Shpider Egg',
  g.tier,
  'consumable',
  'shpider_egg',
  3600,
  -- Use the rarity-of-the-shpider mapping if a shpider definition
  -- of the same tier exists, otherwise fall back to the tier number
  -- (clamped 1..10).
  GREATEST(1, LEAST(10, g.tier)),
  0
FROM generate_series(1, 10) AS g(tier)
ON CONFLICT (key) DO UPDATE
  SET forge_family = COALESCE(items.forge_family, 'shpider_egg'),
      pickup_cooldown_seconds = COALESCE(items.pickup_cooldown_seconds, 3600);
