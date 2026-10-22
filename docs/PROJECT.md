# DreadRoot: master doc

Last reviewed: 2026-Oct-22 (first version, built from the repo at v4.353.11 + agent notes).
Format + upkeep rules: ~/.claude/docs/PROJECT_DOCS_STANDARD.md. Shared services/modules for all of Geoff's projects: ~/.claude/docs/ASSETS_AND_MODULES.md.
Update the rows you touch in the same commit as the change. Edit in place; never rewrite this file wholesale.

## 1. Purpose and goals

DreadRoot (internal name "Fortress") is a browser-based 3D voxel FPS on three.js. Players climb and fight through giant trees (300+ blocks tall, with labyrinth interiors), build, loot, and battle many monster types. The same engine also runs **Siege Worlds** (ported from Unity) and **Pinkland** (a fork), switchable at runtime, sharing players and inventory.

Goals, in priority order:
1. **Smooth on every device**: steady 60 FPS now, 90 FPS next, 120 FPS / phone parity later (phases in docs/ARCHITECTURE_NORTHSTAR.md).
2. **Real multiplayer at scale**: 20-200 players in one world, same monsters for everyone, server-authoritative (Cloudflare Durable Objects). Plan: docs/MULTIPLAYER_CDO_PLAN_V3.md.
3. **One shared engine** for DreadRoot, Siege Worlds, Pinkland (extract last, once stable). Plan memory: DreadRoot master plan (NPC runtime, then server, then engine).
4. **A closed-loop economy**: Dread Points earned by kills, spent on ammo/blocks/land/items; outside currencies convert in, nothing converts out until GoBanq handles it. Plan: docs/DREAD_POINTS_PLAN.md, docs/CURRENCY_LEDGER_PLAN.md.
5. **Beautiful effects**: fire, lightning, smoke, particles, render mood (AgX tone mapping, bloom, image lighting), without breaking the FPS budget.

## 2. Non-negotiable requirements

- **FPS is king.** Every change is judged by its frame-time cost on a mid laptop and on phones. No new per-frame allocations, no React state for real-time data, no main-thread blocking. Measure with the perf harness protocol (section 7): 3 runs, discard the first, use the median.
- **Shared database = shared consequences.** DreadRoot, Pinkland and Siege Worlds use ONE Supabase project (`ditecxjpkgbqkeckebzb`, separated by a `game` column). Any SQL / server-function / data-format change hits ALL games. Port every game's client first, then flip the server. After a shared format change, bump the chunk-cache version in every repo.
- **Two agents co-build this repo** on the same branch. Read docs/COBUILD_NOTES.md. `src/version.ts` is ONE shared number: fetch, sync, then bump. Never `git add -A`; stage only your files.
- **Deploys from `claude1-recovery`**, not `main`. A push there auto-builds dreadroot.com on Cloudflare Pages.
- **Styling:** every value comes from the theme module; every panel uses GamePanel; no default-grey controls. Rules in docs/STYLE_GUIDE.md (auto-loaded for UI files via .claude/rules/ui-styling.md).
- **Never add UI elements without Geoff asking.** No toasts unless asked. No hover-only information.
- **Money:** in-game currency stays inside the game's own ledger (secure database functions only). Anything that touches real money or crypto goes through GoBanq / DiviGo (assets doc section 4). Prices from the shared feed only (assets doc section 6).
- **Never spoil story reveals** in names, titles, or blurbs (lore-heavy project).

## 3. Architecture (plain English first)

**The big picture:** the game is a website (React + three.js) served by Cloudflare. Player accounts, worlds, blocks, items and money live in Supabase. Big 3D models and textures come from Cloudflare R2. A separate live game server (a Cloudflare Durable Object, one per world instance) is being built to make multiplayer authoritative.

Three layers (the "L1 / L2 / L3" plan):
- **L1 = Supabase** (source of truth): accounts, worlds, chunks, items, balances, marketplace. Realtime channels currently carry player-vs-player positions (10 Hz).
- **L2 = the live game server**: `worker/` (Cloudflare Worker + Durable Object `dreadroot-l2` at server.dreadroot.com). Runs the tested, Cloudflare-free `GameInstanceCore` (`src/features/netcode/server/`) at 20 Hz, sends binary snapshots filtered to what each player can see. Not yet: join auth, saving back to L1, full enemy AI, prediction acks. Status: docs/MULTIPLAYER_CDO_PLAN_V3.md (supersedes older "nearly done" notes).
- **L3 = the client**: React app in `src/`. Three-tier cache for world data: memory, then IndexedDB (offline + fast reload), then Supabase.

**World data:** the world is 16x16-block columns ("chunks") with unlimited height. Collision uses every block; rendering uses only surface blocks (interior culled), drawn with instancing and a texture atlas. Trees are generated from seeds (deterministic), stored as compressed blueprints, grown server-side; clients refetch via chunk-version subscriptions. Docs: docs/CHUNKS.md, docs/TREES.md, docs/DATA_FLOW.md.

