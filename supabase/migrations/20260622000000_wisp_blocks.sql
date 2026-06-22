-- Wisp blocks: 10 transparent tiers — the ONLY source of transparent blocks
-- in the game (obtained by shooting the in-game wisp, then resellable on the
-- marketplace). Retires crystal_block.
--
-- NOTE: the `blocks` table is shared by DreadRoot + Pinkland (no game column),
-- so this intentionally applies to BOTH games.

-- 1. Drop the old constraints FIRST, so the data update below isn't rejected
--    by the pre-existing (cosmic-less) rarity check.
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_class_check;
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_rarity_check;

-- 2. Retire the 'infinite' rarity → 'cosmic' is the top tier everywhere.
UPDATE blocks SET rarity = 'cosmic' WHERE rarity = 'infinite';

-- 3. Re-add constraints: class adds 'wisp', rarity ends in 'cosmic' (no
--    'infinite'). NOT VALID so a pre-existing off-list legacy row can't block
--    the add; all new/updated rows are still enforced.
ALTER TABLE blocks ADD CONSTRAINT blocks_class_check
  CHECK (class IN ('basic', 'magic', 'mystery', 'iconic', 'wisp')) NOT VALID;
ALTER TABLE blocks ADD CONSTRAINT blocks_rarity_check
  CHECK (rarity IN ('common','uncommon','rare','epic','legendary','divine','mystic','rainbow','apocalyptic','cosmic')) NOT VALID;

-- 4. The 10 wisp tiers. cost 0 = not shop-bought. Weighted spawn (tier 1 ~50%
--    ... tier 10 ~0.1%) is enforced client-side in useWispBlock.ts.
INSERT INTO blocks (key, name, description, cost, tier, category, rarity, class, glow_factor, properties)
SELECT
  'wisp_' || t,
  initcap(r) || ' Wisp',
  'Tier ' || t || ' wisp block',
  0, t, 'special', r, 'wisp', g,
  jsonb_build_object('size', jsonb_build_array(1,1,1), 'color', c, 'emissive', t > 1, 'transparent', true)
FROM (VALUES
  (1,  'common',      '#9C7A4F', 0.0),
  (2,  'uncommon',    '#3FA34D', 0.6),
  (3,  'rare',        '#2E86DE', 1.0),
  (4,  'epic',        '#8E44AD', 1.4),
  (5,  'legendary',   '#E63946', 2.0),
  (6,  'divine',      '#F5F5FA', 2.6),
  (7,  'mystic',      '#FF6FB5', 2.2),
  (8,  'rainbow',     '#FF4D4D', 2.6),
  (9,  'apocalyptic', '#1A1A1A', 3.0),
  (10, 'cosmic',      '#FFD700', 3.4)
) AS v(t, r, c, g)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, cost = EXCLUDED.cost, tier = EXCLUDED.tier,
  category = EXCLUDED.category, rarity = EXCLUDED.rarity, class = EXCLUDED.class,
  glow_factor = EXCLUDED.glow_factor, properties = EXCLUDED.properties;

-- 5. Convert already-placed crystal blocks → Tier 1 wisp (per owner decision)
UPDATE placed_blocks SET block_type = 'wisp_1' WHERE block_type = 'crystal_block';

-- 6. Retire the crystal_block definition
DELETE FROM blocks WHERE key = 'crystal_block';
