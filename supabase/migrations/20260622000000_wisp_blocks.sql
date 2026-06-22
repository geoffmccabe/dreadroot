-- Wisp blocks: 10 transparent tiers — the ONLY source of transparent blocks
-- in the game (obtained by shooting the in-game wisp, then resellable on the
-- marketplace). Retires crystal_block.
--
-- NOTE: the `blocks` table is shared by DreadRoot + Pinkland (no game column),
-- so this intentionally applies to BOTH games.

-- 1. Allow the new class 'wisp' and the new rarity 'cosmic'
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_class_check;
ALTER TABLE blocks ADD CONSTRAINT blocks_class_check
  CHECK (class IN ('basic', 'magic', 'mystery', 'iconic', 'wisp'));

ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_rarity_check;
ALTER TABLE blocks ADD CONSTRAINT blocks_rarity_check
  CHECK (rarity IN ('common','uncommon','rare','epic','legendary','divine','mystic','rainbow','apocalyptic','cosmic','infinite'));

-- 2. The 10 wisp tiers. cost 0 = not shop-bought. Weighted spawn (tier 1 ~50%
--    ... tier 10 ~0.1%) is enforced client-side in useWispBlock.ts.
INSERT INTO blocks (key, name, description, cost, tier, category, rarity, class, glow_factor, properties) VALUES
('wisp_1', 'Common Wisp',      'Tier 1 wisp block', 0, 1,  'special', 'common',      'wisp', 0,   '{"size":[1,1,1],"color":"#9C7A4F","emissive":false,"transparent":true}'::jsonb),
('wisp_2', 'Uncommon Wisp',    'Tier 2 wisp block', 0, 2,  'special', 'uncommon',    'wisp', 0.6, '{"size":[1,1,1],"color":"#3FA34D","emissive":true,"transparent":true}'::jsonb),
('wisp_3', 'Rare Wisp',        'Tier 3 wisp block', 0, 3,  'special', 'rare',        'wisp', 1.0, '{"size":[1,1,1],"color":"#2E86DE","emissive":true,"transparent":true}'::jsonb),
('wisp_4', 'Epic Wisp',        'Tier 4 wisp block', 0, 4,  'special', 'epic',        'wisp', 1.4, '{"size":[1,1,1],"color":"#8E44AD","emissive":true,"transparent":true}'::jsonb),
('wisp_5', 'Legendary Wisp',   'Tier 5 wisp block', 0, 5,  'special', 'legendary',   'wisp', 2.0, '{"size":[1,1,1],"color":"#E63946","emissive":true,"transparent":true}'::jsonb),
('wisp_6', 'Divine Wisp',      'Tier 6 wisp block', 0, 6,  'special', 'divine',      'wisp', 2.6, '{"size":[1,1,1],"color":"#F5F5FA","emissive":true,"transparent":true}'::jsonb),
('wisp_7', 'Mystic Wisp',      'Tier 7 wisp block', 0, 7,  'special', 'mystic',      'wisp', 2.2, '{"size":[1,1,1],"color":"#FF6FB5","emissive":true,"transparent":true}'::jsonb),
('wisp_8', 'Rainbow Wisp',     'Tier 8 wisp block', 0, 8,  'special', 'rainbow',     'wisp', 2.6, '{"size":[1,1,1],"color":"#FF4D4D","emissive":true,"transparent":true}'::jsonb),
('wisp_9', 'Apocalyptic Wisp', 'Tier 9 wisp block', 0, 9,  'special', 'apocalyptic', 'wisp', 3.0, '{"size":[1,1,1],"color":"#1A1A1A","emissive":true,"transparent":true}'::jsonb),
('wisp_10','Cosmic Wisp',      'Tier 10 wisp block',0, 10, 'special', 'cosmic',      'wisp', 3.4, '{"size":[1,1,1],"color":"#FFD700","emissive":true,"transparent":true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, cost = EXCLUDED.cost, tier = EXCLUDED.tier,
  category = EXCLUDED.category, rarity = EXCLUDED.rarity, class = EXCLUDED.class,
  glow_factor = EXCLUDED.glow_factor, properties = EXCLUDED.properties;

-- 3. Convert already-placed crystal blocks → Tier 1 wisp (per owner decision)
UPDATE placed_blocks SET block_type = 'wisp_1' WHERE block_type = 'crystal_block';

-- 4. Retire the crystal_block definition
DELETE FROM blocks WHERE key = 'crystal_block';
