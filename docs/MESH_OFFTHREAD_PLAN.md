# #2 — Off-thread mesh build (Phase 2a). Execution contract.

Goal: move the ~9s of main-thread per-chunk InstancedMesh rebuilds
(`doRebuildSync`/budgeted path in InstancedAtlasBlockGroup.tsx) onto the
existing (dormant) mesh worker, with **zero visual change**. Phase 2b
(greedy meshing) is DEFERRED — it requires a per-chunk Mesh and breaks
raycasting / shrine glow / falling blocks (5× harder); only revisit if
2a is insufficient.

## Hard rules
- Never regress without permission. Each step below is its own commit,
  build-verified + headless-smoke (no crash, blocks render) before the next.
- The worker output MUST be byte-identical to the sync path. A fallback
  only catches crashes, NOT wrong pixels — so parity is guaranteed *by
  construction*: the worker does NOT re-derive UV/anim/color logic. The
  main thread precomputes, per distinct block_type in the chunk, the exact
  uvOffset / anim / color-base using the SAME canonical functions the sync
  path uses (getInstanceUVsForTreeBlock, getTreeBlockAnimationInfo,
  glow-bark/shrine/branch-depth rules), packs a tiny per-build table, and
  the worker only does arithmetic + table lookups.
- Worker path is fallback-guarded: any error/timeout/version-mismatch →
  existing `doRebuildSync`. Budgeted + incremental paths stay intact.
- Async safety: result tagged with a build version; ignored if the chunk
  unmounted or a newer rebuild started (mirror existing rebuildStateRef
  version checks). Shared material never disposed on unmount.

## Verified step sequence (one commit each)
1. **blockPack util (NEW, isolated, NOT wired):** pure function — given a
   chunk's blocks, produce (a) a small table of distinct draw params
   {uvOffsetX,uvOffsetY, animBaseSlot|−1, colorR,colorG,colorB} computed
   via the canonical sync-path functions, and (b) transferable typed
   arrays: Int32 positions, Uint16 tableIndex, (no per-block strings).
   Self-audit: round-trip equals what doRebuildSync would compute for a
   sample set. Zero render risk (unused).
2. **Worker accepts packed input:** extend meshWorker/meshWorkerPool to
   take {positions, tableIndex, table} via transferables, output
   {matrices|positions, uvOffsets, colors, bounds} Float32Arrays
   (transfer back). Self-audit vs sync output equality on a fixture.
   Still not wired into render.
3. **Wire behind a flag + fallback:** in InstancedAtlasBlockGroup, for
   the heavy (≥2000) path, submit to the worker; on valid result apply
   atomically (reuse the existing finalize: attrs needsUpdate then
   mesh.count last, version-guarded); on any failure → doRebuildSync.
   Keep <2000 sync, keep incremental path. Headless smoke + build.
4. **Parity gate ON + measure:** enable for real; user DF report must
   show MeshRebuilds ms collapse with no visual diff. If parity is ever
   uncertain, stop and keep sync.
5. Only if 2a insufficient after a real DF: open Phase 2b design.

## Status
- Step 0: investigation + design — DONE (this doc).
- Step 1: next.
