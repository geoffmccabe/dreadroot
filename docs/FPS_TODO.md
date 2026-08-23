# FPS to-do — findings and what's left

Target: 90-120 fps, 60 minimum. Measured 21-50 fps depending on area.

## What the measurements actually say

- **CPU is not the problem.** Game-loop CPU is 0.5-2.0 ms/frame, 3-12% of the
  16.7 ms budget, in every report.
- **GEOMETRY bound, confirmed.** The automatic probe: GPU 16.37 ms -> 14.19 ms
  at a QUARTER of the pixels (1.15x). Resolution barely matters, so the cost is
  triangle count, not overdraw. A depth pre-pass would not help.
- **Draw calls track frame rate closely.** Two independent sessions:
  correlation -0.814 and -0.851. Correlation with VIEW DISTANCE: +0.055 and
  -0.130, i.e. none. At the same chunk count, <110 draw calls gave 47-53 fps
  and >250 gave 18-24 fps.
- **Memory is high.** 640-938 MB heap; GC reclaimed 1.5-1.9 GB per session.

## Done

1. Shnake world index rebuilt on a blind 5 s timer — walked all ~200k loaded
   blocks and allocated a 200k-entry Set, on the main thread, for a system with
   zero live entities. Now built on demand. (Was the 600-1100 ms stalls.)
2. Chunk load/evict thrash — eviction compared against the DEFAULT view
   distance, not the live one, so it threw away chunks still in view and the
   integrity check re-fetched them. 184 unloads vs 12 loads in 14 s.
3. Pathfinding storm — an entity with no path re-requested EVERY FRAME and
   fired more while one was in flight. Up to ~600 A* searches/sec instead of
   ~7. Was 22% of all CPU.
4. Chunk-edge culling — the whole 1-block border of every chunk was kept
   because the culler could not see into neighbours. ~41% fewer rendered
   blocks on dense terrain.
5. GPU stats were measuring the post-processing quad, not the scene ("1 draw
   call, 0 triangles"). Every GPU investigation was being told the scene was
   free.
6. D-Flow hotkey needed spamming — it was on the bubble phase behind a dozen
   capture-phase listeners that swallow events.

## Left, in priority order

### 1. Per-face culling (the big one)
Every visible block still draws all SIX faces (12 triangles) even when five of
them touch another block. Typical terrain exposes 1-2 faces, so this is roughly
a 4x triangle reduction — by far the largest remaining win, and it targets
exactly what the probe says is the bottleneck.

Cost: real. Requires instancing FACES rather than CUBES, which changes the
instance-id to block mapping that mouse block-picking relies on (documented in
the repo's own notes as why greedy meshing was deferred). Needs a plan, not an
afternoon.

### 2. Draw-call batching for texture variants
Blocks batch by type AND texture variant, capped at 8 variants per type. A
fortress area with many custom-textured blocks explodes into 300+ batches and
halves the frame rate. This is the difference between the 47 fps and 18 fps
groups above.

NOT as simple as "turn on the texture array" — see below. Options are to raise
the sharing, or to finish the array path properly.

### 3. The 8192x8192 atlas (256 MB of GPU memory)
Still the live path. The DataArrayTexture replacement exists but is OFF behind
two flags, and its own comment says the world half is not production-ready: it
eagerly streams hundreds of textures, overflows and evicts (wrong/duplicate
tree textures), and DOUBLES texture memory because the atlas stays built.
Monsters can use it; the world cannot yet.
Finishing it is worth ~75% of texture memory per the repo's own estimate, and
would also collapse item 2, since one material for all block types means one
batch per chunk.

### 4. Non-tree blocks are never culled
`computeSurfaceVisibleBlocks` returns early for anything that is not a tree
block, so `fortress_block` is drawn even when fully buried. About 11% of blocks
in a sampled area. Small, cheap, low risk.

### 5. Memory / GC pressure
640-938 MB heap with 1.5-1.9 GB reclaimed per session. Not directly frame rate,
but it drives the GC stalls, and it is the leading suspect for the browser
taking the GPU away (the grey screen). The chunk cache holds up to 275-411
chunks against a working set of ~81; `__chunks.cap(n)` exists to test a
tighter ceiling without a rebuild.

### 6. Smaller items seen but not chased
- MeshRebuilds: 240 ms for 3,600 blocks looks slow for the work.
- Grouping: ~200 cache misses per session costing 40-185 ms.
- Render submit spikes to 55-214 ms (CPU cost of issuing draws) — consistent
  with the draw-call finding in item 2.

## Recommended order

4 (cheap) -> 2 or 3 (they are the same problem from two ends) -> 1 (biggest,
needs a plan). 5 in parallel, since it is about stability as much as speed.
