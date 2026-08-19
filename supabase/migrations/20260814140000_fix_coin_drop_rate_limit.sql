-- FIX A REGRESSION I INTRODUCED EARLIER TODAY (20260814120000).
--
-- That migration added a 30-drops-per-60s cap to spawn_coin_drop. Checking the
-- historical data afterwards showed the cap was far too low and would have
-- silently broken legitimate heavy combat:
--
--   peak observed  : 289 drops / 14,897 value in one minute (one user)
--   next busiest   :  58 drops /    596 value
--   p99 value/min  : 599
--   average        : 6.3 drops / 140.8 value per active minute
--   minutes over 30 drops: 9 of 271 (3.3%)
--
-- A drop is spawned per kill, so a horde fight legitimately exceeds 30/min.
-- The function returns silently when it refuses, so the failure mode was
-- invisible: coins would simply stop appearing mid-fight with no error.
--
-- Corrected limits, chosen to clear EVERYTHING ever observed with ~2x headroom,
-- because blocking real play is the worse failure here. The per-drop amount cap
-- (500, versus a real maximum of 100) remains the primary defence; these are
-- abuse brakes against industrial-scale minting, NOT gameplay limits.
--
--   600 drops / 60s   (2x the 289 peak)
--   30,000 value / 60s (2x the 14,897 peak)
--
-- The value ceiling is the one that matters: it bounds what can be minted per
-- minute regardless of how the calls are shaped.

CREATE OR REPLACE FUNCTION public.spawn_coin_drop(
  p_world_id    uuid,
  p_theme_name  text,
  p_amount      numeric,
  p_float_count int,
  p_x           double precision,
  p_y           double precision,
  p_z           double precision
) RETURNS SETOF world_coin_drops
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_theme        uuid;
  v_uid          uuid := auth.uid();
  v_recent_count int;
  v_recent_value numeric;
begin
  if v_uid is null then return; end if;

  -- Bound the value a single call may name. Real drops are 1..100.
  if p_amount is null or p_amount <= 0 or p_amount > 500 then return; end if;

  -- Abuse brake, sized well above real play (see header).
  select count(*), coalesce(sum(amount), 0)
    into v_recent_count, v_recent_value
    from world_coin_drops
   where killer_user_id = v_uid
     and dropped_at > now() - interval '60 seconds';

  if v_recent_count >= 600 then return; end if;
  if v_recent_value + p_amount > 30000 then return; end if;

  select id into v_theme from token_themes where name = p_theme_name limit 1;
  if v_theme is null then return; end if;

  return query
    insert into world_coin_drops
      (world_id, token_theme_id, amount, float_count, killer_user_id,
       position_x, position_y, position_z)
    values
      (p_world_id, v_theme, p_amount, greatest(1, least(10, p_float_count)), v_uid,
       p_x, p_y, p_z)
    returning *;
end;
$$;

REVOKE ALL ON FUNCTION public.spawn_coin_drop(uuid, text, numeric, int, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spawn_coin_drop(uuid, text, numeric, int, double precision, double precision, double precision) TO authenticated;
