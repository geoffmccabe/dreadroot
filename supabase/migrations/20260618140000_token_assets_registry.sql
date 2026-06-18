-- Slice 1 — multi-coin registry split: an ASSET parent above the existing per-chain token_themes.
-- token_themes stays the per-(asset,chain) VARIANT (it already holds chain_id/contract/rpc). This
-- adds token_assets (the brand: DIVI, USDT, points…) and links each existing theme to one.
-- Behaviour-neutral: balances/pools/spend untouched. See docs/CURRENCY_LEDGER_PLAN.md.

-- 1. Asset parent (the brand / logical currency).
create table if not exists public.token_assets (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null,
  display_name  text not null,
  kind          text not null default 'coin' check (kind in ('coin','token','points','stablecoin')),
  logo_url      text,
  color_palette jsonb,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 2. token_themes becomes the per-chain VARIANT of an asset.
alter table public.token_themes
  add column if not exists asset_id   uuid references public.token_assets(id),
  add column if not exists network    text    not null default 'internal',
  add column if not exists is_onchain boolean not null default false,
  add column if not exists decimals   int     not null default 18;

-- 3. Seed: one asset per existing theme (1:1 for now — USDT-style multi-chain grouping happens when
--    you later point several themes at the same asset). Carry brand + chain facts across.
do $$
declare t record; a uuid;
begin
  for t in select * from public.token_themes where asset_id is null loop
    insert into public.token_assets (symbol, display_name, kind, logo_url, color_palette, is_active)
    values (coalesce(nullif(t.ticker_symbol, ''), upper(t.name)), t.display_name, 'coin',
            t.coin_image_url, t.color_palette, t.is_active)
    returning id into a;
    update public.token_themes set
      asset_id   = a,
      network    = coalesce(nullif(t.blockchain, ''), 'internal'),
      is_onchain = (t.contract_address is not null and t.contract_address <> '')
    where id = t.id;
  end loop;
end $$;

-- 4. RLS: anyone can read the registry (wallet UI needs it); writes are admin-only.
alter table public.token_assets enable row level security;

drop policy if exists token_assets_read on public.token_assets;
create policy token_assets_read on public.token_assets for select using (true);

drop policy if exists token_assets_admin_write on public.token_assets;
create policy token_assets_admin_write on public.token_assets for all
  using (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'superadmin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'superadmin'::app_role));
