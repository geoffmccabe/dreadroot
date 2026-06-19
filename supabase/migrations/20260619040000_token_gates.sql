-- Token-gating + NFT holdings. The game grants bonuses / access when a user holds enough of a token
-- (e.g. TLM/Trilium, an Alien Worlds planet coin) or the right Wax NFT. Balances live in
-- user_token_balances (synced from LW-SSO); NFTs live in user_nft_holdings (synced from LW-SSO /
-- Wax AtomicAssets). Gates are admin-authored rules evaluated against those holdings.
-- See docs/CURRENCY_LEDGER_PLAN.md.

-- 1. A user's Wax NFT holdings (AtomicAssets-shaped), mirrored from LW-SSO/Wax. Read-only mirror —
--    only the sync (service role / SECURITY DEFINER) writes it.
create table if not exists public.user_nft_holdings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  collection   text not null,                 -- e.g. 'alien.worlds'
  schema_name  text,                          -- AtomicAssets schema (nullable = any)
  template_id  bigint,                        -- AtomicAssets template (nullable = any)
  asset_count  int  not null default 0,       -- how many the user owns
  updated_at   timestamptz not null default now(),
  unique (user_id, collection, schema_name, template_id)
);
alter table public.user_nft_holdings enable row level security;
drop policy if exists user_nft_holdings_read on public.user_nft_holdings;
create policy user_nft_holdings_read on public.user_nft_holdings for select using (user_id = auth.uid());
-- no client write policy → only SECURITY DEFINER sync functions write it.

-- 2. Admin-authored gate rules: hold >= min of a token, OR own >= N matching NFTs → a named bonus.
create table if not exists public.token_gates (
  id              uuid primary key default gen_random_uuid(),
  game            text,                        -- null = applies to every game
  name            text not null,
  gate_kind       text not null check (gate_kind in ('token','nft')),
  -- token gate:
  token_theme_id  uuid references public.token_themes(id) on delete cascade,
  min_amount      numeric not null default 0,
  -- nft gate:
  nft_collection  text,
  nft_schema      text,
  nft_template_id bigint,
  nft_min_count   int not null default 1,
  -- payoff:
  bonus_key       text not null,              -- e.g. 'damage_mult', 'xp_mult', 'access:vault'
  bonus_value     numeric not null default 0,
  is_active       boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.token_gates enable row level security;
drop policy if exists token_gates_read on public.token_gates;
create policy token_gates_read on public.token_gates for select using (true);   -- clients evaluate gates
drop policy if exists token_gates_admin_write on public.token_gates;
create policy token_gates_admin_write on public.token_gates for all
  using (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'superadmin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'superadmin'::app_role));
