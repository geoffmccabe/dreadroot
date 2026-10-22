# DreadRoot as its own game — split plan

Written 2026-Oct-22 against v4.353.12. Everything in "Measured" was checked on this
machine today. Everything after is a recommendation.

## The headline: do NOT fork the repo

DreadRoot, Siege Worlds, Pinkland and Kaiju already live in ONE codebase and are
already separated logically, by `src/config/gameRegistry.ts`. What is NOT separated
is the BUILD, the ASSETS and the DATA. That is where the split belongs.

Forking the source was tried before and reverted: see
[[project_siege_worlds_dreadroot_integration]] — "reuse same code, build the
universal engine, NO bespoke forks (got burned building a bespoke shooting system)".
Forking now would duplicate the engine three ways and guarantee the FPS work has to
be done three times.

**Split the outputs, not the source.**

## Measured today

| Thing | Value | Why it matters |
|---|---|---|
| Deployed build (`dist/`) | **927 MB** | Every visitor's browser faces this. Also the Epic download. |
| `public/siege/` | **697 MB of it** | Siege Worlds assets. DreadRoot never loads most of them. |
| Of that, SHARED with DreadRoot | characters 88 MB, weapons 16 MB | Must stay. |
| Of that, NOT needed by DreadRoot | world 177, monsters 157, buildings 133, city 21, scifi_demo 20, enchanted-forest 13 = **~520 MB** | The whole Epic "small initial download" problem, solved by not shipping them. |
| Stray | `public/PlayerSkins.fbx` 34 MB | An FBX source file being served to browsers. |
| R2 asset host | `assets.dreadroot.com`, live | Already does exactly what the Epic brief asks — but only for the 11k Synty models. |
| Games registered | dreadroot (voxel), siege-worlds (non-voxel), pinkland (off), kaiju-lab (a world) | The seam already exists. |
| Trees as share of triangles | **83%** | DreadRoot's FPS problem, almost entirely. |
| Block faces drawn that are buried | **76%** | Measured against the live world. |
| LOD code in the tree/voxel renderer | **none** | Kaiju's globe has 7 files of it. |
| Multiplayer | Supabase Realtime works; the Durable Object is built and live but inert | `docs/MULTIPLAYER_CDO_PLAN_V3.md` is the authority, not this doc. |

## Workstreams, in dependency order

### 1. Per-game builds (unblocks everything else)
One repo, several build targets, each with its own asset list and its own domain.
`dreadroot.com` builds DreadRoot only. Siege Worlds, Land World and Kaiju get their
own targets. No gameplay code is copied.

Expected: DreadRoot's deploy drops from 927 MB to roughly 200 MB. That is the same
work item as the Epic brief's section 4, done once for both.

### 2. The shared backpack (what makes jumping between games work)
Already mostly built and in the right place — ONE Supabase holds `items`,
`user_slots`, `user_token_balances`; LW-SSO is the identity provider; DiviGo/GoBanq
handle money and KYC; `src/features/tokenGates/` reads WAX NFT holdings.

The gap is that it is reachable only from inside this repo. Promote it to a service
with an API so every game — including ones not in this repo — reads the same
backpack. Nothing needs re-architecting; it needs a front door.

Decide early: does an item carry its STATS between games, or only its identity and
skin? Recommendation is identity + skin, with each game owning its own balance
numbers. Otherwise every game is balance-locked to every other game forever.

### 3. Asset manifest on R2
Extend what `src/config/assetBase.ts` already does to all large assets: a versioned
manifest with content hashes, download-on-demand, cache locally, never re-download
unchanged files. Browser caches to IndexedDB; Electron caches to disk.

This is one system serving three purposes — browser load time, Epic download size,
and Epic patch size.

### 4. FPS (non-negotiable, runs in parallel from day one)
Two separate problems, both measured:
- **Triangles.** 76% of block faces drawn are buried against a neighbour. The ground
  fix already shipped (-305 K). Trees are the remaining 83%.
- **No LOD.** Distant trees render at full detail. Kaiju's globe already solves this.

### 5. Multiplayer authority
Follow `docs/MULTIPLAYER_CDO_PLAN_V3.md` as written. Do not re-plan it here. Its
sequencing — monsters before player authority — is correct and was arrived at by
audit. Note its live economy holes are real today and independent of multiplayer.

### 6. Electron for Epic
Thin wrapper, last. Small once 1 and 3 are done. Needs a platform layer for file
cache, auth return, and wallet connect (browser extension wallets will not work
inside Electron). No second auto-updater — Epic patches the app.

## What to take from which game

| Take | From | Why |
|---|---|---|
| Level-of-detail and tile streaming | Kaiju globe (`src/components/siege/globe/`) | 7 files of working LOD. The voxel/tree renderer has none and needs it most. |
| Non-voxel terrain, object editor, mesh parkour scanner, WAX token gates, WAX wallet | Siege Worlds | Genuinely ahead here, and all of it is game-agnostic already. |
| R2 catalog + asset-base pattern | Siege Worlds | The manifest work starts from this, not from scratch. |
| Combat, enemy AI (behaviour trees), inventory, voxel world, netcode/DO | DreadRoot | DreadRoot is ahead; the others consume it. |

## Risks worth naming

- **The 927 MB build is the single biggest threat to both FPS-on-load and Epic.**
  Everything else is tractable; this one is just large.
- **Two conflicting character height tables** (`heightM` vs `targetH`) and weapon
  sizes that do not transfer between the tuner and the game — see
  `docs/PARKOUR_HEIGHT_AUDIT.md`. Fix before more per-character tuning, not after.
- **Live economy holes** listed in the multiplayer plan are exploitable now.
- Shared `src/version.ts` across sessions stays shared after the split; per-game
  versions will need a decision.
