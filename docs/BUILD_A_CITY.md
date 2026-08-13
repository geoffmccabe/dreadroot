# Build a City

**This document is the prompt.** Hand it to an agent with a city name and it should produce a
working, fightable city in one pass. Everything below was learned by building Dubai, mostly by
getting it wrong first; the warnings are not stylistic, they are the specific ways this has already
failed.

---

## What you are building

A **site** is somewhere a Kaiju battle can happen. It has a place on the planet, a Kaiju roster, a
garrison of humans, and — if it is a city — buildings, roads, waterways and a coastline.

Everest (B1) and the Grand Canyon (B2) are sites with no city block. Dubai (B3) is the full thing.
Your job is to add B4, B5, B6… as asked.

**One file defines a site. One JSON drives its bakes. Nothing else in the codebase changes.**

---

## Step 0 — before you touch anything

Read these three files completely. They are short and they contain the reasoning behind every number
you are about to copy:

| File | Why |
|---|---|
| `src/components/siege/globe/sites/siteTypes.ts` | The data model, with the reason for every field |
| `src/components/siege/globe/sites/b3-dubai.ts` | A complete worked example, heavily annotated |
| `scripts/city/cityConfig.mjs` | How the bakes find their origin, and why it must be shared |

Then check what shortcode is free in `src/components/siege/globe/sites/index.ts`.
**Digit1–Digit9 only.** `Digit0` is already "reset Kaiju size" and a site put there silently never
fires — a bug that looks exactly like the site being broken.

---

## Step 1 — choose the origin and the boxes

Pick a **projection origin** (`lat0`, `lon0`) near the centre of the built area. Everything is stored
as metres east and south of it, as int16 or float32, which is what keeps a whole city to about
1.5 MB.

> **The origin must be identical across all four bakes.** Buildings, roads, water and the land mask
> each turn latitude and longitude into metres, and if two of them disagree by 100 m the traffic
> drives beside the roads and the coastline cuts through the towers. This is why the origin lives in
> the config and not in the scripts.

Then pick two boxes:

- **`bbox`** — the built area to fetch buildings and roads from.
- **`coastBbox`** — for a coastal city, a *wider* box for the coastline. It must extend past both
  ends of the built area, or the flood fill that decides which side is the sea leaks around the end
  of your coastline and swallows the land behind it.
- **`seaSeed`** — `[lat, lon]` of a point in **open water**, inside the mask grid. This is where the
  flood fill starts, and it is not optional for a coastal city.

> **Getting `seaSeed` wrong inverts the entire mask, silently.** It used to be hardcoded to the
> grid's north-west corner, which is 25 km out in the Gulf *for Dubai*. New York's north-west corner
> is the New Jersey Meadowlands: seeding there floods the **land**, and everything the flood cannot
> reach — the Hudson, the East River, the Upper Bay — becomes "land". Manhattan comes out as sea and
> the rivers as fields, in a file that is the right size and reports success.
>
> Pick somewhere unambiguous and well inside `maxRangeMetres`. The bake now refuses a seed that
> falls outside the grid or lands on the coastline itself, and fails if the flood covers under 3% or
> over 90% of the grid — but the seed is still yours to choose.

Keep the whole city inside about **±26 km** of the origin. That is `maxRangeMetres`, and int16 metres
tops out at 32,767.

### Split a big city into `areas`

Overpass times out on one large dense query. Dubai is fetched as four sub-boxes. Add an `areas`
array of `{name, s, w, n, e}` for anything sprawling; omit it for a compact city and the whole bbox
goes in one request.

---

## Step 2 — write the config

`scripts/city/cities/<slug>.json`:

```json
{
  "slug": "osaka",
  "name": "Osaka",
  "lat0": 34.69, "lon0": 135.50,
  "bbox": [34.60, 135.40, 34.75, 135.58],
  "coastBbox": [34.50, 135.25, 34.85, 135.70],
  "coastal": true,
  "groundMetres": 1.5,
  "maxRangeMetres": 26000,
  "maskCellMetres": 40,
  "maskSubdivide": 4
}
```

`maskCellMetres` is **40** because the terrain mesh resolves 38 m at full detail. Finer is detail the
ground cannot draw; coarser and the coast visibly steps. Do not change it without a reason.

---

## Step 3 — run the bakes, in this order

