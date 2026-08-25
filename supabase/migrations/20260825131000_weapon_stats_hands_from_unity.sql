-- Correct weapon_stats.is_two_handed from the Siege Worlds original.
--
-- weapon_stats already had an is_two_handed flag and the quick-equip logic
-- already reads it — I missed the table and wrongly told Geoff no such flag
-- existed. It does. What it does NOT do is agree with the source: 15 weapons
-- (77 rows) are wrong, and the errors are not subtle.
--
--   marked ONE-handed, actually TWO: Rocket Launcher, MP5, Shotgun, Plasma
--     Shotgun, Bonnie's Rifle, ZK-5, both crossbows, Baseball Bat, GolfClub,
--     plus stray single tiers of Dragunov, Plasma Rifle and Plasma Sniper
--   marked TWO-handed, actually ONE: Musket, Double Barrel Musket
--
-- A one-handed rocket launcher and a two-handed musket are both plainly wrong,
-- and the stray single tiers look like a half-filled table rather than intent.
--
-- The Unity configs are the original and are internally consistent — weapons
-- sharing a weaponType also share a playerAnimatorStance, i.e. the game itself
-- holds them the same way. properties->'sw'->'hands' now records that import;
-- this syncs the runtime table to it so there is ONE answer, not two.

UPDATE weapon_stats ws
   SET is_two_handed = ((i.properties -> 'sw' ->> 'hands')::int = 2)
  FROM items i
 WHERE i.item_number = ws.item_number
   AND i.item_category = 'weapon'
   AND (i.properties -> 'sw' ->> 'hands') IS NOT NULL
   AND ws.is_two_handed IS DISTINCT FROM ((i.properties -> 'sw' ->> 'hands')::int = 2);
