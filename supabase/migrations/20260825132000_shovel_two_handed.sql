-- Shovel is two-handed. Geoff's call, 2026-Aug-25.
--
-- It was one of the four I had to judge rather than read: Siege Worlds marks
-- Candy cane, Hammer and Shovel as weaponType 0 — not weapons there at all —
-- so there was no stance to inherit. I defaulted all four to one hand. The
-- other three are right; a shovel is swung with two.
--
-- Both places, so the recorded value and the runtime flag cannot drift.

UPDATE items
   SET properties = jsonb_set(properties, '{sw,hands}', to_jsonb(2), true)
 WHERE item_category = 'weapon'
   AND regexp_replace(name, '\s+Tier\s+\d+$', '') = 'Shovel';

UPDATE weapon_stats ws
   SET is_two_handed = true
  FROM items i
 WHERE i.item_number = ws.item_number
   AND regexp_replace(i.name, '\s+Tier\s+\d+$', '') = 'Shovel';