```
node scripts/city/fetch-buildings.mjs <slug>     # the boxes. slowest step, resumable
node scripts/city/make-water.mjs      <slug>     # also downloads the coastline the mask needs
node scripts/city/make-landmask.mjs   <slug>     # needs make-water to have run
node scripts/city/make-roads.mjs      <slug>
node scripts/city/make-bridges.mjs    <slug>     # needs the land mask — see below
node scripts/city/make-detail.mjs     <slug>     # edits buildings.bin, so before make-ground
node scripts/city/make-ground.mjs     <slug>     # LAST: it samples both buildings.bin and detail.bin
```

**Run each stage in a loop until a round adds no new tiles.** Every bake is tiled and cached, and
Overpass fails a lot; one pass is never enough. Do not hardcode an expected tile count — size the
boxes first and let the loop settle.

> **`make-bridges` needs the land mask to exist.** It uses it to tell a river crossing from an
> elevated railway. Without it, New York's longest "bridges" come out as the BMT Jamaica Line and
> the IRT Flushing Line — three kilometres of elevated subway over Queens, arched 70 m into the air
> by a rule meant for the East River.

> **`make-ground` must be last.** It samples the elevation under every building AND every detailed
> solid, and `make-detail` removes boxes from `buildings.bin` as it promotes them. Run it before
> and the two files no longer line up.

Raw downloads are cached under `.city-cache/<slug>/`, so a re-bake needs no network.

> **Overpass will throttle you, and it is right to.** It is a free service on donated hardware.
> Expect 504s, 429s and connection failures. A metro-sized fetch takes hours. Every bake is tiled and
> every tile is cached, so **re-running fills the gaps** — run each of the coastline and roads bakes
> two or three times rather than once, and check the "TILES FAILED" line each time.
>
> Do not parallelise across cities. Three concurrent imports are not three times faster; they are one
> ban. And do not add a mirror without checking it agrees with `overpass-api.de` on a box you can
> count — two have been removed for lying, one returning zero outside its region and one returning a
> third of the data.

> **`make-detail` must run last and only once per bake.** It *removes* the boxes it replaces from
> `buildings.bin`. Running it twice deletes a second set of boxes that were never replaced. If in
> doubt, delete `public/siege/city/<slug>/` and start over.

Output lands in `public/siege/city/<slug>/`: `buildings.bin`, `ids.bin`, `detail.bin`, `roads.bin`,
`water.bin`, `landmarks.json` — plus the land mask, which is source, at
`src/components/siege/globe/sites/landmasks/<slug>.ts`.

For a coastal city, add one line to `sites/landmasks/index.ts`. An inland city needs no mask at all;
`landFractionFor` returns null and the whole footprint counts as land, which is correct there.

---

## Step 4 — verify before you look at it

Do not skip this. Every bug in Dubai's build was found by a script and none by looking at the screen.

```
node scripts/check-city-coast.mjs        # coastline in the right places, beach is a slope
node scripts/check-arena-dry.mjs         # nobody spawns in water
node scripts/check-undeclared.mjs        # tsc --noEmit alone checks NOTHING here, see below
```

Point the first two at your city, and **assert against real named places**: pick five landmarks you
know are on land and three points you know are water, and check the mask agrees. A structural
assertion beats a coordinate — "a line across these islands crosses land/sea at least six times"
cannot be satisfied by a filled-in blob, where a single hand-picked "water" coordinate can just land
on the wrong side of a 150 m gap.

> `npx tsc --noEmit` at the repo root compiles **zero files** — the root `tsconfig.json` has
> `"files": []`. Use `npx tsc -p tsconfig.app.json --noEmit`, and expect pre-existing errors in the
> Supabase admin panels; filter to the files you touched.

---

## Step 5 — write the site file

`src/components/siege/globe/sites/b<N>-<slug>.ts`. Copy `b3-dubai.ts` and change the numbers. Then
add two lines to `sites/index.ts` (the import and the array entry).

### The numbers that have already gone wrong

**`mode`** — `'follow'` or `'flatten'`, and this is the most consequential field in the file.

`'follow'` leaves the measured elevation alone and stands each building on its own piece of it,
using `ground.bin`. **Use it unless you have a specific reason not to.** `'flatten'` forces one
height across the whole core; it is right for exactly one situation — a city that is genuinely flat
AND whose elevation data is wrong. Dubai is both, and is the only site that uses it.

Getting this wrong is what produced *"the land is perfectly flat... nothing like Costa Rica"*: a
twelve-kilometre flat disc over a city that sits in a valley ringed by volcanoes. The data was never
missing — sampled on a 4 km grid around San José it runs 67 m to 3,058 m.

