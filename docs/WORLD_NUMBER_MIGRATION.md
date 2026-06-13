# Phase 1 Runbook — `placed_blocks.world_id` (UUID) → `world_number` (int)

> Self-prompt for the migration. Read top-to-bottom before touching anything.
> Sibling phases (do NOT start until Phase 1 is fully landed): Phase 2 = player catalogue +
> `user_id`→`player_number`; Phase 3 = drop `id`. This doc covers ONLY world_id.

## STATUS (2026-Jun-13)
**Phase 1A COMPLETE + verified, BOTH games.** Every `placed_blocks` row carries `world_number`
(DreadRoot: 1,334,388 in world 1 "Default World" + 13 in world 2 "Magor"; Pinkland: world 3
backfilled to 0 NULLs). `worlds.world_number` assigned (1=Default World, 2=Magor, 3=Pinkland;
sequence ready for #4 onward). Fill trigger `trg_fill_block_world_number` active. Index
`placed_blocks_worldnum_chunk_idx` built + confirmed used (Index Scan, not Seq Scan). Game still
runs 100% on `world_id` — zero behavior change, zero risk at this checkpoint.
**1B READS — DONE on DreadRoot (v4.24.10) + both fetch RPCs (shared SQL).** Audit correction:
the original inventory undercounted the client reads. The COMPLETE set of `placed_blocks`-by-world
READ sites, all now on `world_number` via `src/lib/worldNumber.ts::resolveWorldNumber` (world_id
fallback during transition):
  - `lib/chunkFetch.ts` :122 (radius load) + :260 (per-chunk fallback)
  - `hooks/useChunkLoader.ts` :1746 (single-chunk REFETCH) ← was missed
  - `hooks/usePlacedBlocksWithCache.ts` :388 (chunk→IndexedDB sync) ← was missed
  - `components/WorldsList.tsx` :349 (admin diag count) ← was missed
  - `features/god-map/hooks/useGodMap.ts` :83 (density) ← was missed
  - SQL RPCs `fetch_chunks_cached` + `fetch_chunks_batch` (translate p_world_id→world_number internally)
Clean / out of scope: `Fortress.tsx:1231` + `worldStore.ts:1080` delete BY id; `useChunkLoader:844`
= chunk_versions; `useGodMap` paint/erase = world_no_plant_chunks; `useTreeData:102` = tree_blueprints;
`pondBlockGenerator` = no DB (dynamic). Pinkland client read-switch still TODO before the drop.

**1B WRITES + DROP — NOT STARTED (irreversible).** Remaining `world_id` write/constraint surface:
  - `services/worldStore.ts` :952 — direct upsert `world_id` + `onConflict 'world_id,position_*'` ← switch
  - in-memory optimistic blocks `usePlacedBlocksWithCache` :509/:572 set `world_id` (local only, not a DB
    write — harmless, but set `world_number` too for cleanliness)
  - SQL: 12 fns `ON CONFLICT (world_id, position…)`; version-bump triggers read `world_id`; the
    `UNIQUE(world_id, position…)` constraint; `placed_blocks_world_fk`.
  - Then `DROP COLUMN world_id`. Coordinate AFTER both games' clients are on world_number.

**NEXT: Phase 1B writes+drop — its own focused, tested session. Do NOT drop `world_id` until BOTH
games' clients are switched to `world_number` (the column drop is shared across both games).**

## Objective & honest framing
Replace the 36-char world UUID on every `placed_blocks` row with a 4-byte integer
(`world_number`). Saves ~31 chars/row on the wire + ~12 bytes/row on disk + the matching JS
string memory. **This is a load/memory win, NOT an FPS win** — the renderer never reads
`world_id` per frame. The benefit only materializes **after `world_id` is dropped** (Phase 1B
final step); until then rows carry both columns and are temporarily *larger*.

**Risk reality:** `world_id` is the partition key of the whole chunk-cache system
(`chunk_blobs`, the fetch RPCs, the version-bump triggers, the unique key, 12 ON CONFLICTs).
This is the DEEPEST of the three uuid changes, not the shallowest. Phase 1A is safe/additive
and reversible; Phase 1B is the careful part.

## Locked decisions
- `world_number` lives on **`placed_blocks` only**. `worlds` GAINS `world_number` but KEEPS its
  UUID `id` PK (many FKs depend on it). `chunk_versions`, `chunk_blobs` (its own key),
  `planted_trees`, ponds, chat, netcode tables all KEEP `world_id` UUID. We only swap the
  per-block reference on the huge table.
- Type: Postgres `integer` (4 bytes, up to 2.1B; `smallint` caps at 32,767 — too small for the
  100k-world target). New worlds auto-assign from a sequence.
- Shared Supabase: schema steps hit BOTH games. Backfills are game-scoped (DreadRoot first).
  Client edits are per-repo (DreadRoot first, then port to Pinkland).

---

## COMPLETE SURFACE INVENTORY (from the code scan — keep this list authoritative)

### A. Database — `placed_blocks` structure
- PK: **`id UUID DEFAULT gen_random_uuid() PRIMARY KEY`** (Phase 3 drops this).
- Natural/unique key: **`UNIQUE (world_id, position_x, position_y, position_z)`**
  (defined 20260117193750, re-declared 20260120162956). ← must become `world_number,…`.
- FK: **`placed_blocks_world_fk`** → `worlds(id)` (20260116234525). ← drop/replace on cutover.
- Index used by load filter: `(world_id, chunk_x, chunk_z)` (need the `world_number` twin).

### B. Database — functions with `ON CONFLICT (world_id, position_x, position_y, position_z)`
**12 files.** All INSERT tree/placed blocks. Each must switch its conflict target to
`(world_number, …)` when the unique key changes. Current/authoritative bodies live in the
latest of each:
- `process_tree_growth`, `finalize_tree`, `regrow_tree` (latest: 20260613000000 + 20260612000000)
- `plant_seed_with_blueprint` (20260523020000 — creates tree+blueprint rows; does NOT insert blocks)
- block-placement RPC `place_*` / mine block (20260606200000_track1b_place_mine_block)
- sync/backfill helpers (20260126100000, 20260611000000), older growth defs (superseded — ignore)
> Re-grep before editing: `grep -rl 'ON CONFLICT (world_id, position' supabase/migrations` and
> only touch the LATEST definition of each live function.

### C. Database — version-bump triggers (THE big watch-out)
Statement-level, transition-table triggers on `placed_blocks`
(`20260205221000_fix_chunk_version_trigger_batching.sql`):
`trg_chunk_versions_batch_insert/update/delete`. They read **`world_id` from the
new_rows/old_rows transition tables** and bump `chunk_versions (world_id, chunk_x, chunk_z)`.
**If `world_id` is dropped, these break** — live block edits would stop refreshing chunks.
On cutover they must map `world_number → worlds.id` (cheap join, few worlds) to keep bumping
`chunk_versions` (which stays UUID-keyed). Older duplicate triggers (20260117014500,
20260117023746, 20250923133256 updated_at) — verify which are still active; don't double-bump.

### D. Database — chunk_blobs cache + fetch RPCs
`20260606250000_track3_chunk_blobs_cache.sql`:
- `chunk_blobs` PK `(world_id, chunk_x, chunk_z)` — KEEP as-is (one row per chunk, cheap; not
  the win). Do NOT migrate its key in Phase 1.
- The lazy blob builder inside the fetch path does
  `FROM placed_blocks pb WHERE pb.world_id = p_world_id` — **this filter must switch to
  `world_number`** when `world_id` is dropped (and to use the new index before then for speed).
- Blob per-block projection: `id, user_id, position_x/y/z, block_type, texture_url, expires_at,
  chunk_x, chunk_z` — note it does NOT carry per-block `world_id`, so the BLOB CONTENT is
  unaffected by Phase 1 (it IS affected by Phases 2/3 — dropping user_id/id changes the
  projection and requires a blob rebuild then).
- RPCs `fetch_chunks_cached`, `fetch_chunks_batch` (defs: 20260328000000, 20260517000000,
  20260606250000) take `p_world_id UUID`. Keep the UUID param as the external interface;
  translate to `world_number` internally for the `placed_blocks` scan. Client RPC calls stay
  unchanged → less client churn.

### E. Client — files that touch `placed_blocks` (in scope)
- `src/lib/chunkFetch.ts` — direct `.eq('world_id', worldId)` at the radius-load (~:106) and the
  per-chunk fallback (~:90); RPC calls pass `p_world_id`. ← switch direct filters to
  `world_number`; thread the current world's number in.
- `src/hooks/usePlacedBlocksWithCache.ts` — writes player blocks with `world_id` (~:508/:571);
  realtime is on `chunk_versions` (NOT placed_blocks rows). The INSERT trigger (Phase 1A.2) fills
  `world_number`, so writes don't strictly need changing until the cutover, but should set it.
- `src/hooks/useChunkLoader.ts` — block ops, collider lifecycle, cache reads.
- `src/services/worldStore.ts` — deletes a block by `id` (~:1080); world-delete cascade.
- `src/features/god-map/hooks/useGodMap.ts` — reads `placed_blocks` (~:83). Verify its world filter.
- `src/components/fortress/Fortress.tsx` — `placed_blocks` query (~:1231). Verify filter.
- `src/components/WorldsList.tsx` — world create/delete (may bulk-delete placed_blocks).
- `src/features/trees/hooks/useTreeData.ts` — reads placed_blocks for tree data. Verify filter.
- `src/lib/pondBlockGenerator.ts` — inserts pond blocks (covered by the fill trigger).
- `src/lib/blockDB.ts` + `src/hooks/useIndexedDB.ts` — IndexedDB chunk cache.
- `src/integrations/supabase/types.ts` — add `world_number` (use the existing `as never/any` cast
  pattern; types are already stale, don't regenerate).
- IGNORE the `*- old.ts/tsx` dead files.

### F. Client — caches & serialization
- **IndexedDB (`blockDB.ts`)**: chunk cache key is the string `"worldId:chunkX:chunkZ"` and an
  index on `worldId`. This is a CLIENT-side key — it can keep using the world UUID string
  regardless of the DB column. BUT cached chunk rows currently include `world_id` (from
  `select('*')`/blob). On cutover, **bump the IndexedDB store version to flush stale cached
  chunks** (the cached blocks won't have `world_number`, or will still carry the dropped
  `world_id`). Find the DB `version`/upgrade in `blockDB.ts` and bump it as part of 1B.
- `src/lib/chunkDelta.ts` — in-memory delta key `${worldId}|pos`; client-side string, no DB
  coupling. Leave as the UUID string (or switch — cosmetic).
- `src/lib/snapshotBinary.ts` — netcode binary protocol already uses **`worldId: number` (u32)**.
  Separate system (entity snapshots, not placed_blocks) — do NOT conflate — but it confirms a
  numeric world id is already a direction in the codebase; consider reconciling `world_number`
  with the netcode numeric world id later so there's ONE world numbering.

---

## PHASE 1A — additive groundwork (SAFE, reversible, zero app impact)
Run in the Supabase SQL editor. Nothing reads `world_number` yet; `world_id` stays; `select('*')`
keeps working. Order matters: column+trigger BEFORE backfill so in-flight inserts get filled.

1. **worlds.world_number + auto-assign**
   - `ALTER TABLE worlds ADD COLUMN IF NOT EXISTS world_number int;`
   - backfill by `row_number() OVER (ORDER BY created_at, id)`.
   - `CREATE SEQUENCE worlds_world_number_seq OWNED BY worlds.world_number;`
     `setval(..., max(world_number));`
     `ALTER COLUMN world_number SET DEFAULT nextval(...)`.
   - `CREATE UNIQUE INDEX worlds_world_number_key ON worlds(world_number);`
2. **placed_blocks.world_number column** — `ALTER TABLE placed_blocks ADD COLUMN IF NOT EXISTS world_number int;` (instant, metadata only).
3. **fill trigger** — `BEFORE INSERT`, `IF NEW.world_number IS NULL THEN SELECT … FROM worlds WHERE id = NEW.world_id`. Covers every writer (growth SQL, client, ponds) during the backfill. Per-insert cost is irrelevant to FPS (inserts aren't per-frame).
4. **batched backfill, DreadRoot first, click-til-zero** — `WHERE world_number IS NULL AND world_id IN (SELECT id FROM worlds WHERE game='dreadroot') LIMIT 100000`, returning `count(*) AS filled`. Repeat until 0. (Bottleneck step — huge table. Same flow as the texture_url cleanup. If it times out, lower LIMIT; or `SET statement_timeout='300s'`.)
5. **future-filter index (AFTER backfill so it builds over populated data)** —
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS placed_blocks_worldnum_chunk_idx ON placed_blocks(world_number, chunk_x, chunk_z);`
   ⚠ CONCURRENTLY cannot run inside a transaction — run it ALONE. On a huge table it builds in
   the background but the editor call waits → may need the raised-timeout / direct-connection route.

**1A watch-outs**
- Do steps 2+3 before 4 (so rows inserted during the long backfill aren't left NULL).
- 1A is fully reversible: `DROP TRIGGER`, `DROP COLUMN world_number` — nothing depends on it yet.
- After 1A: `SELECT count(*) FROM placed_blocks WHERE world_number IS NULL AND world_id IN (dreadroot worlds)` must be 0 before considering 1B.
- Pinkland backfill is a separate run (`game='pinkland'`) whenever we stage it.

---

## PHASE 1B — the cutover (HIGH-CARE; only after 1A verified on the target game)
Each placed_blocks read/write must use `world_number`, THEN drop `world_id`. The benefit lands
at the drop. Suggested order (reads first so nothing breaks while `world_id` still exists):

1. **fetch RPCs** (`fetch_chunks_cached`, `fetch_chunks_batch`, blob builder): keep `p_world_id`
   UUID param; internally resolve `world_number` once and filter `placed_blocks` by it (uses the
   new index). Client RPC calls unchanged.
2. **chunkFetch.ts direct queries**: `.eq('world_id', worldId)` → `.eq('world_number', n)`. Thread
   `world_number` from world-load. **DreadRoot client first.**
3. **World load**: add `world_number` to the `worlds` select in `useWorlds`/`useCurrentWorldId`,
   carry it in world state, pass to chunkFetch.
4. **Writes**: client + growth SQL set `world_number` directly (trigger still backstops).
5. **Switch the unique key**: add `UNIQUE (world_number, position_x, position_y, position_z)`;
   update the **12 functions' `ON CONFLICT (world_id, position…)` → `(world_number, position…)`**;
   then drop the old `UNIQUE (world_id, …)`. (Add the new unique index BEFORE editing ON CONFLICTs.)
6. **Version-bump triggers** (C): rewrite `trg_chunk_versions_batch_*` to derive `world_id` via
   `JOIN worlds ON world_number` (or read a still-present `world_id`) so `chunk_versions` keeps
   getting bumped. **Verify live block placement still refreshes the chunk after this.**
7. **IndexedDB**: bump `blockDB.ts` store version to flush stale cached chunks.
8. **Drop `world_id`**: `ALTER TABLE placed_blocks DROP COLUMN world_id;` (also drops
   `placed_blocks_world_fk`). ← payload/memory win realized here. Do LAST, after 1–7 verified on
   BOTH games (the function/trigger/RPC changes are shared SQL).

**1B watch-outs / failure modes**
- **Reads before drop:** every `placed_blocks` filter (RPCs, blob builder, chunkFetch direct,
  useGodMap/Fortress/useTreeData if they filter by world) MUST be on `world_number` before the
  DROP, or those queries 500 instantly.
- **Version-bump triggers are the silent killer:** if missed, block edits stop refreshing chunks
  (no error — just stale world). Test placing/removing a block and watch the chunk update.
- **Shared SQL = both games at once** for steps 1,5,6,8. Stage CLIENT (2,3,4,7) DreadRoot-first;
  but once `world_id` is dropped, Pinkland's client MUST already be on `world_number` too →
  coordinate the drop to AFTER both clients ship. Safer: keep `world_id` until both games'
  clients are cut over.
- **chunk_blobs staleness:** changing the blob builder's projection isn't needed for Phase 1
  (blob has no per-block world_id), but bumping `chunk_versions`/rebuilding blobs may be prudent
  if anything in the projection shifts. For Phase 1, no blob rebuild required.
- **types.ts:** add `world_number`, keep `world_id` until the drop; use existing cast pattern.

## Verification checklist (run per game after 1B)
- Load a world → chunks render (RPC + direct paths) using `world_number`.
- Place a block → it persists AND the chunk refreshes (version-bump trigger OK).
- Tree growth still places blocks (ON CONFLICT targets OK).
- `EXPLAIN` a chunk fetch → uses `placed_blocks_worldnum_chunk_idx` (not a seq scan).
- Row size dropped (compare `pg_column_size` before/after the world_id drop).

## Rollback
- 1A: drop trigger + column. Clean.
- 1B before the DROP: revert client + SQL function edits (git); the `world_id` column still exists
  so old code works.
- 1B after the DROP: only forward — re-add `world_id` + backfill from `world_number`+worlds. Avoid
  needing this by dropping `world_id` only once everything green on both games.
