# Texture Array Migration Plan (atlas → DataArrayTexture working set)

**Status:** DRAFT for approval. Replaces the single 8192² packed atlas (1024 fixed
slots, now FULL — animated monster tiers overflow → solid-color fallback) with a
streaming **texture-array working set**. This permanently removes the slot/overflow
limit and atlas bleed, cuts VRAM, and scales to many games + user-uploaded textures.

## Why (the problem)
- One 8192² RGBA atlas = 1024 slots, all used. New animated monster tiers (shombie/
  shnake/shroomer at up to 24 frames each) get no slot → render a solid colour.
- The atlas can't grow (16K texture breaks phones, which we target).
- "Multi-atlas" was never built — only a dead `atlasId` field. Every shader binds ONE
  `sampler2D`. Spilling to a 2nd atlas = a large renderer/shader rewrite anyway.

## The model (answers the per-game / UGC / scale questions)
NOT a per-game array, and NOT "everything in one giant array". Instead:

- **One shared, device-sized array texture** = a fixed pool of equal-size layers
  (e.g. 256² each). Layer count chosen at runtime from the GPU's
  `MAX_ARRAY_TEXTURE_LAYERS` (≥256 guaranteed; ~2048 desktop; pick conservatively on
  mobile). VRAM ≈ layers × layerSize² × bytes (compressed later via KTX2).
- **A working set, not a static map.** Only textures *currently visible* are resident.
  A `url → layerIndex` map with **LRU eviction**: leaving a world ages its textures out;
  entering a world/challenge streams its set in. Hundreds of worlds work because only
  the on-screen set is loaded at once.
- **Dedup across games by URL/hash.** A texture used by DreadRoot + Pinkland + a UGC
  block shares ONE layer. Overlap is free.
- **UGC is first-class.** A user-uploaded block/monster texture is just a URL; it
  streams into a layer on demand and is visible to everyone, same as built-ins. No
  per-game partition needed — visibility, not ownership, decides residency.
- Per-instance data changes from a **UV offset** (into the packed atlas) to a **layer
  index** (which array layer). Same instanced-render perf.

### Animations (GIF/mp4 → webp frame strips)
The existing conversion pipeline (`animationToStrip.ts` + design panels: animated upload
→ horizontal webp sprite-strip, up to N frames at a reduced frame rate) is UNCHANGED.
Today the atlas stores **one frame per slot** and the renderer steps through consecutive
slots over time; in the array it's **one frame per layer** and the renderer steps through
consecutive layers (`baseLayer + frameIndex`) over time — identical animation logic, the
index just points into the layer dimension. Only the runtime loader changes: it slices
the strip and uploads each frame to its own layer instead of an atlas slot region.
Implications: (1) lower frame-rate conversions = fewer frames = fewer layers = cheaper,
so the existing reduced-fps choice helps here; (2) frames still cost one layer each while
that monster is visible (same as one slot each today) — but with NO 1024 ceiling, full
res per frame, and no bleed; (3) KTX2 (Phase 5) transcodes per-frame layers — slice strip
→ encode each frame → compressed layer.

### Known bound + mitigations
A single frame can show at most `layerCount` distinct textures (today's atlas already
caps the working set at 1024). With LRU + dedup it's strictly better than today. If a
scene ever needs more distinct textures than layers: (a) dedup already collapses
repeats, (b) distance-LOD distant objects to a shared low-res layer, (c) per-category
soft budgets so monsters can't starve blocks. Note any forced eviction in logs (never
silently drop — per project rule).

## Safety / rollout (shared with Pinkland + co-build)
- **Feature flag `TEXTURE_BACKEND = 'atlas' | 'array'`, default `'atlas'`.** The new
  path is opt-in; both games + the co-build partner keep working untouched during the
  build. Flip per game after soak (DreadRoot → Pinkland → Siege).
- A thin **`textureBackend` abstraction**: renderers ask "sampling info for this URL"
  and get either `{atlasUv}` or `{layerIndex}`. Only this layer knows which backend.
