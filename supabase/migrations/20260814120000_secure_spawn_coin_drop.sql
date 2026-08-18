-- SECURITY FIX (2026-Aug-14): spawn_coin_drop let the CLIENT name the currency
-- amount with no upper bound. The only check was `p_amount <= 0`.
--
-- Why that was critical: pickup_coin_drop debits token_pools only when a pool
-- row exists. If source='funded' it caps; if 'minted' it just tracks; but when
-- there is NO pool row at all it falls through BOTH branches and credits the
-- full amount. DIVI has no pool row, so the pair
-- (spawn_coin_drop -> pickup_coin_drop) minted unlimited DIVI, and DIVI is
-- tradeable on the P2P marketplace. The 60s "not_yours_yet" guard does not
-- help because the spawner is recorded as killer_user_id on their own drop.
--
-- Verified before changing: 1472 DIVI drops to date, amounts 1..100
-- (avg 18.8, max 100). No exploitation had occurred.
--
-- Interim fix (real fix is server-side combat authority, CDO plan Phase 3):
--   1. Hard upper bound, 500 = 5x the observed legitimate maximum.
--   2. Per-user rate limit, 30 drops / 60s (a kill drops one coin).
-- Both are generous for real play and remove the unbounded mint.

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
  v_theme  uuid;
  v_uid    uuid := auth.uid();
  v_recent int;
begin
  if v_uid is null then return; end if;

  -- Bound the value the client is allowed to name.
  if p_amount is null or p_amount <= 0 or p_amount > 500 then return; end if;

  -- Rate limit: one coin per kill; 30/min is far above real play.
  select count(*) into v_recent
    from world_coin_drops
   where killer_user_id = v_uid
     and dropped_at > now() - interval '60 seconds';
  if v_recent >= 30 then return; end if;

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

GRANT EXECUTE ON FUNCTION public.spawn_coin_drop(uuid, text, numeric, int, double precision, double precision, double precision) TO authenticated;