**Enemies / NPCs:** distance-based tick throttling (far monsters think less often), behavior trees (`mistreevous`), adapter per monster type, spatial index for fast "who's near me". Monster senses (sight/sound/smell, stealth) are owned by one window: see docs/COBUILD_SENSES_OWNERSHIP.md. Docs: docs/ENEMIES.md, docs/AI_BEHAVIOR_AUTHORING_PLAN.md.

**Workers (background threads):** chunk meshing and pathfinding run off the main thread. Everything else is on the main thread (a known limit).

**Hosting and services** (details and access in the assets doc):
- Cloudflare Pages project `dreadroot` (dreadroot.com; preview dreadroot.pages.dev, but login only works on the real domain).
- Cloudflare Worker + Durable Object `dreadroot-l2` (server.dreadroot.com).
- Cloudflare R2 bucket `dreadroot-assets` at https://assets.dreadroot.com (the ~11k-model Synty sci-fi library; Pages has a 20,000-file cap). One constant: `src/config/assetBase.ts`.
- Supabase `ditecxjpkgbqkeckebzb` (shared with Pinkland + Siege Worlds). Schema reference: `src/integrations/supabase/types.ts`. Edge functions + migrations in `supabase/`.
- LW-SSO for login (only dreadroot.com is allow-listed), plus Supabase anonymous auth for guests ("Play Without Acct").
- Stripe/PayPal subscriptions (docs/SUBSCRIPTION_PAYMENTS_SETUP.md) and DiviGo verification (docs/DIVIGO_VERIFICATION_SETUP.md): candidates to move into GoBanq.

**Key folders:**
| Folder | What lives there |
|---|---|
| `src/components/fortress/` | Main 3D scene, controls, HUD (shared with SWW: coordinate edits) |
| `src/components/siege/` | Siege Worlds layers (terrain, water, objects, monsters), gated on the active game |
| `src/components/ui/` | Shared UI pieces (shadcn/Radix based) incl. GamePanel |
| `src/features/<name>/` | One folder per feature or monster (enemies, inventory-system, netcode, parkour, pathfinding, trees, marketplace, wallet, points, supporters, tokenGates, starblink...) |
| `src/hooks/` | Chunk loader, block cache + realtime, multiplayer |
| `src/theme/` | Panel theme tokens + live editor store (the styling module, see STYLE_GUIDE.md) |
| `src/config/` | Runtime settings (active game/world/map, asset base, weapons, game registry) |
| `src/effects/`, `src/features/particles/` | Smoke, fire, particles (three.quarks, three-nebula) |
| `worker/` | L2 game server (Durable Object) |
| `supabase/` | Database migrations + edge functions |
| `scripts/` | ~70 check/bench/probe scripts (run via npm scripts) |
| `docs/` | Plans and system docs (60+ files) |

## 4. Features

| Feature | Status | Where | Notes |
|---|---|---|---|
| Voxel world, chunk streaming, 3-tier cache | Live | `src/hooks/useChunkLoader.ts`, `usePlacedBlocksWithCache.ts` | Cache version constant must bump on format changes |
| Giant trees (seeded, server growth) | Live | `src/features/trees/` | Watch Supabase cost of tree-growth jobs |
| Building / Fortress builder / object editor | Live | `src/features/fortressBuilder/`, `objectEditor/` | |
| Monsters (Shombie, Shpider, Shnake, Shroomer, Shtickman, Shwarm, Vortax, Walapa...) | Live | `src/features/<monster>/`, `src/features/enemies/ai/` | Behavior trees; combat registry |
| Weapons, combat, grenades, rocket belt, flame glove | Live | `src/features/combat/`, `grenades/`, `rocketBelt/` | Open issues: weapon not in hands, shots from camera (docs/OPEN_ISSUES.md) |
| Parkour | Live, being tuned | `src/features/parkour/` | Height audit doc |
| Inventory, vaults, loot, drop-to-world | Live | `src/features/inventory-system/`, `vault/`, `loot/` | Items stack only in vaults |
| Marketplace + fountain | Live (legacy DIVI balances) | `src/features/marketplace/` | To be unified onto Dread Points |
| Dread Points economy | Planned / partial | `src/features/points/` | Kills don't drop DP yet in DreadRoot |
| Supporter tiers / NFT + token gates | Live (display) | `src/features/supporters/`, `tokenGates/` | Real benefits must move to SSO `/api/gate` |
| Guest accounts | Live | Auth context | One guest per device |
| Player-vs-player multiplayer (Supabase Realtime) | Live | `src/hooks/useMultiplayer.ts` | Visibility only, not authoritative |
| Authoritative server (Durable Object) | Building | `worker/`, `src/features/netcode/` | See plan v3 |
| Siege Worlds world type + game switcher | Live (gated) | `src/components/siege/`, `GameSwitcher.tsx` | Window A owns |
| Mini Earth / Kaiju | Planned (plan only) | docs/MINI_EARTH_PLAN.md | |
| Panel theme editor (User/Admin/Debug/Build) | Live | `src/theme/`, `src/features/panelThemeEditor/` | Admin, Worlds, Settings, CSS |
| Render mood (AgX, bloom, IBL) | Live | effects / scene | Never add a light to the shared scene (forces shader recompiles) |
| Chat, NPCs, god-map, starblink worldgen | Live / varies | `src/features/chat/`, `npc/`, `god-map/`, `starblink/` | |

