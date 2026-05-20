# DreadRoot Voxel-FPS Engine — Architecture North Star (v2)

Goal: a 2025/26 browser voxel FPS that runs at **90–120 FPS, no stalls**, on
desktop and mobile, with 20–200 concurrent players, 300-block trees, and
plenty of effects. Strategy: forward-only. Get each subsystem to its
modern best practice, then iterate to excellence. One verified change at a
time, measured against a real Chrome trace / D-Flow. Never regress
without explicit permission.

Legend — STATUS: ✅ done & verified · 🟡 done, needs hardening · 🔴 not done

---

## Where we are right now (2026-May-20)

- **~14 FPS average** in the 2026-May-19 21:38 trace (680 frames / 48.6 s),
  with worst frame **864 ms**. Main thread blocked 53 % of wall clock.
- **Heap oscillates 476–990 MB**, one **122 ms MajorGC** during the
  recording → these are the "grey flash" stalls.
- Recent fixes (just shipped — should help the next trace):
  - Shader-error sync stall removed (saves ~1.6 s / 48 s).
  - Bullet × enemy × body-part collision now has a broad-phase distance
    bail per enemy (was the #1 main-thread hot spot at 12.3 s / 48 s).

To go from 14 → 60 we need to **kill stalls + cut steady-state work in
half**. To go from 60 → 90–120 we need real architecture wins (greedy
meshing, Y-sectioning, texture array, fog-gates-loading). The plan
below is ordered by FPS impact, not subsystem.

---

## Subsystem audit (idealized vs current)

### 1. Chunk geometry / meshing — 🟡 (Phase 2a shipped, 2b deferred)
- **Ideal:** per-chunk (or 16³ section) BufferGeometry of only *exposed
  faces*, **greedy meshing** (coplanar faces merged into big quads). 70–85 %
  fewer triangles + cheaper rebuilds. Built **off-thread**.
- **Current:** every visible block is still a 12-tri InstancedMesh cube.
  Only fully-buried blocks culled. Mesh build off-thread (worker; threshold
  ≥ 2000 blocks). Per-chunk worker buffer pool added → no per-build alloc.
- **Gap:** still per-cube geometry on the GPU. 2b (greedy) deferred because
  it breaks raycasting / shrine glow / falling blocks; needs design pass.

### 2. Collision — 🟡 (functionally done, needs correctness pass)
- **Ideal:** sample the voxel field from the player's swept AABB
  (O(~20 lookups), zero allocation).
- **Current:** voxel-field implemented. Collider cost collapsed from
  multi-second → ~7 ms.
- **Gap:** correctness pass — edges/standing/falling/bullets/enemy paths.

### 3. Chunk shape & streaming — 🔴 (Y-sectioning + fog-gates-loading both missing)
- **Ideal:** 16×16×16 sectioned chunks; **fog gates loading** (load radius =
  short view distance); distant terrain = low-detail impostors;
  player-initiated long view ("goggles") as a bounded burst.
- **Current:** 16×16 columns with **unbounded vertical extent**. ~291 chunks
  / 220 k blocks loaded at once. `LOAD_RADIUS = 4`. Fog *is* set on the
  scene (FortressScene.tsx + FadeChunkBlocks.tsx) but it's **visual only** —
  it doesn't gate loading. Goggles: plan drafted (`docs/GOGGLES_PLAN.md`).
- **Gap:** Y-sectioning (enables real greedy meshing and bounds the rebuild
  cost of tall trees); fog truly gating loading; LoD impostors; goggles.

### 4. Textures — 🟡 (atlas works, modern path not adopted)
- **Ideal:** `DataArrayTexture` + `sampler2DArray` (layer index per
  instance) + KTX2 / Basis compression. No atlas bleed, cleaner mips,
  ~¼ VRAM, faster sampling.
- **Current:** single 8192² 2D atlas + per-instance UV offset; works fine.
- **Gap:** medium ROI, blocked on Phase 1 of perf work.

### 5. Threading — 🟡 (mesh + pathfinding on workers; nothing else)
- **Ideal:** heavy work off the main thread — mesh build, chunk
  decode/parse, AI batch ticks, particle simulation.
- **Current:** mesh worker (active) + pathfinding worker (small). Trace
  shows **5 worker threads** running, mesh worker accumulating 163 s of
  thread-time over 48 s wall clock — work IS going off-main. BUT chunk
  parse/decompress still runs on main inside the IDB `onsuccess`
  microtask.
- **Gap:** chunk decode worker; consider AI batch tick worker.

### 6. Frame / update loop — 🟡 (registry + per-frame hot spots being hunted)
- **Ideal:** stable tick; per-chunk render gated on content signature;
  no work for unchanged chunks; per-system distance-based throttling.
- **Current:** central `frameLoop.register(name, fn, priority)` registry
  exists. The big `useFortressFrameLoop` useFrame was the #1 hot spot
  (12.3 s / 48 s) — bullet × enemy collision broad-phase just shipped.
- **Gap:** frustum culling — many renderers force `frustumCulled={false}`
  (shombies / shwarms / shnakes / walapas). Three.js can't cull instanced
  meshes correctly when instances move, so devs disable culling. Need a
  cheap per-group bounding-sphere check.

### 7. Multiplayer / economy security — 🔴 (separate track, launch gate)
- **Ideal:** authoritative server validation, RLS lockdown, transactional
  RPCs, idempotency, audit ledger, AOI replication.
- **Current:** client-authoritative; minimal anti-cheat; leaked
  service_role key flagged.
- **Plan:** separate track, blocks public launch with real currency.

### 8. Persistence — 🟡 (IDB cache works; format is the bottleneck)
- **Ideal:** per-chunk **palette + bit-packed blob (RLE)**. ~30× fewer
  rows in Supabase, ~10× faster to deserialize on cache hit, less GC.
- **Current:** IndexedDB cache stores `blocks: PlacedBlock[]` (one full
  object per block). Trace showed IDB `p.onsuccess` accumulating **1.4 s /
  48 s** on main thread — but the onsuccess itself is trivial; the real
  cost is the downstream `await` consumer parsing thousands of block
  objects synchronously.
- **Gap:** chunk cache should be palette+RLE; the loader should
  decompress in a worker.

---

## Phased iteration plan (ordered by FPS impact toward 90–120 fps)

### Phase A — Reach steady 60 FPS by killing stalls (weeks)
Goal: no frame > 33 ms; average ≥ 60 fps under normal play.

A1. **Validate the just-shipped #6 part 5 (broad-phase bail + shader-error
    skip).** Need a fresh trace from the deployed build; expect the 12.3 s
    anon and 1.6 s shader stall to drop visibly.
