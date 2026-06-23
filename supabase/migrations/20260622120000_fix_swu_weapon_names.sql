-- Fix weapons that were MISNAMED when ported from Siege Worlds Unity (SWU) → SWW/DreadRoot.
-- The display name lives in two tables: items.name (inventory / equip / vault) and
-- drop_table_entries.item_name (drop config). REPLACE catches the base item AND all tier
-- variants ("Dragonuv Tier 2" → "Dragunov Tier 2"). Item numbers + keys are unchanged (keys
-- aren't referenced in code; weapons are identified by item_number).
--
-- Confirmed corrections (more added as Geoff supplies the SWU-correct names):
--   Dragonuv → Dragunov   (the Dragunov SVD)
--   Ak47     → AK74

UPDATE public.items              SET name      = REPLACE(name,      'Dragonuv', 'Dragunov') WHERE name      LIKE 'Dragonuv%';
UPDATE public.drop_table_entries SET item_name = REPLACE(item_name, 'Dragonuv', 'Dragunov') WHERE item_name LIKE 'Dragonuv%';

UPDATE public.items              SET name      = REPLACE(name,      'Ak47', 'AK74') WHERE name      LIKE 'Ak47%';
UPDATE public.drop_table_entries SET item_name = REPLACE(item_name, 'Ak47', 'AK74') WHERE item_name LIKE 'Ak47%';
