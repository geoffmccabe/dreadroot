-- Fortress stone catalog cleanup.
--
-- The fortress BUILDER places five graded tiers (fortress_stone_1 lightest … _5 darkest)
-- and the in-world renderer reads each tier's texture from this `blocks` catalog. This
-- guarantees the catalog holds EXACTLY those five, correct and graded — so Admin/Blocks,
-- the builder preview, and the placed blocks all match. Re-run safe (idempotent).
--
-- NOT touched here: the legacy single `fortress_block` (grey cliff). It is load-bearing —
-- the pre-built central fortress and the items default both use it — so it is intentionally
-- left in place. Retiring it is a separate, larger migration (re-skin the central fortress
-- to a tier + repoint item defaults) and should be done deliberately, not as a side effect.

-- 1) Upsert the five correct tier definitions: graded webp textures, neutral white colour
--    (the grey grading lives in the texture, no runtime tint).
INSERT INTO blocks (key, name, description, cost, tier, category, rarity, class, texture_url, glow_factor, properties)
SELECT
  'fortress_stone_' || t,
  'Fortress Stone ' || t,
  'Tier ' || t || ' fortress stone (' || CASE WHEN t = 1 THEN 'lightest' WHEN t = 5 THEN 'darkest' ELSE 'mid' END || ')',
  10, t, 'building', 'common', 'basic',
  '/fortress_stone_' || t || '.webp',
  0,
  jsonb_build_object('size', jsonb_build_array(1, 1, 1), 'color', '#ffffff', 'emissive', false, 'transparent', false)
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

-- 2) Remove any stray fortress_stone_* rows beyond the five (old/duplicate/mis-tiered).
DELETE FROM blocks
WHERE key LIKE 'fortress_stone_%'
  AND key NOT IN (
    'fortress_stone_1', 'fortress_stone_2', 'fortress_stone_3', 'fortress_stone_4', 'fortress_stone_5'
  );