**`groundMetres`** — how high the city sits above sea level, **measured against the real tile
server before you bake anything**. In `follow` mode this is only the reference height the city group
sits at; per-building grounds are offsets from it. Probe five or six named places across the metro and take the mean
over your built area. San José's centre reads 1,128 m against a real 1,172 m; Cartago 1,419 m,
Alajuela 994 m. The coarse tiles are within about 40 m in a valley and clip mountain peaks badly
(Irazú reads 3,058 m against a real 3,432 m).

> **A HIGHLAND CITY IS FLATTENED FOR YOU, BUT ONLY IF THE RADII ARE RIGHT.** The planet lays
> procedural relief on top of the tile data, scaled by elevation — none at sea level, rising to full
> ruggedness in the mountains. At San José's 1,160 m that is **up to 345 m of invented hills**, over
> buildings three to fifteen metres tall. `cityFlatness` switches it off inside `innerMetres` and
> fades it back in by `outerMetres`. Dubai never needed this and could never have revealed it: at
> 0.5 m the coastal fade zeroes the relief anyway, so Dubai was flat by accident.
>
> The corollary: **set `innerMetres` to at least your config's `maxRangeMetres`.** Anything baked
> outside the flat core stands on blended ground and floats.


Dubai went 6 → 2 → 0.5. **Never 0**: the ocean is a mesh at exactly the planet's radius, so ground at
exactly zero is coplanar with it and the city strobes between sand and water per pixel. Keep it small
for a coastal city — the beach is the band between this and the water, so a high number is a wide
beach. Below 120 m the procedural terrain noise fades out, so a low value also gives you flat ground
for free.

**`shallowSeaMetres`** — how deep the sea is right around the city. **This is about how the water
looks, not the seabed.** Ocean opacity ramps with depth and only nears solid at 120 m, so a −12 m
shelf draws at *nine per cent* — a thin wash over a sand-coloured bed, which the eye reads as more
beach. −30 is about a quarter opaque: see-through like real coastal water, unmistakably water.

**`innerMetres` / `outerMetres`** — inner must cover your furthest building; outer is where the
override blends back to the planet. Put the blend over empty ground, never through a district.

**`stops`** — a big city needs several. Dubai's Downtown is 18.7 km from the Marina, which is a grey
box on the horizon, not a landmark. One stop per district; pressing the shortcode again moves on.

**`facingDeg`** — point it at what you came to see, and **check every stop against the land mask**.
Three of Dubai's four stops put a Kaiju in the Gulf, because the spawn ring places one at each
compass point 1.8 km out and nobody had asked whether those points were dry.

**`cars`** — 9,000 for a large city. They cost a handful of arithmetic and three floats each; the
limit is visual, not performance.

---

## Step 6 — the garrison

`soldiers`, `layout`, `fireRate`, and the vehicle counts. `humvees`, `tanks`, `helicopters` and
`jets` **are not built yet** — set them to 0. They are declared in the type deliberately so a city
file written today does not need revisiting when they land, and so the CITY panel can show "none"
rather than hiding the fact they exist.

Soldiers are what give a 300 m creature its scale. A city with towers and no people is a diorama.

---

## Step 7 — test it

`B` then your number. Then check, in this order:

1. **Are you on land?** If you are swimming, the mask or the drop point is wrong.
2. **Are all four Kaiju present?** One missing almost always means it spawned in water and is
   submerged, which looks exactly like it never existed.
3. **Is the coastline the right shape?** Render the mask as ASCII and look at it. That is how the
   Palm's fronds were confirmed.
4. **Does the skyline have its landmark?** If your city's famous tower is short, its OSM outline has
   no `height` tag and the real shape is in the `building:part` layer — which `make-detail` handles.
   The Burj Khalifa was 306 m short for exactly this reason.

---

## The things that will bite you

These are all real, all shipped, and all cost a day or more.

