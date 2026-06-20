-- External (on-chain) token holdings mirror — populated by the sync-wax-holdings edge function from
-- the player's real wallet. This is SEPARATE from user_token_balances on purpose: user_token_balances
-- is the pool-backed, SPENDABLE in-game balance; writing real on-chain amounts there would let a
-- player spend/withdraw the pool. This table is read-only gating evidence (supporter requirements /
-- token gates) — never spendable. See docs/SUPPORTER_TIERS_PLAN.md.
create table if not exists public.user_external_holdings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  token_theme_id uuid not null references public.token_themes(id) on delete cascade,
  chain          text not null,             -- 'wax' | 'ethereum' | …
  account        text not null,             -- the on-chain account/address the amount was read from
  amount         numeric not null default 0,
  updated_at     timestamptz not null default now(),
  unique (user_id, token_theme_id, account)
);

alter table public.user_external_holdings enable row level security;

-- Read own only. There is intentionally NO insert/update/delete policy: only the service role (the
-- sync edge function) writes, which bypasses RLS. Mirrors the locked-down user_token_balances pattern.
drop policy if exists user_external_holdings_read on public.user_external_holdings;
create policy user_external_holdings_read on public.user_external_holdings for select using (user_id = auth.uid());

create index if not exists user_external_holdings_user_idx on public.user_external_holdings (user_id);
