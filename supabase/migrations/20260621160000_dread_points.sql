-- Dread Points (DP) — the universal in-game point currency, + a conversions config so any currency
-- (USD or crypto) can be priced into points manually or algorithmically. See docs/DREAD_POINTS_PLAN.md.
-- A "point system" is just a token_asset with kind='points' (DP, later $PINK, $SIEGE), with an internal
-- token_theme variant + a minted pool. Spendable balances live in user_token_balances like any coin.

-- 1. USD value of 1 unit of an asset — drives algorithmic conversions (points_out = amount * src.usd_price / dp.usd_price).
alter table public.token_assets add column if not exists usd_price numeric;

-- 2. Seed the DP brand (sort first), its internal theme, and a minted (uncapped faucet) pool.
insert into public.token_assets (symbol, display_name, kind, usd_price, sort_order, is_active)
  select 'DP', 'Dread Points', 'points', 0.0001, -10, true
  where not exists (select 1 from public.token_assets where symbol = 'DP');

insert into public.token_themes (name, display_name, ticker_symbol, network, is_active, asset_id)
  select 'dread_points', 'Dread Points', 'DP', 'internal', true, a.id
  from public.token_assets a
  where a.symbol = 'DP' and not exists (select 1 from public.token_themes where name = 'dread_points');

insert into public.token_pools (token_theme_id, source, balance)
  select t.id, 'minted', 0
  from public.token_themes t
  where t.name = 'dread_points' and not exists (select 1 from public.token_pools p where p.token_theme_id = t.id);

-- 3. Conversions INTO a point system. from_asset_id NULL = USD (fiat). Rate semantics (resolved in app):
--    mode='algorithmic' → points per 1 source unit = source.usd_price / point.usd_price (USD source = 1).
--    mode='manual'      → points per 1 source unit = manual_rate.
create table if not exists public.currency_conversions (
  id            uuid primary key default gen_random_uuid(),
  to_asset_id   uuid not null references public.token_assets(id) on delete cascade,  -- the point system (DP)
  from_asset_id uuid references public.token_assets(id) on delete cascade,           -- NULL = USD
  mode          text not null default 'algorithmic' check (mode in ('algorithmic','manual')),
  manual_rate   numeric,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (to_asset_id, from_asset_id)
);
-- nullable from_asset_id ⇒ enforce a single USD row per point system explicitly.
create unique index if not exists currency_conversions_usd_uidx
  on public.currency_conversions (to_asset_id) where from_asset_id is null;

alter table public.currency_conversions enable row level security;
drop policy if exists currency_conversions_read on public.currency_conversions;
create policy currency_conversions_read on public.currency_conversions for select using (true);
drop policy if exists currency_conversions_admin on public.currency_conversions;
create policy currency_conversions_admin on public.currency_conversions for all
  using (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'superadmin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'superadmin'::app_role));

-- 4. Default USD → DP conversion (algorithmic) so it shows up out of the box.
insert into public.currency_conversions (to_asset_id, from_asset_id, mode, enabled)
  select a.id, null, 'algorithmic', true from public.token_assets a
  where a.symbol = 'DP'
    and not exists (select 1 from public.currency_conversions c where c.to_asset_id = a.id and c.from_asset_id is null);
