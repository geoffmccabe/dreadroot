-- Fortress stone tiers: the fortress builder already places fortress_stone_1..5
-- (tier 1 lightest … tier 5 darkest), but those block definitions never existed,
-- so every tier fell back to white + the shared cliff texture and looked identical.
--
-- Fix per owner preference: distinct TEXTURES (greyscale brightness-graded webp
-- files in /public), NO runtime tint. color is neutral white so only the texture
-- differentiates the tiers.

INSERT INTO blocks
  (key, name, description, cost, tier, category,
   rarity, class, texture_url, glow_factor, properties)
SELECT
  'fortress_stone_' || t,
  'Fortress Stone ' || t,
  'Tier ' || t || ' fortress stone',
  10,
  t,
  'building',
  'common',
  'basic',
  '/fortress_stone_' || t || '.webp',
  0,
  jsonb_build_object(
    'size', jsonb_build_array(1, 1, 1),
    'color', '#ffffff',
    'emissive', false,
    'transparent', false
  )
FROM generate_series(1, 5) AS t
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  cost = EXCLUDED.cost,
  tier = EXCLUDED.tier,
  category = EXCLUDED.category,
  rarity = EXCLUDED.rarity,
  class = EXCLUDED.class,
  texture_url = EXCLUDED.texture_url,
  glow_factor = EXCLUDED.glow_factor,
  properties = EXCLUDED.properties;
