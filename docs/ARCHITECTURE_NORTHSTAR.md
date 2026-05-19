# DreadRoot Voxel-FPS Engine — Architecture North Star

Target: a 2025/26 browser voxel FPS (Minecraft-style and better) that runs
smoothly at scale (20–200 players, 300-block trees, 50× more trees later).
Strategy: **forward only.** Each subsystem below has an IDEAL (modern best
practice), the CURRENT DreadRoot state, the GAP, and STATUS. We get the
architecture right, then iterate each part to excellence — measured, one
verified change at a time. No regressions without explicit permission.

Legend — STATUS: ✅ done & verified · 🟡 done, needs hardening · 🔴 not done

---

## 1. Chunk geometry / meshing  — 🔴 #2, TOP PRIORITY (dominant cost today)
- **Ideal:** per-chunk (or per 16³ section) BufferGeometry of only *exposed
  faces*, with **greedy meshing** (coplanar faces merged into big quads).
  ~70–85% fewer triangles + far cheaper rebuilds. Built **off-thread**.
- **Current:** every visible block = a full 12-triangle InstancedMesh cube;
  only fully-buried blocks removed (no face culling, no greedy merge); mesh
  rebuilt **on the main thread**. Measured: ~9s of MeshRebuilds / 2.5M tris.
- **Gap:** this IS the lag. The single highest-leverage modern technique we
  do not yet have.
- **Plan:** implement greedy meshing producing a per-chunk/section quad
  BufferGeometry; move the build into the existing (dormant) mesh worker.

## 2. Collision  — 🟡 #1, mostly done; verify correctness
- **Ideal:** no per-block collider objects — sample the voxel field from the
  player's swept AABB (O(~20 lookups), zero allocation).
- **Current:** voxel-field implemented (xz-column index + lazy stable boxes
  behind the same query API). Collider cost collapsed multi-second → ~7ms.
- **Gap:** correctness pass — climbing/standing/edges/bullets/enemy paths,
  no fall-through, no stuck. Then it's ✅.
- **Plan:** targeted correctness verification; keep the cheap voxel model.

## 3. Chunk shape & streaming  — 🔴
- **Ideal:** 16×16×16 sectioned chunks (independent mesh/cull/memory per
  section). **Fog gates loading**: load/collide/retain radius == short view
  distance; distant = low-detail impostors. Player-initiated long view
  (goggles) as a bounded burst.
- **Current:** 16×16 columns, unbounded Y as one unit; ~291 chunks /
  220k blocks loaded; fog is visual-only (doesn't reduce what's loaded);
  load↔evict thrash being tamed.
- **Gap:** Y-sectioning (enables #1 greedy meshing well + bounded work);
  fog that truly gates loading; LOD/impostors; goggles (plan exists).
- **Plan:** after #1/#2: fog-gates-loading + cheap far-tree LOD + goggles.

## 4. Textures  — 🟡
- **Ideal:** `DataArrayTexture` / `sampler2DArray` (layer index per
  instance) + KTX2/Basis compression. No atlas bleed, cleaner mips, ~¼ VRAM.
- **Current:** single 8192² 2D atlas + per-instance UV offset; works.
- **Plan:** texture array + KTX2 (medium ROI; after #1/#2).

## 5. Threading  — 🔴
- **Ideal:** chunk meshing + heavy work off the main thread (worker pool),
  transferable buffers.
- **Current:** mesh worker exists but is **disabled/unused**; meshing on
  main thread → freezes.
- **Plan:** wire meshing through the worker as part of #2.

## 6. Frame/update loop  — 🟡
- **Ideal:** stable tick; per-chunk render gated on a content signature, not
  array identity; no work for unchanged chunks.
- **Current:** signature-based skip added (grouping cache 0→17%); emit/
  worldRevision churn reduced by the thrash fix.
- **Plan:** confirm via DF that unchanged chunks no longer re-mesh.

## 7. Multiplayer / economy security  — 🔴 (launch gate if real value live)
- **Ideal:** authoritative server-side validation for ALL value (coins/
  items/crypto): RLS lockdown, transactional RPCs that re-derive outcomes,
  idempotency, audit ledger, server-arbitrated combat rewards, AOI.
- **Current:** client-authoritative; per-block rows; minimal anti-cheat;
  leaked service_role key flagged.
- **Plan:** separate security track; not a perf item but blocks public
  launch with real currency. (See prior security analysis.)

## 8. Persistence  — 🟡
- **Ideal:** per-chunk/section palette + bit-packed blob (RLE), not 1 row
  per block. ~30× fewer rows, faster fetch, less Supabase compute/egress.
- **Current:** per-block rows; `fetch_chunks_batch` now RETURNS jsonb
  (uncapped — truncation bug fixed).
- **Plan:** palette/RLE storage (cost + scale; medium ROI; later).

---

## Execution order (per user's directive)
1. **#1 collision** → verify correctness, mark ✅. (Functionally working, cheap.)
2. **#2 greedy meshing + off-thread** → the dominant cost; do it really well,
   measured. This is the priority.
3. Re-baseline with a real DF after each; iterate until smooth.
4. Then the full per-part architecture pass: chunk sectioning, fog-gates-
   loading + LOD + goggles, texture array, persistence, security.

Rule: define the right design first, change one thing, measure with a real
DF report, keep only what's proven, never revert without permission.
