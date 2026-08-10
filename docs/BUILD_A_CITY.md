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
node scripts/city/make-detail.mjs     <slug>     # LAST — it edits buildings.bin
```

Raw downloads are cached under `.city-cache/<slug>/`, so a re-bake needs no network.

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

**`groundMetres`** — how high the city sits above sea level.
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
