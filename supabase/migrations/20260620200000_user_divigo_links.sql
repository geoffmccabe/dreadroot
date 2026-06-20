-- Per-user DiviGo OAuth link. After a player authorizes DreadRoot on the LW-SSO consent screen
-- (/wallet/divi/grant), the SSO mints a per-(user,app) bearer token; the divigo-connect edge function
-- stores it here. sync-holdings then reads the player's AUTHORITATIVE custodial DIVI balance from the
-- SSO OAuth API (proves wallet control via the Telegram link + sees custodial coins the RPC can't).
-- The token is a credential: read by the service role only (edge functions), never by the client.
create table if not exists public.user_divigo_links (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  app_token  text not null,           -- LW-SSO per-(user,app) bearer token (balance:read scope)
  verified   boolean not null default true,
  linked_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_divigo_links enable row level security;

-- Client may read ONLY their own row (to show "Connected"). The token it can see is its own, read-only
-- scope (balance:read — can't move funds; sends need Telegram approval), rotated on re-grant and
-- revocable at the SSO Account→Connections page. No insert/update/delete policy: only the service role
-- (the divigo-connect edge function) writes.
drop policy if exists user_divigo_links_read on public.user_divigo_links;
create policy user_divigo_links_read on public.user_divigo_links for select using (user_id = auth.uid());
