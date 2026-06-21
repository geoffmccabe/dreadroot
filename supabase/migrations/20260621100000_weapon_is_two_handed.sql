-- Two-handed (rifle) flag for the dual-wield equip system. Safe-by-default: a gun is
-- ONE-HANDED (pistol-like, fits one hand, fires from either hand) UNLESS is_two_handed.
-- A two-handed gun fills BOTH hands and renders centered. Default false so no existing
-- weapon is accidentally treated as a rifle.
ALTER TABLE public.weapon_stats ADD COLUMN IF NOT EXISTS is_two_handed boolean DEFAULT false;

-- Mark your rifles here (one-handed guns need no change). Example:
--   UPDATE public.weapon_stats SET is_two_handed = true WHERE item_number IN (<AK74>, <other rifle item_numbers>);
