-- Seed the WAX / Alien Worlds ecosystem into the coin registry: WAX (native), TLM (Trilium), and the
-- 6 planet (Syndicate) coins — EYE/KAV/MAG/NAR/NER/VEL. Symbols are the authoritative ones from
-- LW-SSO (SYNDICATE_PLANETS). Once seeded they appear everywhere token_themes drives: the wallet,
-- Admin > Coins > Pools (fund + deposit address per coin), Admin > Coins > Gates, the monster
-- coin-drop config (assign Trilium drops), and as selectable waterfall coins. Idempotent.
-- Coin images are NOT set here — upload them in the admin (per the no-URL-input rule); a TLM coin
-- image is what makes it fall in the waterfall. See docs/CURRENCY_LEDGER_PLAN.md.
do $seed$
declare
  v_asset uuid;
  rec record;
  coins constant jsonb := '[
    {"sym":"WAX","name":"WAX",    "kind":"coin", "contract":null,           "dec":8, "sort":50},
    {"sym":"TLM","name":"Trilium","kind":"token","contract":"alien.worlds", "dec":4, "sort":51},
    {"sym":"EYE","name":"Eyeke",  "kind":"token","contract":null,           "dec":4, "sort":60},
    {"sym":"KAV","name":"Kavian", "kind":"token","contract":null,           "dec":4, "sort":61},
    {"sym":"MAG","name":"Magor",  "kind":"token","contract":null,           "dec":4, "sort":62},
    {"sym":"NAR","name":"Naron",  "kind":"token","contract":null,           "dec":4, "sort":63},
    {"sym":"NER","name":"Neri",   "kind":"token","contract":null,           "dec":4, "sort":64},
    {"sym":"VEL","name":"Veles",  "kind":"token","contract":null,           "dec":4, "sort":65}
  ]'::jsonb;
begin
  for rec in
    select * from jsonb_to_recordset(coins) as x(sym text, name text, kind text, contract text, dec int, sort int)
  loop
    -- asset (the brand): one per symbol
    select id into v_asset from public.token_assets where symbol = rec.sym;
    if v_asset is null then
      insert into public.token_assets (symbol, display_name, kind, sort_order)
      values (rec.sym, rec.name, rec.kind, rec.sort)
      returning id into v_asset;
    end if;
    -- variant (the per-chain token_theme on WAX)
    if not exists (select 1 from public.token_themes where name = lower(rec.sym)) then
      insert into public.token_themes
        (name, display_name, ticker_symbol, asset_id, network, is_onchain, contract_address, decimals)
      values
        (lower(rec.sym), rec.name, rec.sym, v_asset, 'wax', true, rec.contract, rec.dec);
    end if;
  end loop;
end $seed$;
