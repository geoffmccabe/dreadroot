-- Slice 2 — pool-backed currency. Every coin a player earns comes out of a real reserve POOL the
-- owner funds from outside the game. token_pools holds one reserve per variant (token_theme).
-- grant_currency is rewired to draw from it. SAFE TRANSITION: a coin with NO pool row still mints
-- as before, so nothing breaks until you opt a coin in by funding its pool. See
-- docs/CURRENCY_LEDGER_PLAN.md. (deposit_address = the game's receiving wallet, shown in the
-- admin GAME WALLET panel.)

-- 1. The reserve per variant.
create table if not exists public.token_pools (
  id              uuid primary key default gen_random_uuid(),
  token_theme_id  uuid not null references public.token_themes(id) on delete cascade,
  source          text not null default 'funded' check (source in ('funded','minted')),
  balance         numeric not null default 0,
  total_funded    numeric not null default 0,
  total_dispensed numeric not null default 0,
  low_water_mark  numeric not null default 0,
  deposit_address text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (token_theme_id)
);

alter table public.token_pools enable row level security;
drop policy if exists token_pools_read on public.token_pools;
create policy token_pools_read on public.token_pools for select using (true);

-- 2. fund_pool — admin tops a pool up from outside the game (or creates it on first fund).
create or replace function public.fund_pool(p_token_theme_id uuid, p_amount numeric, p_source text default 'funded')
returns json language plpgsql security definer set search_path = public as $fn$
begin
  if not (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'superadmin'::app_role)) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_token_theme_id is null then raise exception 'token_theme_id required' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be > 0' using errcode = '22023'; end if;
  insert into public.token_pools (token_theme_id, source, balance, total_funded)
  values (p_token_theme_id, coalesce(nullif(p_source, ''), 'funded'), p_amount, p_amount)
  on conflict (token_theme_id) do update
    set balance = public.token_pools.balance + p_amount,
        total_funded = public.token_pools.total_funded + p_amount, updated_at = now();
  return (select row_to_json(t) from (
    select token_theme_id, source, balance, total_funded, total_dispensed
    from public.token_pools where token_theme_id = p_token_theme_id) t);
end;
$fn$;
grant execute on function public.fund_pool(uuid, numeric, text) to authenticated;

-- 3. grant_currency — now pool-aware. funded = hard cap (skip if it can't cover), minted = uncapped
--    game mint (points), no pool = legacy mint.
create or replace function public.grant_currency(p_token_theme_id uuid, p_amount integer, p_client_request_id uuid)
returns json language plpgsql security definer set search_path = public as $fn$
declare v_user_id uuid := auth.uid(); v_is_new boolean; v_new_balance integer; v_pool_source text;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_token_theme_id is null then raise exception 'token_theme_id required' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then raise exception 'Invalid amount %', p_amount using errcode = '22023'; end if;
  if p_client_request_id is null then raise exception 'client_request_id required' using errcode = '22023'; end if;
  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  if not v_is_new then
    select coins into v_new_balance from user_token_balances where user_id = v_user_id and token_theme_id = p_token_theme_id;
    return json_build_object('new_balance', v_new_balance, 'replayed', true);
  end if;
  select source into v_pool_source from token_pools where token_theme_id = p_token_theme_id;
  if v_pool_source = 'funded' then
    update token_pools set balance = balance - p_amount, total_dispensed = total_dispensed + p_amount, updated_at = now()
     where token_theme_id = p_token_theme_id and source = 'funded' and balance >= p_amount;
    if not found then
      select coins into v_new_balance from user_token_balances where user_id = v_user_id and token_theme_id = p_token_theme_id;
      return json_build_object('new_balance', coalesce(v_new_balance, 0), 'credited', 0, 'reason', 'pool_insufficient');
    end if;
  elsif v_pool_source = 'minted' then
    update token_pools set total_dispensed = total_dispensed + p_amount, updated_at = now() where token_theme_id = p_token_theme_id;
  end if;
  update user_token_balances set coins = coins + p_amount, updated_at = now()
   where user_id = v_user_id and token_theme_id = p_token_theme_id returning coins into v_new_balance;
  if v_new_balance is null then raise exception 'Balance row not found' using errcode = '23503'; end if;
  return json_build_object('new_balance', v_new_balance, 'credited', p_amount, 'replayed', false);
end;
$fn$;
grant execute on function public.grant_currency(uuid, integer, uuid) to authenticated;
