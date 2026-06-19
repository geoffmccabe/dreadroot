-- A user's linked external wallet account per chain (e.g. their Wax account, learned from LW-SSO
-- when they connect their Wax Cloud Wallet in the embedded wallet iframe). Used to build the iframe
-- URL (?account=…) and as the lookup key for the server-side holdings sync. This is just the public
-- account string; token-gating reads server-verified holdings, never this. See
-- docs/WAX_WALLET_IFRAME_PLAN.md.
create table if not exists public.user_wallet_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  chain      text not null,                 -- 'wax', 'eth', …
  account    text not null,                 -- the public account/address on that chain
  linked_at  timestamptz not null default now(),
  unique (user_id, chain)
);

alter table public.user_wallet_links enable row level security;
drop policy if exists user_wallet_links_rw on public.user_wallet_links;
-- A user manages only their own links (public account string; display-only — gating is server-verified).
create policy user_wallet_links_rw on public.user_wallet_links for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
