# Siege World / Open-World Rendering Performance Plan

**Goal:** make the Siege Worlds map (a large glTF open world) run smoothly, as **core,
world-agnostic engine infrastructure** for a metaverse-scale multiplayer FPS — not a
SW-only hack. Best-of-breed for mid-2026, reusing what the Dreadroot engine already does well.

Status as of v4.27.2: SW map renders but ~13fps. 17.6M triangles, ~1000–2000 draw calls,
broken frustum culling, no LOD, no streaming, 430MB uncompressed glTF parsed on the main
thread (400–530ms startup stalls).

---

## 1. Diagnosis — why it's slow (ranked by impact)

1. **No spatial streaming + broken frustum culling → the entire 2000×2000 world draws every
   frame.** `WorldObjectsLayer` builds one `InstancedMesh` per submesh per model with a single
   geometry-local bounding sphere, while instances are scattered across the whole map → three.js
   can't cull them, so all ~20,354 instances in 1,681 groups render even though you see a sliver.
   The terrain renders all 16 full-res tiles (2.1M tris) always. **This is the dominant cost.**
2. **No LOD.** Distant buildings/props/foliage render at full poly. A whole town 1500m away
   costs the same as one at your feet.
3. **Main-thread glTF parse of 430MB.** Synchronous `useGLTF` parsing of large models
   (BeachTown 19MB, ShantyTown 12MB, …) causes the 400–530ms freezes on entry.
4. **No asset compression.** Raw glTF geometry (no Draco/meshopt) + raw PNG/JPG textures
   (no KTX2/Basis). Bloats download, VRAM (256MB GPU tex now), and parse time.

## 2. What Dreadroot already nails (REUSE — do not reinvent)

- **Camera-tracked chunk streaming** (`useChunkLoader.ts`): load/unload cells by camera position,
  load radius + unload hysteresis, LRU eviction, min-residency anti-thrash, 3-tier cache
  (memory → IndexedDB → Supabase). This is the streaming engine — we generalize it from
  "blocks in a chunk" to "glTF objects in a cell."
- **Off-thread mesh worker pool** (`meshWorkerPool.ts`): transferable buffers, output-buffer
  pooling, timeout→sync fallback. Pattern reused for off-thread glTF/meshopt/KTX2 decode.
- **Budgeted work queue** (`budgetedWork.ts`): 2ms/frame FIFO — stagger cell build/teardown.
- **Central frame loop** (`frameLoop.ts`): one `useFrame`, priority-ordered callbacks.
- **Spatial hash grid** (`spatialHashGrid.ts`, cell size 2): collision + ground; SW terrain
  already feeds ground height via `terrainHeight.ts`.
- **Distance LOD with hysteresis** (enemy AI `AILodLevel`: FULL<32m / THROTTLED<80m / FROZEN):
  the exact pattern for object render-LOD buckets.
- **IndexedDB cache** (`blockDB.ts`): generalize to cache glTF cell blobs/manifests.
- **Instanced + texture-atlas rendering** (`InstancedAtlasBlockGroup.tsx`): atlas batching pattern.

## 3. Strategy — one world-agnostic spatial layer

Build a **SceneCellStreamer**: a generic, world-kind-agnostic spatial streaming + rendering
layer. A world (voxel OR siege) provides cell *content*; the streamer owns load/unload/cull/LOD
identically for both. The voxel world converges onto it over time; siege uses it first.

**The cell grid doubles as the network Area-of-Interest grid** for multiplayer (aligns with the
layered architecture plan: AoI, snapshots). Design the cell size once to serve both rendering
and networking.

### Core rendering technique (the mid-2026 best choice)
- **`THREE.BatchedMesh` per material per cell.** BatchedMesh does multi-draw with **built-in
  per-geometry frustum culling, sorting, and LOD** — the modern answer to both the draw-call
  count and the broken-culling problem. One BatchedMesh per (material, cell) collapses a cell's
  many props into a handful of draws that cull correctly.
  - Fallback where BatchedMesh doesn't fit: **per-cell InstancedMesh with a tight bounding
    sphere** around that cell's instances (correct culling, simple).
- **WebGPU forward path:** keep the per-cell batch data layout compatible with
  `WebGPURenderer` + compute-shader GPU-driven culling / indirect draw, to flip on when
  three.js WebGPU is production-solid. Designed-for now, adopted later.

### LOD + HLOD
- Per-cell/object distance buckets (reuse the AILodLevel pattern): near = full mesh,
  mid = simplified mesh, far = impostor/merged proxy.
- **HLOD proxy meshes**: distant town clusters collapse to one low-poly proxy per cell.
- **Octahedral impostors** for far repeated foliage (Synty packs are foliage-heavy).
- Terrain: quadtree/clipmap — full-res near tiles, downsampled distant tiles, in-view only.

### Asset + data pipeline (offline — NO dev burden)
- **Spatial bucketing:** extend `process_world.py` to emit per-cell manifests (bucket the
  20,354 instances by cell from their matrix translation) + per-cell merged static geometry.
  This is the enabler for streaming + culling.
- **`gltf-transform` toolchain** (offline): weld/dedup → `simplify` for LOD variants →
  **meshopt** (fast GPU-friendly decode) geometry compression → **KTX2/Basis** textures →
  instancing. Shrinks 430MB → ~50–80MB, drops VRAM, and kills parse stalls. All offline; the
  dev never touches it.
- **Off-thread decode:** GLTFLoader + meshopt + KTX2 decoders in workers (meshWorkerPool
  pattern). Progressive: visible cells first.

## 4. Phases (impact-ordered; each shippable + measured via DFlow)

- **Phase 0 — Pipeline (offline, zero runtime risk):** spatial-bucket placements into cell
  manifests; meshopt + KTX2 compress; generate LOD variants with gltf-transform simplify.
  Deliverable: spatially-indexed, compressed assets. Big download/VRAM/parse win immediately.
- **Phase 1 — Streaming + cullable batching (the big fps win):** SceneCellStreamer reusing the
  camera-tracked loader; render cells as per-cell BatchedMesh; stream terrain tiles, in-view
  only. Expect draw calls + triangles to drop to the visible fraction; fps jumps.
- **Phase 2 — LOD + impostors + HLOD:** distance buckets, distant-cluster proxies, foliage
  impostors, terrain LOD. Smooths the far field.
- **Phase 3 — Off-thread loading:** worker decode + progressive streaming → eliminate startup
  stalls; seamless cell pop-in.
- **Phase 4 — WebGPU GPU-driven culling (forward-looking):** move per-cell batches to
  WebGPURenderer + compute culling/indirect draw when three.js WebGPU is solid.

## 5. Metaverse / multiplayer alignment
- Cell grid = render streaming AND network AoI (one spatial structure).
- Server-authoritative world (SW already is); cell manifests become server-driven later.
- Converge the voxel world onto the same SceneCellStreamer so the engine has ONE streaming/
  culling/LOD/AoI system for every world kind.

## 6. Risks / decisions to confirm
- Cell size: pick once for render + network AoI (candidate 128m or 256m; 2000m world ≈ 8–16
  cells/side). Smaller = better culling, more overhead.
- BatchedMesh vs per-cell InstancedMesh as the primary path (BatchedMesh preferred; verify
  three.js version supports it well in this build).
- Keep voxel Dreadroot fully working throughout (generalize behind an interface, don't rip out).
