-- Flag the TWO-HANDED weapons (rifles / snipers / shotguns / muskets / flamethrower) so the
-- dual-wield equip system treats them as rifles: they fill BOTH hand slots, render centered,
-- and can't be equipped unless both hands are free. The rule (is_gun AND is_two_handed) already
-- exists in code; this sets the data flag that was left unset (the column shipped default false).
--
-- Matched by the items.key prefix (keys are unchanged — only display NAMES were renamed), so
-- the base weapon AND all 7 tiers are covered. One-handed pistols (ray_pistol, pistol,
-- ash_pistol, ray_gun) and the flame glove stay default false.

UPDATE public.weapon_stats SET is_two_handed = true
WHERE item_number IN (
  SELECT item_number FROM public.items WHERE
       key LIKE 'ak47%'                  -- AK74
    OR key LIKE 'dragonuv%'              -- Dragunov
    OR key LIKE 'm16%'
    OR key LIKE 'm27%'
    OR key LIKE 'plasma_auto_rifle%'
    OR key LIKE 'ray_sniper%'            -- Plasma Sniper
    OR key LIKE 'double_barrel_shotgun%'
    OR key LIKE 'ray_shotgun%'           -- Plasma Shotgun
    OR key LIKE 'musket%'
    OR key LIKE 'double_barrel_musket%'
    OR key LIKE 'flamethrower%'
);
