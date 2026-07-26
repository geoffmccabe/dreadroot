# MINI EARTH - P1 "Kaiju Lab" detailed build plan

The executable version of Phase P1 from `docs/MINI_EARTH_PLAN.md`. Read that first for the why;
this is the what, in order, with file paths.

Written 2026-Jul-26. Nothing built yet. Disk checked: 42 GB free, enough.

**Goal of P1:** Cmd-J to a new map, fly around a recognisable mini Earth, dive at a continent, see
one of our animated monsters standing on it as a Kaiju, cycle between four monsters, and scale one
up and down in 5% steps with speed and animation following automatically.

---

## Fixed technical decisions

Settle these now so no step re-opens them.

**Coordinate scale.** 1 game unit = 100 real metres. Planet radius **63,710 units**.

**Elevation storage.** Tiles store raw elevation in **metres as signed 16-bit integers**, not units.
The client divides by 100 on load. This keeps the scale factor a runtime constant, so it can be
changed later without regenerating a single tile.

**Geometry.** Cube-sphere: six faces, each a quadtree. A tile is **257 x 257 samples** (256 quads
plus a shared edge row and column).

**Levels.** A cube face spans 100,075 units of arc, so sample spacing at level L is 391 / 2^L units.

| Level | Sample spacing (units) | Real-world spacing | Tiles (all 6 faces) |
|---|---|---|---|
| 0 | 391 | 39.1 km | 6 |
| 1 | 195 | 19.5 km | 24 |
| 2 | 97.7 | 9.8 km | 96 |
| 3 | 48.9 | 4.9 km | 384 |
| 4 | 24.4 | 2.4 km | 1,536 |
| 5 | 12.2 | 1.2 km | 6,144 |

The 60 arc-second source is 1.85 km real, so **level 5 is the honest floor**. Ship levels 0 to 4
first (2,046 tiles, about 270 MB) and add level 5 only if the flythrough looks too soft.

**Hosting.** R2, bucket `dreadroot-assets`, served from `https://assets.dreadroot.com` through the
existing `src/config/assetBase.ts`. Not Pages, which has a 20,000 file cap per deploy.

**Tile URLs.** `/siege/earth/h/{face}/{level}/{x}_{y}.bin`, plus one
`/siege/earth/manifest.json` carrying scale, radius, tile size, and which levels exist.

---

## Stage A - the data (offline, no game changes)

Nothing in the game moves during Stage A. If it goes wrong, nothing is broken.

### A1. Download the source

One file, 478 MB: `ETOPO_2022_v1_60s_N90W180_surface.nc` from NOAA's THREDDS server. Ice-surface
version, global, land and ocean in one grid.

New script: `/Users/geoffreymccabe/dreadroot/scripts/earth/fetch_etopo.sh`

Downloads into `/tmp/earth-src/`, not into the repo. Nothing here is ever committed.

**Test:** the file exists and opens.

### A2. Write the tiler

New script: `/Users/geoffreymccabe/dreadroot/scripts/earth/build_earth_tiles.py`

What it does: for each of the six cube faces, for each level, for each tile, compute the sphere
direction of every one of the 257 x 257 samples, convert that direction to latitude and longitude,
bilinearly sample the ETOPO grid, and write the result as raw int16 metres.

Also writes `manifest.json`.

Dependencies: numpy and either netCDF4 or xarray. No GDAL needed for this path, which keeps the
install small.

**Test:** run it for level 0 only, six tiles. Dump each to a greyscale PNG and eyeball it. The
continents must be recognisable and in the right places. This is the single most important check in
Stage A, because a seam or axis error here is invisible later and poisons everything.

### A3. Generate the full pyramid

Run levels 0 to 4. Output to `/tmp/earth-tiles/`, roughly 2,046 files and 270 MB.

**Test:** file count and total size match expectation, and spot-check tiles at level 4 over places
with known shapes: the Italian boot, the Red Sea, the Himalayas, the Mariana Trench.