| Symptom | Cause |
|---|---|
| City is in the sea | Global elevation data averages ~9 km per sample. Dubai reads −87 m. The site override exists for this. |
| Coast is made of squares | Mask cell coarser than the 38 m terrain mesh, or a 1-bit mask read without interpolation. |
| Islands joined together | Coastline barrier rasterised too thick. Draw it on a 10 m subgrid and average down, not 3 cells at 40 m. |
| Invented beaches | Same cause. Dubai gained 54 km² of land this way. |
| Landmark tower too short | OSM outline has `building:levels` but no `height`. The real shape is `building:part`. |
| A Kaiju missing | It spawned in water and is submerged. Check every ring position against the mask. |
| Everything flickers at distance | A procedural pattern with no mipmaps. Use `fwidth` and fade to the average. See `cityWindows.ts`. |
| Whole screen frozen, camera dead | A throw inside *any* `useFrame` kills react-three-fiber's entire loop. City layers must catch and disable themselves. |
| Typecheck "passes" but the game is broken | Root `tsconfig.json` has `"files": []`. Use `tsconfig.app.json`. |
| A highland city buried in hills that are not there | Procedural relief scales with elevation: 345 m of it at 1,160 m. `cityFlatness` handles it — but only inside `innerMetres`. |
| Chunks of the city silently absent | A **partial Overpass mirror** answered 200 with valid JSON and zero elements, and it got cached as an answer. `overpass.osm.ch` does this outside Switzerland. Empty results now retry elsewhere and are believed only when every mirror agrees. |
| The sea swallows the city, or the rivers are land | The flood fill seeded in the wrong place. Set `seaSeed` to real open water. Under 3% or over 90% flooded now fails loudly. |
| "Re-run to fill the gaps" changes nothing | Fixed, but worth knowing: each bake used to skip its fetch if its merged output file existed, so a run that lost 55 of 56 tiles froze that result permanently. The per-tile cache under `.city-cache/<slug>/` is the real cache. |
| A city has buildings but no streets at all | Roads, water and detail each fired ONE query for the whole city. Overpass refuses a big query outright rather than answering slowly. All three are tiled now. |
| A city's buildings are all underground | A ground lookup keyed on the wrong field. San Jose's entire 29,402 buildings sat 1,160 m below the surface because a site was looked up by name where a slug was passed. |
| A lake reads as dry land while the sea is fine | Salt water arrives as coastline WAYS, fresh water as multipolygon RELATIONS — and a relation's boundary is split across many open arcs (Lake Washington is 112). Filling each individually fills nothing. `assembleRings` stitches them. |
| A famous tower sits sunk or floating | OSM heights are measured from a building's OWN ground. In `follow` mode the detailed solids need `detail-ground.bin` as much as the boxes need `ground.bin`. |
| A city with no streets at all | The roads reader cached one array with no city key, so whichever city loaded first served all of them. Anything cached across cities must be keyed by slug. |
| Bridges painted flat on the river | A bridge is an ordinary highway with `bridge=yes`, so the road bake swallows it. `make-bridges` is a separate pass for a reason. |
| Every run takes eleven minutes longer than it should | Empty tiles were re-fetched forever. A tile empty on a SECOND pass is recorded in `verified-empty.json` and believed. |
| Hours spent fetching open ocean | `coastBbox` sized by eye. It only needs the mask grid plus ~2.5 km of margin. Mine were three times too big. |
| A file and a folder differing only in case | Builds on a Mac, fails on a case-sensitive server, or TypeScript loads the same file twice. `landMasks.ts` beside `landmasks/` — renamed to `maskRegistry.ts`. |

---

## Ground rules

- **Never `git add -A`.** Two agents share this working tree. Stage by explicit path, and if a shared
  file contains someone else's changes, stage only your hunks.
- **`src/version.ts` is one shared number.** `git fetch` first, then bump the patch digit (minor when
  starting something new).
- Assets are ODbL — OpenStreetMap. Keep the attribution in the bake script headers.
- Scenery must never be able to break the game. Every city layer catches its own errors and disables
  itself; the frame loop is shared with the camera and the player.

---

## The prompt to hand an agent

> Build **\<CITY\>** as site **B\<N\>** in the DreadRoot Kaiju framework.
> Read `docs/BUILD_A_CITY.md` and follow it exactly, then read
> `src/components/siege/globe/sites/b3-dubai.ts` as the worked example.
> Choose the projection origin and bounding boxes yourself from the city's real geography, write
> `scripts/city/cities/<slug>.json`, run the five bakes in order, verify with the check scripts
> against real named landmarks *before* reporting anything, then write the site file and register it.
> Give it a roster, a garrison and one stop per major district, and set every vehicle count to 0.
> Report the building count, the road kilometres, the tallest structure and its error against the
> real height, and the land/sea split — and say plainly which parts you verified by measurement and
> which you did not.
