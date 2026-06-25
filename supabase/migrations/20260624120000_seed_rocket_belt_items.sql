-- Ensure the 10 Rocket Belt items exist at item_number 239–248 as Special-slot GEAR.
--
-- The Rocket Belt is persistent GEAR (NOT a consumable): while equipped it grants a
-- recharging forward-boost ability (Shift+E), like the jet boots. The client detects the
-- belt by ITEM_NUMBER (239–248), not by key, and the Special slot accepts category
-- consumable/potion/gear. So the only thing that matters here is that items 239–248 exist
-- with item_category='gear'.
--
-- Conflict-safe: earlier attempts may already have created these rows (via SQL or the admin
-- items panel) under a different key/category. item_number is UNIQUE, so we UPDATE by
-- item_number and only INSERT the ones that are genuinely missing — never colliding on the
-- item_number or key unique constraints.
-- Shared DB: additive/idempotent, safe for both DreadRoot and Pinkland.

-- 1. Re-point any existing items at item_number 239–248 to be the gear Rocket Belt.
UPDATE public.items
   SET item_category = 'gear',
       name          = 'Rocket Belt',
       class         = 'gear',
       tier          = item_number - 238,
       description   = 'Equip in the Special slot, then hold Shift+E to jet forward. Bursts scale with your level, the belt tier, and VIP.',
       properties    = jsonb_build_object('bursts_per_tier', 4, 'burst_seconds', 0.25, 'regen_seconds', 5)
 WHERE item_number BETWEEN 239 AND 248;

-- 2. Create any of the 10 tiers that don't exist yet (matched by item_number).
INSERT INTO public.items (key, name, item_number, item_category, tier, rarity, class, cost, description, properties)
SELECT 'rocket_belt_t' || t, 'Rocket Belt', 238 + t, 'gear', t, 'common', 'gear', t * 20000,
       'Equip in the Special slot, then hold Shift+E to jet forward. Bursts scale with your level, the belt tier, and VIP.',
       jsonb_build_object('bursts_per_tier', 4, 'burst_seconds', 0.25, 'regen_seconds', 5)
FROM generate_series(1, 10) AS t
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE item_number = 238 + t);
