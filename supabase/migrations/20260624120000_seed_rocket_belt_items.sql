-- Seed the 10 Rocket Belt items (item_number 239–248, tiers 1–10).
--
-- The Rocket Belt is a Special-slot item: equipped in the Special equip slot it lets a
-- NON-admin player hold Shift+E for a forward jet boost, metered by a per-minute fuel
-- budget of tier × 2 seconds (FortressControls.tsx beltFuel logic; EquipSlots publishes the
-- equipped tier via rocketBeltTierFromItemNumber → setRocketBelt). The CLIENT pipeline was
-- already complete, but these DB rows were never created, so the item couldn't be equipped
-- and the effect was unreachable. This seeds them.
--
-- item_category='consumable' so the item is accepted into the Special slot (which accepts
-- consumable/potion). The belt is NOT consumed on use — category only governs slot fit.
-- Shared DB: this is additive (brand-new item_numbers), safe for both DreadRoot and Pinkland.

INSERT INTO public.items (key, name, item_number, item_category, tier, rarity, class, cost, description, properties)
SELECT
  'rocket_belt_t' || t,
  'Rocket Belt',
  238 + t,
  'consumable',
  t,
  'common',
  'consumable',
  t * 20000,
  'Hold Shift+E for a forward jet boost. Tier ' || t || ' gives ' || (t * 2) || 's of boost per minute.',
  jsonb_build_object('boost_seconds_per_minute', t * 2)
FROM generate_series(1, 10) AS t
ON CONFLICT (key) DO NOTHING;
