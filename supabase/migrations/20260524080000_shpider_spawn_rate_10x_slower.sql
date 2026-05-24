-- Cut natural spawn rate by 10× across all tiers. Earlier playtest had
-- 100+ shpiders accumulating; new rates aim for ~1 spawn per ~30s near
-- the player, with the same per-tier rarity curve preserved.
UPDATE public.shpider_definitions
SET spawn_chance_per_minute = ROUND((spawn_chance_per_minute / 10)::numeric, 4)::real
WHERE tier BETWEEN 1 AND 10;