- Co-build rules: shared `version.ts`, fetch-before-push, gate shared-core edits, run
  `tsc` + build before push. Each shader edit is additive + flag-gated.
- Verify each surface in the real app before moving on (blocks → trees → monsters).

---

## Phases

### Phase 0 — Flag + abstraction (no behaviour change)
- Add `TEXTURE_BACKEND` flag (default `atlas`) + a `textureBackend` module exposing
  `resolve(url) → { mode:'atlas', uvOffset } | { mode:'array', layer }`.
- Renderers keep using the atlas; this just inserts the seam. Ship, confirm zero change.

### Phase 1 — Capability detection + ArrayTextureManager (offscreen, no render yet)
- Detect `MAX_ARRAY_TEXTURE_LAYERS` + max texture size; choose `layerCount` +
  `layerRes` (mobile-safe defaults).
- Build `ArrayTextureManager`: a `THREE.DataArrayTexture` (uncompressed first — simplest
  to stream via `texSubImage3D` per layer), `url→layer` map, LRU eviction, async load
  queue (fetch → ImageBitmap → upload to layer), a reserved "loading/missing" layer.
- A tiny debug panel (admin) showing resident layers / evictions. No gameplay impact.

### Phase 2 — Blocks behind the flag (first real surface)
- Add a per-instance `aLayer` attribute to `InstancedAtlasBlockGroup`.
- In its `onBeforeCompile`, when backend==='array', sample
  `texture(uArray, vec3(slotUv, aLayer))` instead of `texture2D(map, uvOffset+…)`.
- Verify blocks (incl. UGC block textures) render identically; measure VRAM + FPS vs
  atlas. Atlas remains the fallback.

### Phase 3 — Trees
- Same per-instance layer treatment for the tree atlas path. Verify tree variety +
  growth still correct.

### Phase 4 — Monsters (fixes the reported bug)
- Route `atlasMaterial.ts` (Lambert/Standard/hue-shift) + `ShombieRenderer` (and
  shnake/shroomer/etc.) through the layer-index path. No slot limit → ALL animated
  tiers + frames get layers. Verify every tier textures + animates in-world.
- **This is the phase that restores the missing shombie textures.**

### Phase 5 — KTX2 compressed layers (VRAM win)
- Switch the array to `CompressedArrayTexture` + `KTX2Loader` transcoding (the KTX2
  *encoding* half already exists: `src/lib/ktx2.ts`, `*_url_ktx2` columns, backfill
  button). Load the `*_url_ktx2` siblings; transcode to the device's compressed format.
  ~4× VRAM saving → more resident layers. Keep uncompressed fallback for unsupported
  devices.

### Phase 6 — Streaming, eviction & UGC at scale
- Tune LRU for world/challenge switching; prefetch a world's set on enter.
- UGC pipeline: upload → KTX2 encode (exists) → on-view stream into a layer → visible
  cross-game, deduped by hash. Add size/dimension limits + a moderation hook.

### Phase 7 — Cutover + cleanup
- Flip default to `array` per game after soak (DreadRoot first). Keep atlas fallback one
  release. Then remove the 1024-slot packing in `atlasManager.ts`.

## Files touched (per phase, mostly additive/flag-gated)
`src/lib/atlasManager.ts`, `src/lib/textureAtlas.ts`, `src/hooks/useTextureAtlas.ts`,
`src/hooks/useAtlasSync.ts`, `src/lib/atlasMaterial.ts`,
`src/components/InstancedAtlasBlockGroup.tsx`,
`src/features/shombie/components/ShombieRenderer.tsx` (+ shnake/shroomer/etc.),
`src/lib/ktx2.ts` (decode side, new), new `src/lib/arrayTextureManager.ts` +
`src/lib/textureBackend.ts`.

## Verification each phase
Real-app render parity (screenshot diff), VRAM (before/after), FPS (the harness:
tab-closed, 3×, median), and a horde test for the monster phase.
