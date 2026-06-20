# Named Worlds / Player-Built Maps — persistence + authority contract

How Starblink and every player-made map MUST persist so they're lightweight, durable,
and slot into the Cloudflare Durable Object (L123) plan with zero rework. Read this
before building the terrain brush (1D), save/load (1E), or the drop-in builder (Phase 3).

Audited 2026-Jun against [[project_dreadroot_layered_architecture_plan_v2]] + live code.

## The one rule: a "named map" IS a `worlds` row

There is already a DB-backed multi-world system (`worlds` table, `useWorlds` /
`useCurrentWorldId`, blocks scoped by `placed_blocks.world_id`). DreadRoot uses it;
Siege currently bypasses it with a hardcoded `SIEGE_WORLDS` TS registry
(`gameRegistry.worldsTableKey = null`). **Converge them.** A named map is a row in
`worlds`, and its `id` is the single identifier that:

- scopes all content (`placed_blocks.world_id`, the future object-placement table, terrain chunks),
- keys the L2 Durable Object instance (`?instance=<id>` → `idFromName`),
- selects the rendered map (`WorldDefinition` resolved by that id).

The `WorldDefinition` interface is the in-code shape of that row (now carries
`gameId`, `ownerId`, `wireId`, `bounds`, `spawn`, `ground`, `water`). The TS registry
(`SIEGE_WORLDS`) is the BOOTSTRAP/default seed; the loader swaps to the `worlds` table
behind the same `getWorldDefinition(id)` call (one swap point, async-ready) at 1E.

## Schema work required (NOT yet applied — shared DB, run by hand)

The `worlds` table is shared across DreadRoot/Pinkland/Siege. Changes hit all games —
coordinate + bump cache in each repo. Needed before player maps persist:

1. **Add `game` column** to `worlds`. ⚠️ Code already queries `.eq('game', …)`
   (`useWorlds.ts`) but the column was never migrated — latent bug; DreadRoot only
   works because the filter currently no-ops/falls back. Add it + index.
2. **Add `owner_id`** (uuid, null = org-owned). "Anyone can build" needs an owner.
3. **Fix `bounds`** — today it's a single nullable `INTEGER` (misplaced half-extent).
   Make it `jsonb {minX,maxX,minZ,maxZ}` (or 4 ints). Spatial-bounds checks in every
   write RPC read this — NEVER inline coord literals (Track 7 forward-compat).
4. **Add `spawn`** jsonb `{x,y,z,yaw}`, and a `definition` jsonb for siege ground/water/
   terrain-ref (or reuse existing texture/pond columns + a `ground_kind`).
5. **New `world_object_placements` table** for player-placed glTF objects/monsters:
   `(id, world_id, object_id, registry_origin, x,y,z, rot, scale, owner_id, created_at)`.
   This is DISTINCT from voxel `placed_blocks` and from SWW's static
   `/siege/world/placements.json` (a baked, non-world-scoped export — fine for the
   built-in SWW map, wrong for player maps).

## Authority — every build action is a server-validated RPC

"Anyone can build" must not repeat the `grant_*` client-trusted mistake. Each
terrain-edit / object-place / object-delete is a named RPC that:

- validates `auth.uid()` is the actor and **owns (or may edit) `world_id`**,
- takes `world_id`; rejects edits outside `worlds.bounds`,
- takes a `client_request_id` for replay protection,
- has a small typed param shape; returns plain JSON.

Route them through the `worldStore` facade (with the `isMissingFunction` fallback
convention) so the deploy never breaks before the SQL runs, and so the call site
repoints at the L2 DO later without change.

## Persistence format — lightweight + DO-ready

- **Terrain heightfield**: store chunk-keyed, **int32 coords**, matching the
  `chunk_blobs` / Track 3 pattern (lazy rebuild only — never eager on insert). Persist
  EDITS, not a giant blob; a flat map is zero rows until the brush touches a chunk.
- **Chunk / cell grid = network zone = AoI.** Pick the cell size ONCE (128 m or 256 m
  candidate) so the streamer's cell, the snapshot `zoneId`, and the AoI radius are the
  same grid. The not-yet-built `SceneCellStreamer` owns this; the terrain brush writes
  per-cell so streaming, save, and AoI all align.
- **`registry_origin`**: world content is L1 (origin 0) today; never assume "untagged =
  L1". The wire format already reserves the per-entity origin byte; object placements
  carry it for the Track 8 L2-overlay future.
- **`wireId`**: the snapshot header `worldId` is u32. Each map carries a stable numeric
  `wireId` (DB uuid → wireId map) so the string-id↔u32 boundary is data, not hot-path code.

## Rendering — works in three.js at scale

- New mesh/camera positioning from world coords goes through `toRenderSpace()`
  (`src/lib/renderSpace.ts`, identity today). At ±10 km (Starblink) float32 precision
  starts to matter; the deferred per-region origin shift then changes ONLY that file.
- `terrainHeight.setTiles()` is global (one map at a time clobbers the prior). Fine for
  single-world play; world-scope it if two maps ever render at once.

## Status of Phase 1A–1C against this contract

- ✅ Map = `WorldDefinition` keyed by one id; per-map DO instance is a natural fit
  (DO already parameterized by `worldId`, just hardcoded to 1 — flip to `?world=`).
- ✅ `bounds` authoritative (Starblink ±10 km); no inline coord literals; `toRenderSpace`
  in the flat renderer; `gameId`/`ownerId`/`wireId` locked in.
- ⏳ Still TS-registry + localStorage `activeMap` (client only). Converges to the
  `worlds` table at 1E via the schema work above — the swap is behind `getWorldDefinition`.
- ⏳ Object placements + terrain edits not built yet — when built (1D/3) they MUST be
  RPC-gated + world-scoped per this doc, not static files or direct table writes.
