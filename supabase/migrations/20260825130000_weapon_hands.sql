-- How many hands each weapon takes.
--
-- Geoff was right: the original data already records this. Siege Worlds'
-- Unity item configs (Assets/Resources/config/*.asset) carry `weaponType`, and
-- every value maps to one held stance — the configs that share a weaponType
-- also share a playerAnimatorStance guid, which is the game telling us how the
-- weapon is held:
--
--   1  long guns      AK74, M16, M27, MP5, Dragunov, Plasma Rifle/Sniper/
--                     Shotgun, Shotgun, Double Barrel Shotgun, Flamethrower,
--                     Rocket Launcher, ZK-5, both crossbows, Bonnie's Rifle
--   4  pistols        Basic/Ash/Plasma/Shi Yang's Pistol, Revolver, Raygun,
--                     Musket, Double Barrel Musket
--   3  swords         Plasma Sword, Standard Sword
--   5  pickaxe        Pickaxe
--   6  glove          Flame Glove
--   7  club           Baseball Bat, GolfClub
--
-- Stored under properties->'sw'->'hands' beside the rest of the imported Siege
-- Worlds stats, so the provenance stays obvious.
--
-- NOTE, TWO GENUINE DISAGREEMENTS with DreadRoot's own held-weapon registry
-- (src/components/siege/charlineup/weaponModels.ts), which the Unity original
-- settles:
--   * Plasma Shotgun and Shotgun are animSet 'pistol' there, but weaponType 1
--     in Unity -> TWO-handed.
--   * Musket and Double Barrel Musket are animSet 'rifle' there, but
--     weaponType 4 in Unity -> ONE-handed, and they share the pistol stance.
--
-- FOUR WEAPONS ARE A JUDGEMENT CALL, not from the data: Unity marks Candy
-- cane, Hammer and Shovel as weaponType 0 (not weapons there at all) and has no
-- plain "Grenade". DreadRoot sells all four as weapons, so they are marked
-- one-handed here. Say the word to flip any of them.

UPDATE items SET properties = jsonb_set(
  COALESCE(properties, '{}'::jsonb),
  '{sw,hands}',
  to_jsonb(CASE
    WHEN regexp_replace(name, '\s+Tier\s+\d+$', '') IN (
      -- weaponType 1: both hands on the gun
      'AK74', 'Bonnie''s Rifle', 'Chinese Repeating Crossbow!', 'Chings Crossbow',
      'Double Barrel Shotgun', 'Dragunov', 'Flamethrower', 'M16', 'M27', 'MP5',
      'Plasma Rifle', 'Plasma Shotgun', 'Plasma Sniper', 'Rocket Launcher',
      'Shotgun', 'ZK-5',
      -- weaponType 7: swung with both hands
      'Baseball Bat', 'GolfClub'
    ) THEN 2
    ELSE 1
  END),
  true
)
WHERE item_category = 'weapon';

-- jsonb_set can only write into a path that already exists, and 10 weapons had
-- no properties->'sw' block at all (the ones the Siege parity import did not
-- cover: Candy cane, Grenade, Hammer, Shovel, Pickaxe, Plasma/Standard Sword,
-- and three tier-8 variants Siege Worlds has that DreadRoot does not). Those
-- silently kept a null hand count on the first pass. Seed the block, then set.
UPDATE items
   SET properties = jsonb_set(COALESCE(properties, '{}'::jsonb), '{sw}', '{}'::jsonb, true)
 WHERE item_category = 'weapon'
   AND (properties -> 'sw') IS NULL;

UPDATE items SET properties = jsonb_set(
  properties, '{sw,hands}',
  to_jsonb(CASE
    WHEN regexp_replace(name, '\s+Tier\s+\d+$', '') IN (
      'AK74', 'Bonnie''s Rifle', 'Chinese Repeating Crossbow!', 'Chings Crossbow',
      'Double Barrel Shotgun', 'Dragunov', 'Flamethrower', 'M16', 'M27', 'MP5',
      'Plasma Rifle', 'Plasma Shotgun', 'Plasma Sniper', 'Rocket Launcher',
      'Shotgun', 'ZK-5', 'Baseball Bat', 'GolfClub'
    ) THEN 2
    ELSE 1
  END),
  true
)
WHERE item_category = 'weapon'
  AND (properties -> 'sw' -> 'hands') IS NULL;
