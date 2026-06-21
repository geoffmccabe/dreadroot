-- Siege Worlds legacy VIP backfill — identity + looked-up holdings.
--
-- SW users were imported into sw_player_snapshot (archive, keyed by email). Each SW player record also
-- has a DiviGo link (telegram_id = their DiviGo account number). We use that to look up their REAL DIVI
-- balance + LightningWorks Portal NFT server-to-server (via the SSO partner API) and grant a VIP tier —
-- WITHOUT them logging in. When they later connect their own wallet, sync-holdings re-certifies (live
-- data replaces the legacy snapshot). DIVI is never copied as spendable; these are gating-only mirrors.

-- 1. Capture the DiviGo identity + the looked-up holdings on the archive row.
alter table public.sw_player_snapshot
  add column if not exists telegram_id        text,      -- DiviGo account number (route='telegram')
  add column if not exists telegram_confirmed int default 0,  -- 1 = the SW user verified the DiviGo link
  add column if not exists divi_live          numeric,   -- DIVI read from DiviGo at backfill time
  add column if not exists has_portal         boolean,   -- owns a LightningWorks Portal NFT
  add column if not exists holdings_checked_at timestamptz, -- when the DiviGo lookup last ran
  add column if not exists matched_user_id    uuid,      -- resolved Dreadroot auth user (by email), if any
  add column if not exists vip_applied_at     timestamptz; -- when the VIP holdings were written to that user

create index if not exists sw_player_snapshot_email_idx on public.sw_player_snapshot (lower(email));
create index if not exists sw_player_snapshot_matched_user_idx on public.sw_player_snapshot (matched_user_id);

-- 2. Per-user DiviGo identity in Dreadroot. user_divigo_links already holds the OAuth bearer (app_token);
--    extend it to also hold the legacy DiviGo number so a user can be re-checked or re-certified, even
--    before they do the interactive OAuth connect. app_token becomes optional (legacy rows have none).
alter table public.user_divigo_links alter column app_token drop not null;
alter table public.user_divigo_links
  add column if not exists divigo_number text,            -- DiviGo account number (telegram id)
  add column if not exists divigo_route  text default 'telegram',
  add column if not exists source        text;            -- 'oauth' | 'sw-legacy'

-- 3. Tag holdings by who wrote them, so the legacy VIP grant isn't wiped by an unrelated live sync.
--    sync-holdings owns source='sync' rows; the legacy backfill writes source='sw-legacy'. Default is
--    'sync' (and existing rows are backfilled to 'sync') so sync's scoped delete — neq 'sw-legacy',
--    which in SQL excludes NULLs — cleans every live row but leaves legacy intact. Legacy survives
--    until the user re-certifies (a real DiviGo connect clears it; then live data takes over).
alter table public.user_external_holdings add column if not exists source text default 'sync';
alter table public.user_nft_holdings      add column if not exists source text default 'sync';
update public.user_external_holdings set source = 'sync' where source is null;
update public.user_nft_holdings      set source = 'sync' where source is null;

-- 4. Lazy claim: when a SW user who was backfilled (holdings already looked up) later signs up for a
--    Dreadroot account with the same email, this grants their honorary VIP on first call. Idempotent;
--    skips anyone who has already connected their own DiviGo (app_token present) — they're self-certified.
create or replace function public.apply_sw_legacy_vip()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_snap record;
  v_divi_theme uuid;
  v_req record;
  v_now timestamptz := now();
begin
  if v_uid is null then return jsonb_build_object('applied', false, 'reason', 'not authenticated'); end if;
  -- Already self-certified via OAuth connect → nothing to do.
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
end $$;

grant execute on function public.apply_sw_legacy_vip() to authenticated;
