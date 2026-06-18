-- spawn_coin_drop — drop a coin with an EXPLICIT amount + coin type (by token-theme name), instead
-- of rolling a monster's admin config. Siege Worlds uses it to drop DIVI = round(initialHealth/10)
-- on a kill. Inserts a world_coin_drops row (same table the admin-config roll uses) so the existing
-- pickup_coin_drop credits real DIVI on collect. Shared DB → applies to both games; only the siege
-- client calls it for now.
create or replace function spawn_coin_drop(
  p_world_id    uuid,
  p_theme_name  text,
  p_amount      numeric,
  p_float_count int,
  p_x           double precision,
  p_y           double precision,
  p_z           double precision
) returns setof world_coin_drops
language plpgsql
security definer
set search_path = public
as $$
declare
  v_theme uuid;
  v_uid   uuid := auth.uid();
begin
  if v_uid is null or p_amount <= 0 then return; end if;
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

grant execute on function spawn_coin_drop(uuid, text, numeric, int, double precision, double precision, double precision) to authenticated;