### A4. Upload to R2

New script: `/Users/geoffreymccabe/dreadroot/scripts/earth/upload_earth_r2.sh`

`wrangler` and `rclone` are both installed, but **rclone has no remotes configured**, so the first
job is confirming how the existing 22,862 scifi assets get pushed and reusing that path. Either
configure an rclone R2 remote with S3 credentials, or use `wrangler r2 object put`.

**Test:** fetch one tile URL in a browser and get 132,098 bytes back. Confirm the CORS headers allow
the game origin, since this is a cross-origin binary fetch.

### A5. Clean up

Delete `/tmp/earth-src` and `/tmp/earth-tiles`. Permanent laptop cost after Stage A: zero.

---

## Stage B - the globe renders

All new files under `src/components/siege/globe/`. Three shared files get small additive edits,
listed at the end.

### B1. The cube-sphere maths

New: `src/components/siege/globe/cubeSphere.ts`

Pure functions, no React, no three.js state: face and uv to unit direction, unit direction to face
and uv, direction to latitude and longitude, latitude and longitude to direction, tile index to its
uv rectangle, and the world-space position of a sample given its direction and elevation.

**Test:** a small round-trip check. Convert a few hundred random directions to face and uv and back,
and confirm they land within floating point noise. Do this before anything renders, because every
later bug will look like a rendering bug and actually be here.

### B2. Tile fetching and caching

New: `src/components/siege/globe/earthTiles.ts`

Fetch a tile by face, level and index, decode into an Int16Array, cache in memory with an LRU, and
expose a synchronous "do I have this tile" check plus an async request. Requests go through the
existing budgeted work queue so tile decoding cannot stall a frame.

**Test:** a console-triggered fetch of a known tile returns the right byte length and plausible
elevation values, sea level near zero over open ocean and around 8,800 near Everest.

### B3. One patch, no LOD

New: `src/components/siege/globe/GlobeTerrain.tsx`, first version.

Render exactly the six level-0 tiles as six displaced patch meshes. No quadtree, no splitting, no
streaming. Flat shading is fine.

**Test:** a lumpy sphere appears, and it is recognisably Earth. This is the first moment the project
is real.

### B4. The quadtree and LOD

Extend `GlobeTerrain.tsx`.

Split a node when its arc length divided by its distance to the camera exceeds a threshold, which is
a screen-space error test. **Hysteresis is mandatory**: split at the threshold, merge only at about
0.7 of it, or nodes thrash at the boundary and the frame rate collapses. Cap depth at the deepest
level in the manifest. Load tiles on demand and unload nodes that merge away.

**Skirts.** Each patch carries a ring of vertices around its edge dropped by a fraction of its arc
length. Without them, every boundary between two different LOD levels shows a visible crack.

**Test:** fly in and out. Detail increases smoothly as you approach, there are no cracks between
patches, and the frame rate holds. Watch for popping at the split boundaries.

**This step is the bottleneck of the whole phase.** This repo has a documented history of terrain
performance traps, including one plausible optimisation that made the frame rate twenty times worse.
Build it distance-based from the first commit and measure with the existing D-Flow panel.

### B5. The ocean

New: `src/components/siege/globe/GlobeOcean.tsx`

A sphere at radius 63,710 units, which is elevation zero, semi-transparent, with a distinct colour.
That single shell instantly turns the lumpy grey ball into a recognisable planet.

**Test:** oceans read as oceans from orbit, coastlines look right.

### B6. Wire it into the map system

**This is a full Siege Worlds map, not a stripped-down demo scene** (Geoff, 2026-Jul-26). It keeps
every normal feature: firing weapons, jumping, jet boost, the inventory and quickslots, all the
HUD panels, crypto and SSO, coins and loot, challenges, monster spawning with `@` and `!`, the
third-person avatar, teleport. The only thing new is the ground under it.

