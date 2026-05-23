# Up next — staged perf work

Recently shipped: #2 enemy frustum culling, #3 cap chunk loads to fog
distance. See git log for context.

## #5 — DataArrayTexture + KTX2

**Goal:** ~75% VRAM saving, simpler/faster atlas sampling, no atlas-bleed
artifacts. Modest FPS bump on top.

**Today:** one 8192² RGBA atlas (~256MB GPU). Materials sample with a
per-instance UV offset (custom `onBeforeCompile`).

**Plan:**
1. Convert the atlas pipeline from a single 2D texture to a
   `THREE.DataArrayTexture` (one 256² layer per slot, ~1000 layers max).
   Each draw passes a per-instance *layer index* instead of a UV offset.
2. Update `atlasManager.ts` / `useStoredTextureAtlas.ts` to build into
   layers; update the `onBeforeCompile` injections in `atlasMaterial.ts`
   and `InstancedAtlasBlockGroup.tsx` to use `sampler2DArray`.
3. Add KTX2 / Basis Universal compression for the source textures
   (~¼ size). Use `KTX2Loader` from three-stdlib.
4. Keep the existing 2D atlas as a fallback flag for one release.

**Risk:** moderate. Touches every atlas-using shader. Visual diff should
be zero if mips/filtering are kept consistent. Hardware support is
universal in modern browsers.

## #6 — Goggles (long-view snapshot)

**Goal:** let the player toggle a "far view" briefly without paying the
constant cost of a long render distance.

**Existing plan:** `docs/GOGGLES_PLAN.md` is already written — built-in
base tier + cheap far skirt for normal play, plus an on-demand snapshot
when the player uses goggles.

**Plan:** re-read that doc, then implement.

## Greedy meshing — updated re-evaluation

User clarified: **blocks are not destroyed during combat.** That removes
my prior biggest objection (constant remeshing).

Updated assessment:

- **Trees (the bulk of the world):** branches are skinny 1-block runs;
  few coplanar surfaces to merge. Realistic reduction ~20–40%, not the
  textbook 70–85%.
- **Fungal trees:** bigger solid block groups → better, ~40–60% reduction.
- **Fortress + user builds + ground:** large flat surfaces → the textbook
  case, 70–85%.

What we'd still pay for:
1. **Y-section chunks (16³)** is a real prerequisite — current chunks are
   unbounded-Y columns, which makes greedy meshing of a 300-block tree
   catastrophic on every rebuild. Real refactor on its own.
2. **Mouse block-picking** currently raycasts the InstancedMesh and uses
   the `instanceId`. Greedy fuses blocks into shared geometry → no
   `instanceId` per block → needs a separate spatial lookup (we already
   have a voxel field — could reuse).
3. **Bullets are unaffected** — they use the voxel-field collision, not
   mesh raycasts.

**Recommendation:** still defer until we have evidence we're geometry/GPU-
bound, not CPU/JS-bound. The latest trace's median frame is 2–5 ms — the
remaining stalls dominate the avg, not steady-state geometry cost.
Greedy meshing is the right tool when steady-state GPU is the wall;
we're not there yet. Revisit after #5 and #6, with a GPU-side
measurement.
