# DreadRoot ("Fortress"): browser 3D voxel FPS on three.js, also runs Siege Worlds + Pinkland

Master doc: docs/PROJECT.md (read before any non-trivial change). Style guide: docs/STYLE_GUIDE.md (read before ANY UI work).
Shared services and modules for all of Geoff's projects: ~/.claude/docs/ASSETS_AND_MODULES.md. Doc rules: ~/.claude/docs/PROJECT_DOCS_STANDARD.md.

> **TWO CLAUDE INSTANCES CO-BUILD THIS REPO** on the same branch. Read docs/COBUILD_NOTES.md.
> Siege Worlds lives mostly in `src/components/siege/` + `src/config/`, with small gated edits to
> `FortressScene.tsx`, `FortressControls.tsx`, `FortressHUD.tsx` (shared: coordinate).

## Must-never (critical)

- **Never ship an FPS regression.** Performance is the top requirement on phones, tablets and desktops. No allocations in render loops, no React state for real-time data, no main-thread blocking.
- **Never change a shared database function or data format for one game only.** DreadRoot, Pinkland and Siege Worlds share ONE Supabase (`ditecxjpkgbqkeckebzb`). Port every client first; bump the chunk-cache version in every repo after.
- **Never hard-code styling values or use raw browser controls.** Theme module + shared components only (docs/STYLE_GUIDE.md). Every panel uses GamePanel.
- **Never `git add -A`.** Stage only the files you changed (shared working tree).
- **Never add UI elements Geoff didn't ask for.**

## How to work here

- Stack: React + Vite + TypeScript, three.js via react-three-fiber, Supabase, Cloudflare Pages + Worker/Durable Object, R2 for 3D assets.
- Deploy: push to **`claude1-recovery`** (NOT main); Cloudflare Pages auto-builds dreadroot.com. Verify via the HUD version badge or the live `assets/index-*.js` name.
- Version: `src/version.ts` is ONE shared number. `git fetch` first, sync to latest, then bump on every push (patch while finishing a feature, minor for something new).
- Before pushing: `npm run typecheck` must be clean (the build doesn't type-check, errors ship silently). Run the relevant `npm run check:*` scripts for the area you touched (`check:netcode` for netcode).
- Local builds are allowed but are the highest-risk step: check config + entry files for the known payload before and after (global rules).
- Game server: `worker/` (`dreadroot-l2`, server.dreadroot.com). Its logic lives in `src/features/netcode/server/` and is tested by the check scripts.
- Login only works on dreadroot.com (SSO allow-list), not the pages.dev preview.

## Communication

- Geoff isn't a coder: plain English, no code in replies, full file paths, calibrated confidence, end with the files changed and the version pushed.
- Don't ask technical yes/no questions; pick the sensible option and say what you did. Ask only when requirements are genuinely unclear.

## Critical performance patterns

Do:
- Use `useRef` for frequently changing data.
- Use instanced rendering for blocks and the texture atlas for tree blocks.
- Check `array?.length`, not `array ??`, for fallbacks (an empty array slips past `??`).
- Budget expensive work across frames; throttle distant entities (LOD).

Don't:
- Create objects in render loops (GC stutter).
- Call expensive hooks repeatedly per component.
- Fetch the whole world when one chunk changed.
- Add a light to the shared three.js scene (recompiles every shader).

Measuring: follow the perf harness protocol in docs/PROJECT.md section 7 (3 runs, discard the first, median).

## Where things live

| Area | Location |
|---|---|
| Chunk loading, cache, collision | `src/hooks/useChunkLoader.ts`, `src/hooks/usePlacedBlocksWithCache.ts`, `src/contexts/BlocksContext.tsx` |
| Main scene / HUD / controls | `src/components/fortress/` |
| Block rendering | `src/components/PlacedBlocks.tsx`, `src/components/InstancedAtlasBlockGroup.tsx` |
| Trees | `src/features/trees/` |
| Enemy AI | `src/features/enemies/ai/` (+ one folder per monster in `src/features/`) |
| Netcode + server core | `src/features/netcode/`, `worker/` |
| Theme / panels | `src/theme/`, `src/components/ui/GamePanel.tsx` |
| Database schema reference | `src/integrations/supabase/types.ts` |

System docs: docs/ARCHITECTURE_NORTHSTAR.md, docs/MULTIPLAYER_CDO_PLAN_V3.md, docs/PERFORMANCE.md, docs/DATA_FLOW.md, docs/CHUNKS.md, docs/TREES.md, docs/ENEMIES.md, docs/OPEN_ISSUES.md.

## Common tasks

- New enemy type: folder `src/features/{enemy}/` with types, constants, index and a renderer; adapter in `src/features/enemies/ai/adapters/`; register in EnemyManager. Senses (sight/sound/smell) belong to the senses window: route through `acquireTarget()`.
- New tree decoration: add the block type to `TreeBlockType`, encode it in `blockTypeEncoder.ts`, generate it in `treeGrowth.ts`, add its texture to the atlas.
- Chunk bugs: check the `[CameraTrackedBlocks]` console log, `loadedChunksRef.size`, and `visibleBlocks.length` vs `blocks.length`; look for `??` vs length-check bugs.

## After making changes

Audit for broken functionality, FPS regressions, data-flow bugs, orphaned or duplicate code, and hard-coded values. List every file added or changed.

## Doc upkeep

- Follow ~/.claude/docs/PROJECT_DOCS_STANDARD.md section 5: update docs/PROJECT.md (features, modules, gotchas, open problems) in the same commit as the change; keep this file under 150 lines.
- Last doc review: 2026-Oct-22