That works out cheaply because of how `SiegeWorldLayers.tsx` is already written. Universal systems
(teleport, spray attacks, blood, damage numbers, challenge runner, spawn intro, self avatar, placed
objects) mount unconditionally on every siege map. Only *place-specific* scenery is gated by the
`isBlank` flag.

So the correct wiring is the opposite of "gate everything off":

- `src/config/worldDefinition.ts`: add `globe` to `GroundKind`, add `KAIJU_LAB_WORLD` with id
  `kaiju-lab` and `kind: 'siege'`, register it in `SIEGE_WORLDS`.
- `src/components/siege/SiegeWorldLayers.tsx`: mount the globe layers for the new ground kind, and
  include `globe` in the existing `isBlank` set so SWW's place-bound scenery stays off (Bleakrock
  horror fog, the beach ambient enemies, the lobby portal effect, the region spawner). Everything
  else stays exactly as it is on every other siege map.
- The Cmd-J teleport list: add a letter for the Kaiju Lab.

**The player physics hook.** The existing engine already has the right seam:
`setDynamicHeightProvider(fn)` in `src/components/siege/terrainHeight.ts`. Install a provider that
answers globe elevation for the player's local tangent patch, and the standard controller works
unmodified: gravity, jumping, ground-follow, weapons, coins, monsters and boulders all go through
`sampleHeight` and none of them need to know they are on a sphere. This is the tangent-patch design
from `MINI_EARTH_PLAN.md` §4, and it is why P1 can keep full gameplay without touching
`FortressControls.tsx`.

The tangent frame re-bases when the player travels far from its origin, using
`renderSpace.setRenderOrigin`, which exists for exactly this.

**Test:** Cmd-J to the lab. Guns fire, you can jump and jet-boost, the HUD and panels are all there,
`@` spawns a monster that stands on the ground. Then Cmd-J back to Siege Worlds and confirm nothing
leaked either way: no fortress colliders at the origin, no DreadRoot monsters, no invisible walls,
no vault prompt. That leak class is documented across many versions and it will happen if the
`isBlank` wiring is skipped.

---

## Stage C - the camera

### C1. Free-fly

New: `src/components/siege/globe/GlobeFlyCamera.tsx`

Six-degrees-of-freedom flight with **speed proportional to altitude above the surface**, clamped at
both ends. Without that scaling the camera is either uselessly slow in orbit or uncontrollable near
the ground.

**Test:** orbit the whole planet, then dive to a coastline and stop just above the surface, all with
one set of controls and no gear changes.

---

## Stage D - the Kaiju

### D1. One monster on the surface

Extend `GlobeTerrain.tsx` or add a small `GlobeKaiju.tsx`.

Place one `CatalogMonster` at a chosen latitude and longitude, sitting on the terrain height there,
oriented so its up vector is the surface normal rather than world up.

**Test:** fly down and find a Fort Golem standing upright on a continent, correctly oriented, not
half-buried and not floating.

### D2. Monster cycling

New: `src/components/siege/globe/kaijuLabState.ts` and
`src/components/siege/globe/KaijuLabController.tsx`

`[` and `]` cycle a four-entry list: Fort Golem (type 17), Mechanical Golem (16), Elemental Golem
(15), Red Demon (8). Keys chosen because they are unused, and the controller only mounts on the
Kaiju Lab map so it cannot interfere with play keys elsewhere.

**Test:** all four appear, animated, correctly grounded.

### D3. The scale tool

`-` and `=` scale the current Kaiju by 5% per press, compounding.

The maths, from dynamic similarity, all derived from one ratio:
- size ratio = current height divided by the monster's base height
- movement speed multiplier = square root of that ratio
- animation speed multiplier = one divided by the square root of that ratio

Drives the `mods.sizeMul` and `mods.speedMul` that `CatalogMonster` already accepts, and the
`animSpeed` that `MonsterEnemy` already accepts. **This is wiring existing knobs, not new systems.**

