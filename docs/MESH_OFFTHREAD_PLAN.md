# #2 — Off-thread mesh build (Phase 2a). Execution contract. (audited v2)

Goal: move the ~9s of main-thread per-chunk InstancedMesh rebuilds
(`doRebuildSync`/budgeted path in InstancedAtlasBlockGroup.tsx) onto a
mesh worker, **zero visual change**. Phase 2b (greedy meshing) DEFERRED —
needs a per-chunk Mesh and breaks raycasting / shrine glow / falling
blocks (5× harder); only revisit if a real DF shows 2a insufficient.

## Hard rules
- Never regress without permission. Each step = its own commit,
  build + dev-transform + (where possible) headless-smoke verified, then
  audited, before the next.
- **Parity is by IDENTICAL CODE, not reimplementation.** The Step-1
  resolver `resolveBlockDraw` is pure (no atlas imports) → the worker and
  the main thread import and run the *same* function. The atlas-using
  `packChunkBlocks` runs only on the main thread and bakes uv/anim/color
  into a tiny per-build table the worker reads. So the worker cannot
  diverge in pixels by construction.
- **Automated parity gate (added in audit):** before the worker path may
  be enabled, an automated headless test must prove worker output ===
  sync reference output (positions/uv/color, byte-identical) on REAL
  captured chunk data. A crash-fallback does NOT protect against wrong
  pixels — this test does.
- Worker path fallback-guarded: any error/timeout/version-mismatch →
  existing `doRebuildSync`. Budgeted + incremental paths stay intact.
  <2000-block chunks stay sync (cheap).
- Async safety: result tagged with a build version; ignored if the chunk
  unmounted or a newer rebuild started (mirror existing rebuildStateRef
  version checks). Shared material never disposed on unmount.

## Verified step sequence (one commit each)
1. **blockPack util** — DONE (commit 869a3e3). NOTE (audit): must be
   SPLIT in Step 2 — move PackedChunk/DrawTableEntry/BRANCH_DEPTH_NONE/
   resolveBlockDraw into a worker-safe module with NO `@/hooks/
   useTextureAtlas` import; `packChunkBlocks` (atlas-using) imports from
   it. So the worker can import the exact resolver.
2. **Worker-safe split + worker consumes packed input:** meshWorker takes
   {positions, typeIndex, branchDepth, table} via transferables, iterates
   the shared `resolveBlockDraw`, outputs matrices(or center positions)/
   uvOffsets/colors Float32Arrays + bounds, transferred back. Update
   meshWorkerPool + meshWorkerTypes. NOT wired into render. Build + dev
   transform verify.
3. **Automated parity self-test (hard gate):** headless — capture real
   chunk blocks in-game, run pack→worker AND the sync reference, assert
   arrays identical. Must pass before Step 4 enables anything.
4. **Wire behind fallback + version guard:** heavy (>=2000) path submits
   to the worker; valid result applied atomically (reuse existing
   finalize: attrs needsUpdate → mesh.count last), version-guarded;
   any failure → doRebuildSync. Keep <2000 sync + incremental. Behind a
   flag. Headless smoke (no crash, blocks render) + build.
5. **Enable iff parity-test + smoke pass.** Sync fallback remains. Leave
   a status note: user must send a real DF report to confirm MeshRebuilds
   ms collapse with no visual diff. If parity ever uncertain → keep OFF.
6. Only if a real DF shows 2a insufficient: open Phase 2b design.

## Status
- Step 0 (investigate+design): DONE.
- Step 1 (blockPack): DONE (869a3e3).
- Audit (this v2): DONE.
- Step 2: in progress.
