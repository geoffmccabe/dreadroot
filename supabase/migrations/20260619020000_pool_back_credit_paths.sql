-- SECURITY (money): make the two remaining credit paths pool-backed / non-client-trusted, so a
-- hacked client can never mint more of a coin than its funded pool holds. Mirrors the pool logic
-- already in grant_currency. Shared DB → applies to both games. See docs/CURRENCY_LEDGER_PLAN.md.
--
-- These were captured from the live DB (pg_get_functiondef) and patched in place — same behaviour,
-- plus pool-backing. roll_monster_coin_drop is unchanged (its amounts come from admin config, not
-- the client) — its drops are bounded at pickup by the pool-backed pickup below.

-- 1. pickup_coin_drop — draw the payout from the coin's pool. funded = hard cap (an oversized/forged
--    drop the pool can't cover credits nothing and is left unconsumed); minted = uncapped game coin;
--    no pool = legacy mint (fund the coin's pool to make it airtight). Original logic preserved.
create or replace function public.pickup_coin_drop(p_drop_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_drop public.world_coin_drops; v_new_balance int; v_pool_source text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_drop from public.world_coin_drops where id = p_drop_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'missing'); end if;
  if v_drop.picked_up then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if (now() - v_drop.dropped_at) < interval '60 seconds'
     and v_drop.killer_user_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_yours_yet');
  end if;

  -- Pool backing (the drop row is locked FOR UPDATE, so debit-then-consume can't race).
  select source into v_pool_source from public.token_pools where token_theme_id = v_drop.token_theme_id;
  if v_pool_source = 'funded' then
    update public.token_pools
       set balance = balance - v_drop.amount, total_dispensed = total_dispensed + v_drop.amount, updated_at = now()
     where token_theme_id = v_drop.token_theme_id and source = 'funded' and balance >= v_drop.amount;
    if not found then return jsonb_build_object('ok', false, 'reason', 'pool_insufficient'); end if;  -- left unconsumed
  elsif v_pool_source = 'minted' then
    update public.token_pools set total_dispensed = total_dispensed + v_drop.amount, updated_at = now()
     where token_theme_id = v_drop.token_theme_id;
  end if;
  -- no pool row → legacy mint (fund the pool to protect this coin)

  update public.world_coin_drops set picked_up = true, picked_up_by = v_uid where id = p_drop_id and picked_up = false;
  if not found then return jsonb_build_object('ok', false, 'reason', 'race'); end if;

  insert into public.user_token_balances (user_id, token_theme_id, coins)
    values (v_uid, v_drop.token_theme_id, v_drop.amount)
    on conflict (user_id, token_theme_id)
    do update set coins = public.user_token_balances.coins + v_drop.amount, updated_at = now()
    returning coins into v_new_balance;
  return jsonb_build_object('ok', true, 'amount', v_drop.amount, 'token_theme_id', v_drop.token_theme_id, 'new_balance', v_new_balance);
end;
$fn$;

-- 2. ensure_token_balance — create a missing wallet at ZERO. The client-supplied starting amount is
--    ignored (it previously let a client mint up to 1,000,000 of any coin added after their signup).
--    The signup starting bonus stays in handle_new_user; lazy wallet creation gives no free money.
create or replace function public.ensure_token_balance(p_token_theme_id uuid, p_starting_coins integer, p_client_request_id uuid)
returns json language plpgsql security definer set search_path = public as $fn$
declare v_user_id uuid := auth.uid(); v_is_new boolean; v_existing record;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_token_theme_id is null then raise exception 'token_theme_id required' using errcode = '22023'; end if;
  if p_client_request_id is null then raise exception 'client_request_id required' using errcode = '22023'; end if;

  select * into v_existing from user_token_balances where user_id = v_user_id and token_theme_id = p_token_theme_id;
  if found then return row_to_json(v_existing); end if;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  if not v_is_new then
    select * into v_existing from user_token_balances where user_id = v_user_id and token_theme_id = p_token_theme_id;
    return row_to_json(v_existing);
  end if;

  insert into user_token_balances (user_id, token_theme_id, coins)
  values (v_user_id, p_token_theme_id, 0)                          -- ZERO: ignore client-supplied amount
  on conflict (user_id, token_theme_id) do nothing
  returning * into v_existing;

  if v_existing is null then
    select * into v_existing from user_token_balances where user_id = v_user_id and token_theme_id = p_token_theme_id;
  end if;
  return row_to_json(v_existing);
end;
$fn$;
