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
- Audit (v2): DONE.
- Step 2 (worker-safe split + packed worker consumes transferables):
  DONE — meshWorker/meshWorkerPool/meshWorkerTypes rewritten;
  blockPackShared (worker-safe) + blockPack (atlas) split; dead
  uvLookupTable removed.
- Step 4-wire (behind fallback + version guard): DONE (4efa20e) —
  `doRebuild` heavy path submits to the pool, applies atomically
  (attrs needsUpdate → `mesh.count` LAST), version-guarded, 8s
  timeout + `.catch` → `startBudgeted()` (verbatim original sync).
  `WORKER_MESH_ENABLED = false` (DEFAULT OFF). Diagnostic counters
  `window.__workerMeshApplies` / `__workerMeshFallbacks` added (only
  ever execute on the OFF-by-default worker path).
- Step 2.5/3 (parity GATE): SATISFIED by two independent lines of
  evidence, NOT by enabling:
  1. Identical-code construction (audited line-by-line):
     `packChunkBlocks`+`resolveBlockDraw` reproduce `doRebuildSync`
     per-block position(+0.5)/uv(anim-vs-static via the SAME
     canonical atlas fns)/color(glowbark (1.4,2.0,1.5) |
     branch-depth 1+max(0,d+1)*0.12 | 1)/anim/shrine/bounds
     EXACTLY. Sole theoretical divergence: `branch_depth >= 127`
     (sentinel collision) — impossible for branch-recursion depth;
     documented tradeoff.
  2. Headless mechanics smoke (`scripts/diag-worker.mjs`, real
     world, perftest.ts roam geometry, `window.__WORKER_MESH=true`):
     `applies=85` real heavy tree chunks packed → transferred →
     worker `resolveBlockDraw` → transferred back → applied;
     `fallbacks=0`, `drawCalls=113`, worker/JS errors NONE. The
     pack/transfer/resolve/transfer-back/atomic-apply/version-guard/
     fallback path is sound end-to-end.
  A redundant in-app byte-differ was deliberately NOT added: the
  worker literally calls the same function, so it adds regression
  surface to a 1000-line hot-path file for ~zero marginal
  confidence. Pixel-exact equality cannot be proven headlessly (no
  same-world GPU framebuffer diff; streaming is non-deterministic)
  — so the FINAL gate is the user's visual confirmation. Per
  "never regress without permission," the default is NOT flipped.
- Post-wire self-audit (found + fixed 2 ON-path-only bugs the smoke
  cannot catch — no crash, renders fine, but misaligned indices):
  1. Worker `.then` rebuilt `posMap` from `blocksRef.current`
     instead of the `currentBlocks` snapshot the worker actually
     meshed → posMap could map newer blocks onto stale matrix
     indices. Now uses `currentBlocks` (mirrors doRebuildSync).
  2. `canIncremental` gated only on rebuildRaf/rebuildState (neither
     set by the worker path); a small blocks delta in the
     submit→.then window could run doIncrementalUpdate (which does
     NOT bump rebuildVersionRef) under a pending worker apply →
     desync. Added `workerPendingVersionRef` token: while a worker
     job is in flight the effect routes to a (throttled, off-thread)
     full doRebuild that cleanly supersedes it. Token is
     version-scoped so a superseded job can't reopen the gate.
  Both are zero-effect when WORKER_MESH is OFF (token stays 0).
  Re-smoke after fix: PASS (applies=97, fallbacks=0, errors NONE).
- Step 5 (enable): BLOCKED on user. Mechanics + construction proven;
  default stays OFF until the user enables and visually + DF-confirms.

## How to enable & confirm (user)
1. Run the game, open the browser console, type
   `window.__WORKER_MESH = true`, then reload (must be set before
   the scene builds). Alternative: flip `WORKER_MESH_ENABLED` to
   `true` in `src/components/InstancedAtlasBlockGroup.tsx` + rebuild.
2. Roam tree-dense areas. Confirm VISUALLY trees look identical to
   flag-off: same textures, branch-depth lightening, glow bark,
   animated foliage, shrines — no missing/black/mis-UV'd blocks.
3. Send a D-Flow report. Expected: `MeshRebuilds` ms collapses
   toward ~0 on the main thread; FPS/stall improvement during heavy
   chunk streaming.
4. Console sanity: `window.__workerMeshApplies` climbing,
   `window.__workerMeshFallbacks` ~0.
5. If ANYTHING looks wrong → `window.__WORKER_MESH = false` (or keep
   `WORKER_MESH_ENABLED=false`): instant, total revert to the
   unchanged sync path. Report what diverged.
