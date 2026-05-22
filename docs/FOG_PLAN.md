# Fog Overhaul Plan

Goal: dense, creepy, realistic fog that
- caps how far you can see → makes us render only what's inside that range
  (the speedup),
- is **height-aware**: thick low down, thinning as you climb — above a fog
  ceiling (~12–15 chunks up) you rise "above the clouds" and see far,
- applies to everything,
- is admin-configured, not user-configured.

---

## Current state

- `THREE.Fog` (linear), start 50% / end 95% of draw distance — too gradual and
  starts too far → you can still see the distance. Set in FortressScene.
- Fog config lives in the **Lightning Panel** (user-reachable).
- Chunk render distance (`visualDistance` ~7 + 3 "fade" rings) is
  **independent of fog** — we render chunks the player can't see. Wasted GPU.
- `FadeChunkBlocks` draws 3 rings of grey silhouette chunks — the disliked look.
- Fruits are not fogged (bug). Sky is correctly not fogged.

## Reusable vs replaced

- **Reuse:** the `scene.fog` mechanism; the chunk-visibility system in
  `FortressScene.CameraTrackedBlocks.tsx`; the admin panel.
- **Replace:** the grey `FadeChunkBlocks` silhouettes; the start/end-% fog
  model; the Lightning-Panel fog UI.

---

## The model

Fog density is driven by **two inputs**: distance from camera, and **altitude**.

- **Below the fog ceiling** (≈ 12–15 chunks up, ~200–240 blocks): dense fog,
  short view (~5–8 chunks). Can't see treetops from the ground; can't see the
  ground from mid-tree.
- **Climbing up:** fog gradually thins.
- **Above the ceiling:** near-clear — you see far. Cheap to render: little
  geometry exists that high (just tree crowns), so the long view costs little.

Chunk render radius is **derived from the fog** and is therefore also
height-aware: short when low, long when high.

Implementation: override the fog calculation once, globally (a single
shader-chunk patch), so height fog applies to every material that uses
standard fog — no per-material edits. Fully-custom shaders (MeshLine tracers)
get the same treatment explicitly.

---

## Plan

### Phase 1 — Distance fog gates rendering (low-altitude behavior, the speedup)
- One admin-driven value: **fog distance in chunks** (Heavy ≈ 5, Medium ≈ 8,
  Light ≈ 12).
- Chunk render radius = fog distance. Stop rendering chunks beyond it.
- Dense, density-based fog, fully opaque at that distance — a real wall of fog.
- Payoff: heavy fog → ~½ today's rendered chunks → real FPS gain.

### Phase 2 — Height dimension ("above the clouds")
- Fog density also falls off with altitude; near-zero above the fog ceiling.
- Chunk render radius grows with altitude (short low, long high).
- Done via the global fog-shader override so it covers everything at once.

### Phase 3 — Fog applies to everything
- Fix fruits.
- Audit + confirm fog on: blocks, fortress, ground, all enemies, other
  players (FBX avatars), bullets/tracers, particles/effects, coins, dropped
  items. Sky stays unfogged.

### Phase 4 — Admin-only configuration
- Move fog config out of the Lightning Panel into the Admin panel.
- Three presets framed as graphics tiers: **Light / Medium / Heavy**. Admin
  picks; users cannot. Each preset bundles fog distance, density, ceiling
  altitude, render radius, colors.

### Phase 5 — Cleanup + vibe
- Remove the grey `FadeChunkBlocks` silhouettes — dense fog replaces them.
- Tune fog color: dark, desaturated, day/night variants — creepy.
- LoD note: with heavy fog, a hard render cutoff at the fog wall IS the LoD;
  no distant impostors needed. Above the ceiling the long view is cheap.
  Revisit only if the lightest preset needs it.

---

## Expected payoff
- Heavy preset: ~½ the rendered chunks low down → large GPU + CPU saving.
- Correct, consistent fog on every object.
- Creepy intentional look; "above the clouds" reward for climbing.

## Build order
Phase 1 → 2 → 3 → 4 → 5. One verified change per step, trace/D-Flow after each.