## 5. Modules this project PROVIDES (reusable elsewhere)

| Module | What it does | Location | How to reuse | Notes |
|---|---|---|---|---|
| GameInstanceCore (netcode server core) | Cloudflare-free authoritative sim + snapshots, prediction, lag compensation | `src/features/netcode/server/` | Copy and adapt (or shared engine later) | Heavily tested via `npm run check:netcode` |
| Behavior-tree NPC runtime | Monster AI that can run on client or server | `src/features/enemies/ai/` | Copy and adapt | Keep it pure / server-portable |
| Pathfinding (worker) | Voxel pathfinding off-thread | `src/features/pathfinding/` | Copy and adapt | |
| Particles / smoke / fire effects | three.quarks-based effects | `src/effects/`, `src/features/particles/` | Copy and adapt | three.quarks gradients are tuples at runtime |
| GamePanel shell | Draggable, resizable, blurred, glowing floating panel | `src/components/ui/GamePanel.tsx` | Copy and adapt (Pinkland, SWW use it) | |
| Panel theme system + live editor | Token model to CSS variables, per-game storage, editor UI | `src/theme/`, `src/features/panelThemeEditor/` | Copy and adapt | Good template for other projects' theme modules |
| R2 asset pipeline | glTF to single GLB, bulk upload, one base-URL constant | `scripts/gltf2glb.mjs`, `scripts/build_r2_scifi.mjs`, `src/config/assetBase.ts` | Copy and adapt | |
| Perf harness | Repeatable FPS measurement in a real browser | `scripts/perftest.ts` | Copy and adapt | Follow the protocol in section 7 |
| Guest accounts pattern | Anonymous Supabase user per device with token refresh | Auth context + `dreadroot-guest` IndexedDB | Copy and adapt | |

## 6. Modules this project USES from elsewhere

| Module | From | How |
|---|---|---|
| LW-SSO login + gating | ~/sso | Internal API |
| Siege Worlds content | Siege Worlds port | Lives in this repo (gated) |
| Shared Supabase | Pinkland + Siege Worlds | Same project; coordinate server changes |
| GoBanq / DiviGo (future: payouts, NFTs, prices) | GoBanq platform | Internal API (planned) |
| Kinet.ink characters (future NPC chat) | ~/kinetink | Character API |

## 7. Gotchas and hard-won knowledge

- `??` doesn't catch an empty array. Use a length check for `visibleBlocks` vs `blocks` fallbacks (classic "blocks vanish" bug).
- Perf measurement: single runs are useless. Close other game tabs, use the persistent browser profile, run 3x, discard run 1, use the median. Older "16 FPS catastrophe" was a broken harness, not the engine.
- A local `npm run build` failure means the Cloudflare deploy will fail silently. Run the typecheck (`npm run typecheck`) before pushing.
- Verify a deploy by comparing the live `assets/index-*.js` name with your local build, or the version badge top-left of the HUD.
- `meta author="Lovable"` in index.html is leftover scaffolding; Lovable isn't involved.
- Login can't be tested on dreadroot.pages.dev (SSO allow-list is dreadroot.com only).
- R2 secret keys are shown once. Never store credentials in /tmp.
- "Stretched fingers" on characters = a broken animation track; fix by stripping finger tracks.
- Adding a light to the shared three.js scene recompiles every shader (huge hitch). Don't.
- Pushes can hang; see the push-method note in agent memory.
- The service_role key leaked once and must be rotated (tracked in agent memory).

## 8. Open problems and next steps

- docs/OPEN_ISSUES.md (2026-Aug-26): weapons not rendered in hands, shots from camera, gravity about half, parkour climbs air, tracers from muzzle.
- Multiplayer plan v3: auth on join, prediction acks, server-owned monsters, saving to L1.
- FPS Phase A to B: remove stalls (chunk-stream allocation churn, initial load burst), off-thread meshing.
- Economy: wire kills to Dread Points, append-only DP ledger, unify marketplace onto DP.
- Styling debt (STYLE_GUIDE.md section 4): ~1,300 hard-coded colours in 177 files, 124 browser tooltips, 45 native dropdowns, 9 native sliders, 15 browser alert/confirm popups.
