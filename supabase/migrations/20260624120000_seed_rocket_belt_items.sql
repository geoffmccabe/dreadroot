-- Seed the 10 Rocket Belt items (item_number 239–248, tiers 1–10).
--
-- The Rocket Belt is a Special-slot GEAR item (NOT a consumable): while equipped it grants a
-- recharging forward-boost ability (Shift+E) that works like the jet boots. Each "burst" =
-- 0.25s of fast-forward; the burst budget scales with player level + belt tier + VIP level
-- (4 bursts each) and regenerates 1 every 5s. The CLIENT pipeline (EquipSlots detection →
-- rocketBelt store → FortressControls spend/regen → HUD gauge) is complete; these DB rows are
-- what let the item be equipped.
--
-- item_category='gear' (the Special slot accepts consumable/potion/gear). 'gear' marks it as
-- persistent equipment that is never consumed, unlike potions/eggs.
-- Shared DB: additive (brand-new item_numbers), safe for both DreadRoot and Pinkland.
--
-- If a prior run created these as 'consumable', re-point them to 'gear':
UPDATE public.items SET item_category = 'gear'
 WHERE key LIKE 'rocket_belt_t%';

INSERT INTO public.items (key, name, item_number, item_category, tier, rarity, class, cost, description, properties)
SELECT
  'rocket_belt_t' || t,
  'Rocket Belt',
  238 + t,
  'gear',
  t,
  'common',
  'gear',
  t * 20000,
  'Equip in the Special slot, then hold Shift+E to jet forward. Bursts scale with your level, the belt tier, and VIP.',
  jsonb_build_object('bursts_per_tier', 4, 'burst_seconds', 0.25, 'regen_seconds', 5)
FROM generate_series(1, 10) AS t
ON CONFLICT (key) DO UPDATE
  SET item_category = EXCLUDED.item_category,
      class         = EXCLUDED.class,
      description    = EXCLUDED.description,
      properties     = EXCLUDED.properties;
