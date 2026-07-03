-- Tag the origin of a Vault/inventory slot so the Siege Worlds legacy item
-- claim (sw-claim-items edge function) can re-sync idempotently: it only ever
-- clears and rebuilds rows where source = 'sw-legacy', never native rows
-- (source IS NULL). This same tag is the boundary Phase 2 needs to back-fill
-- native DreadRoot/SWW items up to the unified MongoDB.
--
-- Additive + nullable: existing rows stay NULL (= native), no data change.

alter table public.user_slots
  add column if not exists source text;

-- Speeds up the per-login "delete this user's sw-legacy rows" reconcile
-- (region-agnostic: user_id + source).
create index if not exists user_slots_user_source_idx
  on public.user_slots (user_id, source);
