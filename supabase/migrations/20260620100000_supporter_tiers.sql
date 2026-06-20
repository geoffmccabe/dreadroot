-- Supporter tiers (VIP / VIP Demi-God / VIP God) — token/NFT-gated OR paid monthly subscription.
-- Standalone tiers (no inheritance). Per-requirement AND/OR. Per-benefit cadence. Phase 1 = config +
-- panels only; benefits are NOT wired into gameplay yet. See docs/SUPPORTER_TIERS_PLAN.md.

-- 1. The 3 tiers above Ordinary.
create table if not exists public.supporter_tiers (
  id          uuid primary key default gen_random_uuid(),
  level       int  not null unique check (level between 1 and 3),  -- 1=VIP, 2=Demi-God, 3=God
  name        text not null,
  monthly_usd numeric not null default 0,                          -- subscription price (USD; paid in crypto/cash)
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
insert into public.supporter_tiers (level, name, sort_order) values
  (1, 'VIP', 1), (2, 'VIP Demi-God', 2), (3, 'VIP God', 3)
on conflict (level) do nothing;

-- 2. Requirements per tier — reuse the gate shape. match_mode is the per-row OR/AND switch:
--    'or'  = meeting THIS one alone qualifies; 'and' = part of the must-meet-all set.
--    A tier qualifies by holdings if (any 'or' req met) OR (all 'and' reqs met). Paying always also qualifies.
create table if not exists public.supporter_requirements (
  id              uuid primary key default gen_random_uuid(),
  tier_id         uuid not null references public.supporter_tiers(id) on delete cascade,
  match_mode      text not null default 'or' check (match_mode in ('or','and')),
  gate_kind       text not null check (gate_kind in ('token','nft')),
  token_theme_id  uuid references public.token_themes(id) on delete cascade,
  min_amount      numeric not null default 0,
  nft_collection  text,
  nft_schema      text,
  nft_template_id bigint,
  nft_min_count   int not null default 1,
  label           text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

-- 3. Benefits per tier. value_type: count | percent | toggle. cadence: once | monthly | persistent (per benefit).
create table if not exists public.supporter_benefits (
  id          uuid primary key default gen_random_uuid(),
  tier_id     uuid not null references public.supporter_tiers(id) on delete cascade,
  benefit_key text not null,                                  -- e.g. tree_seeds, fortress_seeds, eggs, chest_keys, blocks, rocket_boots, glide_power
  value_type  text not null default 'count' check (value_type in ('count','percent','toggle')),
  value       numeric not null default 0,
  cadence     text not null default 'monthly' check (cadence in ('once','monthly','persistent')),
  enabled     boolean not null default true,
  note        text,                                           -- e.g. a block type
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- 4. A user's subscription record (the "pay instead of own on-chain" path). Written by the payment
--    flow (Phase 4) / admin; the client only reads its own. Effective = active row with paid_until > now.
create table if not exists public.user_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  tier_id     uuid not null references public.supporter_tiers(id) on delete cascade,
  status      text not null default 'pending' check (status in ('active','pending','cancelled','expired')),
  paid_until  timestamptz,
  method      text,                                           -- 'crypto' | 'cash' | 'manual'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS: tiers/requirements/benefits are world-readable (the user panel shows them); admin writes.
-- Subscriptions: a user reads only their own; writes go through SECURITY DEFINER / admin (no direct client write).
do $$
declare t text;
begin
  foreach t in array array['supporter_tiers','supporter_requirements','supporter_benefits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (true)', t, t);
    execute format('drop policy if exists %I_admin on public.%I', t, t);
    execute format($f$create policy %I_admin on public.%I for all
      using (public.has_role(auth.uid(),'admin'::app_role) or public.has_role(auth.uid(),'superadmin'::app_role))
      with check (public.has_role(auth.uid(),'admin'::app_role) or public.has_role(auth.uid(),'superadmin'::app_role))$f$, t, t);
  end loop;
end $$;

alter table public.user_subscriptions enable row level security;
drop policy if exists user_subscriptions_read on public.user_subscriptions;
create policy user_subscriptions_read on public.user_subscriptions for select using (user_id = auth.uid());
drop policy if exists user_subscriptions_admin on public.user_subscriptions;
create policy user_subscriptions_admin on public.user_subscriptions for all
  using (public.has_role(auth.uid(),'admin'::app_role) or public.has_role(auth.uid(),'superadmin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role) or public.has_role(auth.uid(),'superadmin'::app_role));