Gravity stays at its normal value. A giant already looks slow because it is big; lowering gravity as
well reads as moon gravity, which is a different effect. A separate gravity multiplier defaulting to
1 is exposed so it can be overruled by eye.

**Test:** hold `=` and watch a Fort Golem grow from 12 units to over 100, getting visibly slower in
its animation and covering ground faster, without the motion looking wrong.

### D4. The readout

New: `src/components/siege/globe/KaijuLabHud.tsx`, mounted in `FortressHUD` gated to this map.

Shows: monster name and type, height in game units, implied real-world height (units times 100),
the scale multiplier versus base, and fixed reference values, Everest at 88.5 units, average ocean
depth 37 units, planet radius 63,710 units.

**Test:** at 100 units the readout says roughly "10 km real, 1.13 x Everest" and the Kaiju size
question answers itself by looking rather than by arithmetic.

---

## Stage E - ship it

### E1. Checks and push

- `npx tsc --noEmit` must pass before any push. Standing rule.
- `git fetch` first. Another Claude is building on the same `claude1-recovery` branch and
  `src/version.ts` is one shared number, so sync to latest before incrementing.
- **Stage by explicit path.** Never `git add -A` or `git add <dir>` in this repo. There is a
  documented incident where staging a directory pulled in 309 MB of untracked assets and broke every
  deploy.
- Bump `src/version.ts`. This is a meaningful new system, so a minor bump.
- Push to `claude1-recovery`, which is what Cloudflare Pages deploys from. Not `main`.

**Test on the live site:** Cmd-J to the Kaiju Lab, fly the planet, cycle monsters, scale one up.

---

## Files touched

**New, 11 files:**
- `scripts/earth/fetch_etopo.sh`
- `scripts/earth/build_earth_tiles.py`
- `scripts/earth/upload_earth_r2.sh`
- `src/components/siege/globe/cubeSphere.ts`
- `src/components/siege/globe/earthTiles.ts`
- `src/components/siege/globe/GlobeTerrain.tsx`
- `src/components/siege/globe/GlobeOcean.tsx`
- `src/components/siege/globe/GlobeFlyCamera.tsx`
- `src/components/siege/globe/kaijuLabState.ts`
- `src/components/siege/globe/KaijuLabController.tsx`
- `src/components/siege/globe/KaijuLabHud.tsx`

**Edited, 4 files, all small and gated:**
- `src/config/worldDefinition.ts`
- `src/components/siege/SiegeWorldLayers.tsx`
- the Cmd-J teleport list
- `src/version.ts`

Deliberately **not** touched: `src/components/fortress/FortressControls.tsx`. That file is 3,429
lines, hardcodes world-up, and is co-built with another Claude. Keeping P1 out of it is the single
biggest risk reduction available, and it is achievable even with full gameplay on the map, because
the tangent-patch height provider (step B6) lets the existing controller work unchanged. True
sphere-walking, where up rotates as you circle the planet, is P2 and gets its own controller.

---

## Suggested checkpoints for Geoff

Five points where it is worth stopping and looking, rather than one big reveal at the end:

1. **After A2**: six greyscale images of the cube faces. Are the continents right?
2. **After B3**: a lumpy Earth-shaped sphere on screen, no LOD, no camera work.
3. **After B4 and B5**: a proper planet you can fly around.
4. **After D1**: a Fort Golem standing on it.
5. **After D3**: the scale tool, which is where the design question gets answered.

Each is a natural place to change direction cheaply.

---

## Known limitations of P1, by design

Terrain will look smooth and under-detailed close up, because level 4 is a sample every 2.4 real
kilometres and there is no procedural detail yet. Ground will be untextured or flat-coloured, since
biome materials are P3. There is no walking, no swimming, no gameplay of any kind. All of that is
expected and is what P2 through P4 are for.
