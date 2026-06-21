-- Siege Worlds legacy VIP backfill — identity + looked-up holdings.
--
-- SW users were imported into sw_player_snapshot (archive). Each SW player also has a DiviGo link
-- (telegram_id = their DiviGo account number); we use it to look up their REAL DIVI + LightningWorks
-- Portal NFT (via the SSO partner API) and grant a VIP tier WITHOUT them logging in. When they later
-- connect their own wallet, sync-holdings re-certifies (live data replaces this). DIVI is never copied
-- as spendable — these are gating-only mirrors.
--
-- SELF-CONTAINED: creates the dependency tables if a prior migration hasn't (create-if-not-exists is a
-- no-op when they already exist), so this is safe to run on its own.

-- Dependency tables (skipped if they already exist) ----------------------------------------------

create table if not exists public.user_divigo_links (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  app_token  text,                    -- LW-SSO OAuth bearer (nullable: legacy rows have none)
  verified   boolean not null default true,
  linked_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_divigo_links enable row level security;
drop policy if exists user_divigo_links_read on public.user_divigo_links;
create policy user_divigo_links_read on public.user_divigo_links for select using (user_id = auth.uid());

create table if not exists public.user_external_holdings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  token_theme_id uuid not null references public.token_themes(id) on delete cascade,
  chain          text not null,
  account        text not null,
  amount         numeric not null default 0,
  updated_at     timestamptz not null default now(),
  unique (user_id, token_theme_id, account)
);
alter table public.user_external_holdings enable row level security;
drop policy if exists user_external_holdings_read on public.user_external_holdings;
create policy user_external_holdings_read on public.user_external_holdings for select using (user_id = auth.uid());
create index if not exists user_external_holdings_user_idx on public.user_external_holdings (user_id);

create table if not exists public.user_nft_holdings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  collection   text not null,
  schema_name  text,
  template_id  bigint,
  asset_count  int  not null default 0,
  updated_at   timestamptz not null default now(),
  unique (user_id, collection, schema_name, template_id)
);
alter table public.user_nft_holdings enable row level security;
drop policy if exists user_nft_holdings_read on public.user_nft_holdings;
create policy user_nft_holdings_read on public.user_nft_holdings for select using (user_id = auth.uid());

-- 1. Capture the DiviGo identity + looked-up holdings on the archive row.
alter table public.sw_player_snapshot
  add column if not exists telegram_id        text,
  add column if not exists telegram_confirmed int default 0,
  add column if not exists divi_live          numeric,
  add column if not exists has_portal         boolean,
  add column if not exists holdings_checked_at timestamptz,
  add column if not exists matched_user_id    uuid,
  add column if not exists vip_applied_at     timestamptz;
create index if not exists sw_player_snapshot_email_idx on public.sw_player_snapshot (lower(email));
create index if not exists sw_player_snapshot_matched_user_idx on public.sw_player_snapshot (matched_user_id);

-- 2. Per-user DiviGo identity: hold the legacy DiviGo number even before an interactive OAuth connect.
alter table public.user_divigo_links alter column app_token drop not null;
alter table public.user_divigo_links
  add column if not exists divigo_number text,
  add column if not exists divigo_route  text default 'telegram',
  add column if not exists source        text;

-- 3. Tag holdings by writer so the legacy VIP grant isn't wiped by an unrelated live sync.
alter table public.user_external_holdings add column if not exists source text default 'sync';
alter table public.user_nft_holdings      add column if not exists source text default 'sync';
update public.user_external_holdings set source = 'sync' where source is null;
update public.user_nft_holdings      set source = 'sync' where source is null;

-- 4. Lazy claim: a backfilled SW user who later signs up gets their honorary VIP on first call.
create or replace function public.apply_sw_legacy_vip()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_snap record;
  v_divi_theme uuid;
  v_req record;
  v_now timestamptz := now();
begin
  if v_uid is null then return jsonb_build_object('applied', false, 'reason', 'not authenticated'); end if;
  if exists (select 1 from user_divigo_links where user_id = v_uid and app_token is not null) then
    return jsonb_build_object('applied', false, 'reason', 'already connected');
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then return jsonb_build_object('applied', false, 'reason', 'no email'); end if;

  select * into v_snap from sw_player_snapshot
    where lower(email) = lower(v_email) and holdings_checked_at is not null
    order by coalesce(divi_live, 0) desc limit 1;
  if v_snap.sw_id is null then return jsonb_build_object('applied', false, 'reason', 'no legacy snapshot'); end if;

  select id into v_divi_theme from token_themes where name = 'divi' limit 1;
  select * into v_req from supporter_requirements
    where gate_kind = 'nft' and lower(coalesce(nft_chain, '')) = 'ethereum' and nft_collection is not null limit 1;

  insert into user_divigo_links (user_id, divigo_number, divigo_route, source, updated_at)
    values (v_uid, v_snap.telegram_id, 'telegram', 'sw-legacy', v_now)
    on conflict (user_id) do update set divigo_number = excluded.divigo_number, source = 'sw-legacy', updated_at = v_now;

  if v_divi_theme is not null and coalesce(v_snap.divi_live, 0) > 0 then
    delete from user_external_holdings where user_id = v_uid and token_theme_id = v_divi_theme and account = 'sw-legacy';
    insert into user_external_holdings (user_id, token_theme_id, chain, account, amount, source, updated_at)
      values (v_uid, v_divi_theme, 'divi', 'sw-legacy', v_snap.divi_live, 'sw-legacy', v_now);
  end if;

  if coalesce(v_snap.has_portal, false) and v_req.nft_collection is not null then
    delete from user_nft_holdings where user_id = v_uid and collection = v_req.nft_collection and source = 'sw-legacy';
    insert into user_nft_holdings (user_id, collection, schema_name, template_id, asset_count, source, updated_at)
      values (v_uid, v_req.nft_collection, coalesce(v_req.nft_schema, ''), coalesce(v_req.nft_template_id, 0), 1, 'sw-legacy', v_now);
  end if;

  update sw_player_snapshot set matched_user_id = v_uid, vip_applied_at = v_now where sw_id = v_snap.sw_id;
  return jsonb_build_object('applied', true, 'divi', v_snap.divi_live, 'hasPortal', coalesce(v_snap.has_portal, false));
end $fn$;

grant execute on function public.apply_sw_legacy_vip() to authenticated;
