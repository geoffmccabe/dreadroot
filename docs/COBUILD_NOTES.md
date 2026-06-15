# Co-Build Coordination — Two Claude Instances on One Repo

**Read this if you are a Claude working on the Dreadroot repo.** Two Claude instances are
building this codebase in parallel, on the same branch (`claude1-recovery`, which builds
dreadroot.com). This doc keeps us from colliding.

## Who's doing what

- **Window A — Siege Worlds (SWW) integration.** Adds a second world type ("Siege Worlds")
  to the Dreadroot engine as **additive, gated modules**, plus a ⚔️ game switcher. Goal: one
  engine, multiple games (Dreadroot, Siege Worlds, later Pinkland), shared player/inventory,
  switchable at runtime. Building toward a metaverse-scale multiplayer FPS world.
- **Window B — core Dreadroot engine + EMS NPC system** (shipped EMS NPC v1 = 4.28.0).

We are co-building. Neither should assume it's alone in the repo.

## What SWW has added so far (so you know what's new and why)

- `src/config/activeGame.ts` — runtime active-game store (`useActiveGame()`), `getActiveGame()`,
  `setActiveGame()`. The whole SWW path is gated on `getActiveGame() === 'siege-worlds'`.
- `src/components/GameSwitcher.tsx` — the ⚔️ top-right switcher (Dreadroot / Siege Worlds / Pinkland).
- `src/components/siege/*` — the entire Siege world: SiegeWorldLayers (terrain + water + objects +
  monsters), TerrainLayer, WorldObjectsLayer, WaterLayer, MonsterEnemy, terrainHeight, SiegeTitleSplash.
- `src/config/worldDefinition.ts`, `public/siege/*` — SW world data + assets.
- `docs/SIEGE_WORLD_PERF_PLAN.md` — the open-world rendering perf plan (world-agnostic
  SceneCellStreamer; will become core engine infra; relevant to you too).

**Everything SWW does in the live game is gated behind `isSiege`/`!isSiege`.** When the active
game is Dreadroot (the default), SWW renders nothing and disables nothing — Dreadroot is untouched.

## File ownership / conflict risk

- **SWW-owned, additive — near-zero conflict (Window A edits freely):**
  `src/components/siege/*`, `src/config/activeGame.ts`, `src/config/worldDefinition.ts`,
  `src/components/GameSwitcher.tsx`, `public/siege/*`, `docs/SIEGE_WORLD_PERF_PLAN.md`.
- **SHARED CORE — HIGH conflict risk, both windows edit these. Coordinate:**
  - `src/components/fortress/FortressScene.tsx` — SWW added: `isSiege`, the world render branch
    (`{isSiege ? <SiegeWorldLayers/> : <CameraTrackedBlocks/>}`), the spawn/world-swap teleport,
    `enemiesEnabled && !isSiege`, and `{!isSiege && ...}` wrappers around DR scenery.
  - `src/components/fortress/FortressControls.tsx` — SWW added the gated `forceFloat` prop (+ effect)
    and (incoming) a `groundHeightFn` prop for terrain walking. All gated, no DR behavior change.
  - `src/components/fortress/FortressHUD.tsx` — SWW mounts `<GameSwitcher/>` + `<SiegeTitleSplash/>`.
- If you must edit a shared-core file, keep changes localized; SWW's additions there are all
  small and gated, so merges usually auto-resolve. **Fetch before you push.**

## Versions — ONE shared number

`src/version.ts` is a **single shared version** for the whole dreadroot.com build. Both windows
bump it. Rules:
- **Always sync to the latest before pushing, then increment from THAT** (never from a stale base).
  The number only goes up.
- **Minor (4.X.0) = a COMPLETED feature/system. Patch (4.X.Y) = in-progress or small fixes.**
- **You cannot reserve a specific number for a specific feature** — whoever ships first takes the
  next number. (E.g. SWW is mid-feature in the 4.28.x patch range now, after EMS took 4.28.0.)
- State the new vX.Y.Z in your reply so the human (and the other window) can see it advanced.

## Avoiding stepping on each other

1. **`git fetch` before pushing.** If the push is rejected, merge the other window's commit
   (usually clean — our work is mostly in different files), reconcile `src/version.ts` to
   latest + 1, rebuild, push.
2. **Keep new work in your own files** where possible (SWW lives almost entirely under
   `src/components/siege/` + `src/config/`). Additive beats invasive.
3. **In shared-core files, gate your additions** behind a clear flag so the other path is
   untouched and merges don't fight.
4. **`npm run build` + `npx tsc --noEmit` before every push** (prod build is esbuild — no
   typecheck), so a merge of two feature sets doesn't ship a broken build.