A2. **Decode chunks off-thread.** Move IDB result → block-array
    expansion into a worker (or chunked microtask budget). Target: the
    1.4 s IDB `p.onsuccess` chain drops toward 0.
A3. **Reduce heap pressure → no MajorGC during play.** Audit per-frame
    allocations (Vector3 in hit handlers, `new THREE.Vector3(hitX,…)`
    inside the bullet loop, fire config objects). Use scratch vectors
    or numeric tuples. Goal: heap rate < 5 MB/s under normal play.
A4. **Coarse frustum culling for instanced groups.** Many renderers
    disable Three.js culling because instances move. Add per-group
    bounding-sphere check against the camera frustum each frame and
    set `mesh.visible = false` when culled. Big win for shombies /
    shwarms / shnakes / walapas / shtickmen renderers.
A5. **Throttle distant enemy renderers.** EnemyManager already LOD-ticks
    AI by distance; extend to *render* updates (skip morph / animation
    of enemies > X units away).

### Phase B — Reach 90 FPS via architecture wins (months)
Goal: render budget under 11 ms; main-thread tick under 6 ms.

B1. **Y-section chunks (16×16×16).** Unbounded-Y chunks make tall-tree
    rebuilds catastrophic. Sectioning bounds rebuild cost and is a
    prerequisite for real greedy meshing.
B2. **Greedy meshing (Phase 2b).** Per-section BufferGeometry of merged
    coplanar quads, built in the existing mesh worker. Design needs to
    preserve raycasting / shrine glow / falling-block correctness. ~70 %
    fewer triangles + much faster mesh rebuilds.
B3. **Fog gates loading.** LOAD_RADIUS shrinks to match view distance;
    far chunks stop loading entirely. Frees CPU, GPU, RAM, IDB.
B4. **LoD impostors for distant chunks.** Single billboard or coarse
    mesh per far chunk, swapped in beyond fog distance.

### Phase C — Reach 120 FPS / mobile parity (months)
Goal: clean headroom on desktop; mobile playable.

C1. **DataArrayTexture + KTX2.** Drop UV-offset math; reduce VRAM by ~4×.
C2. **Goggles** (snapshot long view). Per `docs/GOGGLES_PLAN.md`. Built-in
    base tier + cheap far skirt during normal play.
C3. **Palette + RLE chunk persistence** (Supabase + IDB). 30× fewer rows,
    far less compute/egress, much faster cache hits.
C4. **Sectioned shader: indirect draw / multi-draw**. Modern WebGL2 /
    WebGPU draws all sections in one call.

### Phase D — Security & launch gate (parallel track)
D1. Rotate leaked service_role key (already memo'd).
D2. Authoritative server validation for value (coins/items).
D3. RLS lockdown, transactional RPCs, audit ledger.

---

## Operating rules

1. One verified change per commit; no batched "and also" changes.
2. Each change must have a trace-driven reason or fix a known correctness
   bug; no speculative perf work.
3. After each change: capture a real Chrome trace / D-Flow, confirm the
   targeted metric improved AND avg FPS / heap rate didn't regress.
4. If a change regresses anything, **fix forward** (improve the new
   architecture). Revert only with explicit user OK.
5. Default flags ON with a runtime fallback rather than off behind
   user-pasted console flags. The user reports visual issues during normal
   play; I revert in code if needed.

---

## Related docs
- `docs/MESH_OFFTHREAD_PLAN.md` — Phase 2a execution contract (done).
- `docs/GOGGLES_PLAN.md` — long-view snapshot design.
