# MINI EARTH - plan (Kaiju / Divi Node portals)

Status: **research + plan only, nothing built.** Written 2026-Jul-26.

Two codebases were read for this:
- `/Users/geoffreymccabe/dreadroot` - this repo, where Siege Worlds (SWW) actually lives today (v4.261.0).
  `/Users/geoffreymccabe/sw-web` is the old June scaffold (v0.2.66) and is **stale** - do not build here.
- `/Users/geoffreymccabe/Divi-Desktop-6.9` - DD69, for the node map (`ui/src/wallet/NetworkMap.tsx`,
  `ui/src/wallet/knownPeers.ts`, `ui/src/wallet/geoCache.ts`, `crates/supervisor/src/network.rs`).

---

# STEP 1 - "Kaiju Lab" (build this first)

Agreed first deliverable: a spherical mini Earth you can fly around, with one of our existing
animated monsters standing on it as a Kaiju, a tool to flip between monsters, and a tool to scale
one up and down in 5% steps with the physics and animation following automatically.

**Uses the raw uncompressed ETOPO tiles.** None of the amplification or biome work in §2a/§2b is
needed to start, and deliberately so. This is the fast concept test.

**Step 1 is also the experiment that settles the open design question.** Kaiju size relative to
the planet is the one number everything else hangs off (§1), and no amount of arithmetic settles
it as well as flying up to one and looking. That is what the scale tool is for.

## What you get

- A new map (`kaiju-lab`) reachable from the existing Cmd-J jump menu.
- The mini Earth as a real sphere: radius **63,710 units**, real ETOPO elevation and bathymetry,
  sea-level shell so oceans read as oceans, recognisable continents.
- Free-fly camera. Orbit it, dive at it, pull back out.
- One monster standing on the surface, animated, at whatever scale you set.
- `[` and `]` cycle through the monster roster.
- `-` and `=` scale the current Kaiju down and up in 5% steps.
- A readout showing what you are looking at, in both game units and implied real-world size.

## The monsters we already have

The roster is `MONSTER_CATALOG` in `src/components/siege/siegeMonsterCatalog.tsx`, 19 types, all
animated and working today. **Step 1 uses four of them, Geoff's picks.** Skeletons, zombies,
hordes, ghosts, crawlies and mushroom grunts read as horror-game enemies, not Kaiju, and are
excluded.

| Type | Name | Base height |
|---|---|---|
| 17 | Fort Golem | 12 m |
| 16 | Mechanical Golem | 10 m |
| 15 | Elemental Golem | 8 m |
| 8 | Red Demon | 4 m |

The cycle tool reads from a short list, so adding more later (Barbarian Giant and Dark Lord are the
obvious next candidates, and eventually the four Synty Kaiju in §4a) is a one-line change.

Good news on effort: `CatalogMonster` already accepts a `mods.sizeMul` and `mods.speedMul`, and
`MonsterEnemy` already accepts `height` and `animSpeed`. **The scale tool is mostly wiring knobs
that already exist**, not building new systems.

## Disk space and whether a VPS is needed (checked 2026-Jul-26)

**Step 1 needs no VPS at all, and under 1 GB of laptop disk, temporarily.**

The whole planet at 1 arc-minute resolution is a single 478 MB file from NOAA
(`ETOPO_2022_v1_60s_N90W180_surface.nc`), land and ocean together. That is 1.85 km per sample, or
18.5 units at S = 100, which is more than enough for an orbit view and a dive-in. Download it,
process it into tiles, upload the tiles to R2 (already wired up via `assetBase.ts`, which serves
22,862 assets today), then delete both the source and the output locally. **Net permanent cost on
the laptop: zero.**

If Step 1's view ever feels too coarse, the next tier up is the 30 arc-second global file at 1.64
GB, still a single download, still no VPS.

For reference, the ladder:

| Tier | Download | When needed |
|---|---|---|
| ETOPO 60" global | **478 MB, one file** | Step 1. Sufficient. |
| ETOPO 30" global | 1.64 GB, one file | If Step 1 looks too soft |
| ETOPO 15" | 288 tiles, tens of GB | Probably never; superseded by §2a |
| Copernicus GLO-30 | ~26,500 tiles, hundreds of GB | Only the §2a fitting pass, months away |

**The VPS is only for §2a**, the terrain-amplification fitting pass, and even then it processes
tiles in a stream and discards them, so it needs modest working disk rather than the full dataset.
It is a machine rented for a day or two, not permanent storage, and it is far in the future.

### The real disk problem is the laptop, not the project

Worth flagging plainly because it will bite something else first: `/Users/geoffreymccabe` is at
**100% capacity with about 13 GB free** on a 1.8 TB volume. That is tight enough to cause build
failures and npm install problems regardless of this project.

Two large reclaim candidates, Geoff's call, nothing touched without asking:
- `/Users/geoffreymccabe/sw-web` at **2.0 GB**. This is the stale June scaffold at v0.2.66, already
  superseded (see the header of this document). Safe to remove, it is on GitHub.
- `/Users/geoffreymccabe/siege-worlds` at **20 GB**. The read-only Unity source clone. Caveat: the
  fine-grained access token for it expired around 2026-Jul-10, so re-cloning would need a new token
  issued first. Do not remove until that is confirmed, and until asset extraction from it is
  genuinely finished.

### Reusing assets we already have

For the later biome-material work in §2b, the answer is yes. The Synty nature biome sets are
already converted and in this repo (nature, alpine mountain, arid desert, meadow forest, swamp
marshland, tropical jungle), and they map almost one-to-one onto the ESA WorldCover classes. So the
ground materials and scattered vegetation for a forested or desert or alpine region come from
assets already on disk, with no new purchases and no new downloads.

## The physics, and one correction

Geoff asked for reduced gravity for the giants. Worth being precise, because the honest answer is
slightly different and simpler.

**You do not reduce gravity to make something look giant.** If a unit is a metre, gravity is 9.81
and stays 9.81. A 100 m creature already *looks* like it falls slowly, because falling one body
height takes it 4.5 seconds where a human's takes 0.6. The slowness is a consequence of size, not
something you add. Reducing gravity on top of that would make it look like it is on the moon,
which is a different effect.

Gravity only gets divided by S when the *coordinate system* is compressed, which is the mini-Earth
convention in §1 and is a separate thing.

What genuinely does have to scale with size, from dynamic similarity (the Froude number, the same
maths behind film miniature work):

- **Movement speed scales with the square root of size.** A creature 9x taller moves 3x faster in
  absolute terms, and looks like it is moving at the same speed in body-lengths.
- **Animation playback scales with one over the square root of size.** That same 9x creature plays
  its walk cycle 3x slower.

So for a Fort Golem at 12 m taken to 100 m, the size ratio is 8.33, its square root is 2.89, and
therefore speed goes up 2.89x while animation slows to 0.35x. Both fall out of one number.

The scale tool will apply exactly that, and expose a gravity multiplier separately, defaulting to
1, so it can be tuned by eye if the physically correct answer does not feel right on screen.

## What the readout shows

Both scales at once, because that is what makes the size decision obvious:

- current monster name and type
- height in game units, and the implied real-world height at S = 100 (units x 100)
- the scale multiplier versus the monster's base size
- for reference: Everest is 88.5 units, average ocean depth is 37 units, planet radius is 63,710

So at 100 units tall the readout says "10 km real, higher than Everest by 12x", and the size
question answers itself.

## Build order inside Step 1

**1A - the sphere and the fly-around.** Cube-sphere quadtree terrain with distance-based
split/merge and skirts to hide LOD seams, streaming ETOPO height tiles through the budgeted work
queue that already exists, plus a sea-level sphere. Free-fly camera. No monsters, no physics
changes. This is the bulk of the engineering.

**1B - the Kaiju on it.** Place one `CatalogMonster` on the surface, oriented so its up vector
points away from the planet centre. The monster cycle tool and the scale tool with the Froude
maths and the readout. Still nothing touches the shared player controller.

**1C - walk it.** Let the Kaiju walk across the surface under its own locomotion with gravity
toward the planet centre, and let the camera follow in third and first person.

Splitting it this way keeps the risky part (anything touching `FortressControls.tsx`, 3,429 lines
and co-built with another Claude) out of Step 1 entirely. 1A and 1B are additive new files.

## What Step 1 deliberately does not include

No terrain amplification, no biome materials, no procedural detail, no portals, no territory, no
AI, no combat, no multiplayer, no node gating. Terrain will look smooth and under-detailed up
close and that is expected, §2a and §2b are the fix and they come after the concept is proven.

---

## 1. Scale (REVISED 2026-Jul-26 after Geoff's correction)

### The framing

**One game unit = S real metres.** The whole world is stored and simulated at that reduced
coordinate scale; nothing is "shrunk" in the fiction, we are just choosing what a unit means.
With S = 100:

| Real Earth | Mini Earth (game units) |
|---|---|
| Radius 6,371 km | **63,710 units** |
| Equator circumference 40,075 km | **400,750 units** |
| Everest 8,848 m | **88.5 units** |
| Mariana Trench 10,935 m | **109 units deep** |
| Average ocean depth 3,688 m | **37 units deep** |
| 100 m skyscraper | **1 unit** |

Every real-world quantity divides by S. That includes physics:
- **Gravity in engine units = 9.81 / S.** At S = 100 that is **0.098 units/s²** instead of 9.8.
  This is exactly Geoff's "gravity would affect them less", and it is not a fudge, it is the
  correct conversion. Falls take the same real time, but cover 1/100 the unit distance, so they
  *read* as slow and ponderous. Which is the giant look.
- **Speeds divide by S too.** A creature moving 1,000 real m/s moves 10 units/s.
- **Animation speed follows the square root of size** (the standard film miniature/giant rule).
  A creature N times taller than a human plays its cycles about √N times slower. That is the
  knob that sells "giant", not the movement speed alone.

Context for how big this world is: the current SWW map is 2,000 units across and Starblink is
20,000. The mini Earth is **400,750 units around**, roughly 20 Starblinks end to end, wrapped.

### What this reframing FIXES

**The ocean now works.** A Kaiju is small relative to the planet again, so average ocean depth of
37 units is genuinely deep water, not a wading pool. No bathymetry exaggeration needed. Deep
trenches at 109 units are a real abyss. The underwater game Geoff described is back on.

**Mountains are terrain again, not scenery.** Everest at 88.5 units is a landmark a Kaiju climbs
or goes around, not something it steps over.

**Float precision stays comfortable.** ±63,710 units in float32 gives about 4 mm resolution, and
`renderSpace.setRenderOrigin` already exists to remove even that concern.

### What this reframing does NOT do: it does not reduce the data

This is the one point worth being careful about. **Scaling the coordinate system does not shrink
the dataset.** A height sample every 463 real metres is the same number of samples whether you
call the spacing 463 units or 4.63 units. Data volume is set by one thing only: the **ground
sample distance** you choose to keep.

And the good news is you do not need to reduce it much, because of streaming. The client only ever
downloads tiles near where it is looking, so the total pyramid size is a storage question, not a
bandwidth question, and R2 storage costs about $0.015 per GB per month with no egress fees. The
full 15 arc-second world is roughly 7.5 GB raw and well under that compressed, so it costs a few
cents a month to host the whole planet at full detail. **Keep the detail, stream it.** The only
place a low-res version is genuinely required is the whole-globe orbit view, which is one small
base tile set of a few MB.

### The number that actually governs the game: Kaiju height vs planet

Because S is only a relabeling, it does not change how long it takes to cross the world. The only
thing that does is **how big a Kaiju is relative to Earth**. Two independent things follow from it,
and they happen to pull in the same direction:

| Kaiju real height | Kaiju-heights around the equator | Terrain samples per body length (15" data) | Time to cross ~4,000 km at 1 body-length/sec |
|---|---|---|---|
| 100 m | 400,750 | 0.22 (terrain is featureless) | 11 hours |
| 500 m | 80,150 | 1.1 | 2.2 hours |
| **1 km** | **40,075** | **2.2** | **67 minutes** |
| 5 km | 8,015 | 10.8 | 13 minutes |

The middle column uses the 15" global relief dataset, and it is why §2 was revised: at 100 m a
Kaiju is smaller than a single sample of it. **Switching land to Copernicus GLO-30 at 30 m
multiplies that whole column by about 15**, so a 1 km Kaiju gets 33 samples per body length rather
than 2.2, and even a 100 m Kaiju gets 3.3. That takes terrain detail off the critical path for
this decision, and leaves traversal time (the last column) as the thing that actually drives it.

**Recommendation: Kaiju = 10 units at S = 100, i.e. 1 km "real".** That gives:
- Everest is 8.9 Kaiju-heights tall. Mountains dominate.
- Average ocean is 3.7 Kaiju-heights deep. Properly submerged.
- Deep trenches are 11 Kaiju-heights. A real abyss to descend into.
- A 100 m skyscraper is 1/10 a Kaiju. That is a *more* extreme Godzilla-vs-skyline ratio than the
  films (roughly 2.4:1), so the classic look is preserved and then some.
- Crossing a continent takes about an hour of autonomous walking, which is the right cadence for a
  persistent server-side war you check in on rather than micromanage.

Nobody in the game can measure the real scale. The only thing that communicates size is what you
place next to a Kaiju, so if cities and props are placed at true 1/100 (a skyscraper = 1 unit),
the fiction reads as "100 m Kaiju" regardless of the underlying arithmetic.

### Why S = 100 rather than 200 or 1000

S is worth tuning, but not for the reason it first appears. Raising S while holding the Kaiju at a
fixed number of units makes the Kaiju *bigger in real terms*, which is really the Kaiju-height
decision above wearing a different hat. Raising S while holding the Kaiju at 100 real metres makes
the Kaiju sub-unit-sized (at S = 1000 it would be 0.1 units tall), which is bad for collision and
physics precision.

So: **fix S = 100 as the coordinate convention and tune the Kaiju height in units instead.** That
is one number, changeable at any time, with no effect on the data pipeline or the engine.

### Curvature (needed for the tangent-patch design in §4)

Planet radius R = 63,710 units. Horizon distance is √(2·R·eye-height):
- 1-unit prop (a skyscraper) sees **357 units**
- 10-unit Kaiju sees **1,129 units** (113 real km)
- flying at 1,000 units altitude sees **11,288 units**

Ground drop away from you over distance d is d²/(2R):
- 500 units → **2.0 units** of drop
- 1,000 units → **7.8**
- 2,000 units → **31**
- 5,000 units → **196**

That second list is the single most useful set of numbers in this document. It says curvature is
negligible inside a few hundred units (so a flat local patch is honest), and unmistakable by a few
thousand (so the horizon genuinely curves). §4 builds on exactly that.

---

## 2. The Earth data (REVISED 2026-Jul-26: land and ocean need different answers)

### Geoff's objection, and it is correct

At 15 arc-second (463 m) resolution the terrain is too coarse to stand on. Concretely, how many
real height samples land on real features:

| Feature | Real size | Samples at 463 m | Samples at 30 m |
|---|---|---|---|
| Everest summit pyramid | ~2 km across | **4** | **67** |
| Everest massif | ~30 km | 65 | 1,000 |
| Grand Canyon inner gorge | ~800 m wide | **2 (lost)** | 27 |
| Mariana Trench, full width | ~69 km | 150 | n/a |
| Mariana Trench floor | 1 to 5 km | **2 to 11** | n/a |

So yes: at 463 m, Everest's summit is four data points. It would render as a smooth bump.

One clarification on the symptom, because it changes what you fix. Coarse source data does **not**
look low-poly (faceted, visible triangles). Triangle count is an independent choice, and you can
draw a million triangles from four samples. What it actually looks like is **smooth and melted**,
like a plasticine model or a golf course: no cliffs, no crags, no sharp ridgelines. That is the
failure mode to design against.

### Land: use Copernicus GLO-30 instead. It is 15x finer and free.

**Copernicus DEM GLO-30** is a 30 m global elevation model covering all land, roughly 149 million
km², released free to the general public under the Copernicus licence, and mirrored on AWS Open
Data and OpenTopography. This is the answer for everything above sea level.

At S = 100 that is a height sample every **0.3 units**. Against a 10-unit Kaiju that is **33
samples per body length** instead of 2.2. Night and day, and it costs nothing.

Storage: land at 30 m is about 166 billion samples, roughly 331 GB raw and perhaps 70 to 110 GB
compressed. On R2 at $0.015 per GB per month that is **$1 to $5 a month for the entire land
surface of Earth at 30 m**. This is not a constraint.

Caveat worth knowing: GLO-30 is a *surface* model, so buildings and tree canopy are included as
elevation. At S = 100 a 30 m tree canopy is 0.3 units against a 10-unit Kaiju, about 3% of its
height, so it is visually irrelevant here. Ignore it.

If a specific region ever needs more, national lidar exists (USGS 3DEP at 1 m for the US, and
equivalents elsewhere). The pyramid architecture means those drop in later as extra levels over
specific regions with no client change at all.

### Ocean: the data Geoff wants does not exist, at any price

This is the genuinely important finding. As of 2025 the Nippon Foundation / GEBCO Seabed 2030
project reports **27.3% of the ocean floor mapped to modern standards**, and only about 20% has
been measured by direct observation. The rest of the seafloor in GEBCO and ETOPO is **estimated
from satellite gravity measurements**, which by the project's own description misses significant
features and gives only coarse depictions of the largest seamounts, ridges and canyons. Seabed
2030's actual 2030 *target* is to reveal features 100 m or larger.

So the sharp trench walls, canyons and seamount detail you want on the ocean floor are not
available as data. There is no dataset to buy. **Deep-ocean detail must be procedural**, and that
is not a compromise, because the "real" data is itself a smooth interpolated guess that nobody can
check.

The upside: the ocean is where you have the most creative freedom, and it is where most of the
game happens. Procedural abyssal plains, trench walls, hydrothermal vent fields and seamounts can
be authored to be *interesting* rather than accurate, seeded from the real bathymetry so the big
shapes (the trench is where the trench is) stay true.

### The resulting three-layer terrain

1. **Real data, big shapes.** Copernicus GLO-30 on land, ETOPO/GEBCO 15" in the ocean. Continents,
   mountain ranges, trenches, coastlines all exactly where they belong.
2. **Procedural detail, below the data's resolution.** Fractal displacement tuned per biome and per
   slope, adding crags, cliffs, scree and ridgelines on land, and the entire character of the deep
   seafloor. This is what every planet renderer does and it is what stops the melted look.
3. **Material and normal detail.** Rock, snow, sand, coral splatted by height/slope/latitude with
   normal maps. Carries the last few metres of apparent detail with no geometry at all.

### Why source resolution costs storage but not bandwidth

Worth stating plainly because it is counter-intuitive. In a tile pyramid every tile holds the same
number of samples (say 256×256) regardless of which level it is on, and a view loads roughly the
same number of tiles regardless of how deep the pyramid goes. Finer source data adds *deeper
levels*, which you only ever fetch when you are close enough to see them. So going from 463 m to
30 m multiplies storage by about 240 and multiplies per-view bandwidth by roughly **nothing**.

Sizes for reference:

| Source | Coverage | Samples | Raw 16-bit | Sample spacing at S=100 |
|---|---|---|---|---|
| Copernicus GLO-30 | land only | ~166 billion | ~331 GB | **0.3 units** |
| ETOPO / GEBCO 15" | land + ocean | 3.73 billion | ~7.5 GB | 4.6 units |
| ETOPO 30" | land + ocean | 933 million | ~1.9 GB | 9.3 units |
| ETOPO 60" | land + ocean | 233 million | ~466 MB | 18.5 units |
| 4096×2048 globe base | land + ocean | 8.4 million | ~17 MB | ~100 units |

### Recommended build order for the data

Start with ETOPO 15" globally. It is one small dataset, it gets the whole planet working end to
end, and for the Phase 2 globe flythrough you are never close enough for its coarseness to show.
Then add the detail layer described in §2a before Phase 3 puts anyone on the surface. That
ordering means the coarse-data problem never actually reaches the player.

---

## 2a. Fitting a procedural generator to the real data (Geoff's proposal, 2026-Jul-26)

**The proposal:** download the full high-res DEM onto a big VPS, convert it per-sector into a
procedural generator, then delete the bulk storage and generate terrain at runtime like Minecraft.

**Verdict: the right idea, with one hard limit, one correction, and a better justification than
the one it was proposed for.**

### The hard limit: procedural generation is not compression

Minecraft's world is procedural because it was **never data**. The noise function *is* the source
of truth, so there is nothing to compress. Earth's shape is the opposite: it is genuine
information, hundreds of GB of it, and no small algorithm can emit the real Himalayas from a seed.
Any claim to "reduce Earth to an algorithm" with no stored data is claiming a compression ratio in
the billions on non-redundant data, which is not possible.

So a real Earth layer must be stored. The only question is **where to put the split**.

### The correct split: keep real data down to where recognisability lives

People recognise Earth at the scale of coastlines, islands, mountain ranges and major valleys,
roughly 500 m and coarser. Below that, nobody has any idea what the real planet looks like, so
below that you are free.

**ETOPO/GEBCO 15" (463 m) is almost exactly that line.** Keeping it globally, land and ocean,
costs about 7.5 GB raw and roughly 2 GB compressed. That 2 GB is what makes this Earth rather than
a random planet, and it is not worth trying to remove.

Everything finer than 463 m gets synthesised.

### The technique has a name and a literature: terrain amplification

This is an established research area, not something to invent from scratch. Published work covers
exactly this: taking a low-resolution DEM and synthesising plausible, faithful high-resolution
detail. Recent approaches align the synthesised detail to slope and water flow (phasor-noise based)
so ridges and gullies read as geology rather than generic fractal noise, use multi-scale erosion
simulation for hydrologically consistent results, and use GAN-based "multi-theme" amplification
where the theme is fitted per region. See the sources at the end of this document.

### What the VPS job actually produces

Stream the roughly **26,500 one-degree Copernicus GLO-30 tiles** from the AWS Open Data bucket
(`s3://copernicus-dem-30m`, eu-central-1). Process each and discard it, so peak disk stays small
and no full download is needed. For each sector emit a compact parameter set, a kind of terrain
DNA, fitted from the real 30 m data:

- terrain class (alpine, hill, plain, dune, glacial, karst, volcanic, coastal shelf, abyssal)
- roughness power spectrum, i.e. the 1/f^β slope and per-band amplitudes. This is the important
  one: β genuinely differs between the Alps, the Sahara and the Amazon basin, and getting it right
  is most of what makes synthesised terrain feel like the right place.
- dominant ridge/lineation orientation and strength (mountain ranges have grain)
- erosion and drainage character (density and depth of valley incision)
- overall relief scale

Then **delete the source data.** That is the part of Geoff's proposal that works exactly as
described.

### Sector size: 100 to 1000 km is too coarse, use 10 to 25 km

At 1000 km a single sector would contain the Alps, the Po valley and the Mediterranean, and one
parameter set cannot describe all three. Even 100 km is coarse, the whole Grand Canyon is only
29 km long.

**Recommend 10 to 25 km sectors**, and **blend parameters between neighbouring sectors** rather
than stepping them, or every sector boundary becomes a visible seam in the terrain.

Storage for the parameters: land is 149 million km², so 10 km sectors give about 1.49 million
sectors, and at 64 floats each that is roughly **380 MB**. At 25 km sectors it is about 60 MB.

### The resulting total

| Layer | Size |
|---|---|
| Real Earth at 15", land and ocean, compressed | ~2 GB |
| Fitted sector parameters at 10 km | ~380 MB |
| Generator code and noise tables | negligible |
| **Total shipped** | **~2.4 GB** |
| Replaces | several hundred GB to over a TB of 30 m tiles |

Roughly a 100x to 300x reduction, and the runtime detail is unlimited rather than capped at 30 m.

### The better justification: storage was never the problem

Worth saying plainly, because it changes how this gets prioritised. Hosting the full 30 m tier on
R2 costs about $5 a month, so **saving storage is not a good enough reason to do this work.** The
reasons that are good enough:

1. **No network fetch for detail.** The client synthesises detail on the GPU instantly instead of
   streaming tiles. That is what makes it feel like Minecraft: infinite detail, no loading.
2. **Determinism.** Every client and the server compute identical terrain from the sector
   parameters plus a seed, so a server-authoritative Kaiju simulation stores and syncs *nothing*
   about terrain.
3. **It fits the engine's existing contract better than tiles do.** `sampleHeight(x,z)` needs a
   synchronous answer at any arbitrary point. A generator always has one. A tile pyramid has a
   "not loaded yet" state that has to be handled everywhere.
4. **The ocean needs it regardless.** Only 27.3% of the seafloor is mapped to modern standards, so
   deep-ocean detail has to be synthesised no matter what is decided about land.

### The real costs and risks

- **The fitting pass is genuine R&D, not a script.** Making the Alps look like the Alps rather
  than like generic fractal mountains is the hard part, and it is precisely where the cited papers
  spend their effort. Budget accordingly, and expect iteration on how it looks rather than a
  one-shot conversion.
- **CPU and GPU must agree exactly.** Rendering runs on the GPU, but collision, ground-follow and
  Kaiju AI run on the CPU through `sampleHeight`. If the two implementations disagree even
  slightly, Kaiju sink into hills or hover above them. This needs one shared definition with
  careful float discipline, and it is the most likely source of subtle bugs.
- **Sector-boundary blending**, as above.
- **It sits on the critical path to standing on the surface**, so it should not block the
  flythrough.

### Recommendation

Do it, but not first. Build Phase 2's flythrough on the plain 15" pyramid, which is about 2 GB and
needs no research at all. Then build amplification as Phase 1b, before Phase 3 puts a player on
the ground. Note the payoff: **the 331 GB Copernicus tier then never ships at all**, it exists only
offline as the thing the parameters are fitted from. Which is exactly what Geoff proposed.

### 2b. Ground materials and biomes (Geoff's texture question, 2026-Jul-26)

**The ask:** forested areas should look forested, the Grand Canyon should be red rock, deserts
yellow sand. Roughly right is fine, procedurally generated detail up close.

**The answer is the same shape as the terrain answer, and it is much cheaper.** You do not store
textures. You store a tiny map of *what kind of place this is*, and the shader synthesises the
material from that.

Two small real datasets do the "what kind of place" job:

1. **ESA WorldCover**, a 10 m global land cover map from Sentinel-1 and Sentinel-2, free with no
   restriction on use, on AWS Open Data. Eleven classes: tree cover, shrubland, grassland,
   cropland, built-up, bare/sparse vegetation, snow and ice, permanent water, herbaceous wetland,
   mangrove, moss and lichen. That is exactly "forested areas look forested".
2. **NASA Blue Marble** at 500 m as a colour tint, which supplies the things a class map misses:
   the Sahara's specific yellow, the Grand Canyon's red, the Atacama's grey, seasonal green.

Neither needs to be kept at source resolution. Downsampled to about 1 km, the land class map is
149 million samples at half a byte, roughly 75 MB raw, and because class maps are extremely
spatially coherent they compress to **single-digit MB for the whole planet**. Blue Marble at 500 m
adds perhaps 50 to 100 MB. Class boundaries get softened and dithered procedurally at runtime, so
1 km source resolution does not read as blocky.

**At runtime, the class plus tint plus slope plus altitude plus latitude select and blend
procedural materials.** Steep + bare class = cliff rock with strata, tinted by Blue Marble, so the
Grand Canyon comes out red and layered without anyone storing a picture of it. Flat + bare + hot
latitude = dunes with wind ripples. Tree cover = forest floor material plus scattered instanced
trees from the Synty biome sets already converted into this repo. This is standard splat-mapping,
just driven by real-world data instead of a hand-painted mask.

**On the neural texture compression Geoff saw on Two Minute Papers.** That is real and it is
NVIDIA's Random-Access Neural Compression of Material Textures, roughly 4x the resolution of block
compression at 30% less memory, with real-time random-access decompression. But it ships as a
DirectX and Vulkan SDK that needs cooperative-vector/tensor hardware paths, and **there is no
browser path for it today**, neither WebGL nor WebGPU. So it is not usable here.

That is fine, because it solves a problem this design does not have. NTC compresses *authored*
textures. This design does not have authored textures to compress: the material is generated in
the shader from a few bytes of class and tint data, which is a stronger form of the same win and
runs anywhere. The web-native option for any real textures we do ship (the Synty atlases, decals)
remains KTX2/Basis, which is already in this repo's asset pipeline plans.

### Surface colour

**NASA Blue Marble Next Generation** - monthly cloud-free true-colour global land cover at 500 m/px,
public domain (credit "NASA Earth Observatory"). There is also a BMNG variant *with* topography and
bathymetry shading baked in. This is the standard globe texture and it's free. Full-res is
86400×43200 in 8 tiles; we'll want a downsampled pyramid the same way as the heights.

For crisp coastlines/borders at close range, **Natural Earth** (public domain vector) is the usual
companion - useful later for territory-map overlays and country outlines on the strategy view.

If you want land that looks like a *game* rather than a satellite photo, the alternative is to
derive a biome/material mask from Blue Marble + latitude + elevation and splat the existing Synty
nature-biome textures onto it. That's a Phase-2.5 thing, not day one.

### Where the data lives

**Not in git.** From hard-won repo history: Cloudflare Pages has a hard **25 MiB per-file limit**
(a 51 MB file silently killed every deploy for several versions) and a ~20,000 file cap, and
`public/` is already ~15.8k files. The tile pyramid goes to **R2**, served through the existing
`assetBase.ts` indirection - same as the 22,862 3D assets already there.

---

## 3. What the SWW engine gives us for free, and what breaks

Read: `src/config/worldDefinition.ts`, `src/components/siege/SiegeWorldLayers.tsx`,
`src/components/siege/terrainHeight.ts`, `src/components/siege/terrain/heightField.ts`,
`src/components/siege/terrain/HeightmapTerrain.tsx`, `src/components/fortress/FortressControls.tsx`.

### Free (real, verified)
- **A map is just a data record.** `WorldDefinition` already carries id, bounds, ground kind, spawn,
  water volumes, lighting, wall boxes. Adding a mini-Earth map = adding a definition + one new
  ground kind. The hard rule "nothing about a world is hardcoded" has actually been honoured.
- **`GroundKind` is an open enum** (`flat` | `heightmap` | `gltf-terrain`) and `SiegeWorldLayers`
  branches on it in one place. A new `globe` kind slots in cleanly.
- **One ground contract for the whole game.** `sampleHeight(x,z)` in
  `src/components/siege/terrainHeight.ts` is what the player, monsters, coins, boulders, loot and
  weapons all use - and it already supports a swappable *dynamic provider*. Anything that satisfies
  that one function inherits the entire existing game.
- **Streaming machinery exists and is tuned**: budgeted per-frame work queue, camera-tracked
  load/unload with hysteresis, worker pool for off-thread mesh building, IndexedDB caching, LOD
  buckets for AI.
- **Underwater already exists** - `UnderwaterEffect` (murk + drowning), water volumes in the world
  definition with a `movement: 'walk-bottom' | 'swim'` field already declared, and gravity is
  already reduced to 25% in water in `FortressControls`.
- **`renderSpace.ts` exists precisely for this** - a single file that converts world→render coords,
  currently identity, built so a large-world origin shift lands in one place.
- **Autonomous monster AI exists**: behaviour trees, an enemy manager, a spatial index, per-type
  adapters, distance-based AI throttling. Kaiju are a new adapter, not a new AI system.

### What breaks (the honest list)

1. **The editable heightfield literally cannot address this world.** `heightField.ts` packs its
   sample coordinates into a ±32,768 lattice - that's a ±32.7 km world. Mini Earth is 400 km around.
   Also it's a sparse JS Map at 1 m spacing; a full Earth would be ~10¹¹ entries. **The mini Earth
   needs its own terrain store** (a streamed tile pyramid), not the brush heightfield. The terrain
   brush therefore does not work on this map, at least not in v1.
2. **Up is hardcoded.** Gravity is a scalar applied to `velocity.y` and world-up is (0,1,0)
   throughout `FortressControls.tsx` (3,429 lines). Walking on a true sphere means "up" changes with
   position. This is the single biggest engineering decision - §4 is my answer to it.
3. **`sampleHeight(x,z)` is fundamentally flat.** One height per XZ pair. On a sphere, XZ is
   ambiguous (two opposite points share it).
4. **Water is axis-aligned boxes.** `WaterVolume` is an AABB with a flat `surfaceY`. A global ocean
   is a sphere shell at a constant radius. Needs a new water kind.
5. **No LOD yet.** The perf plan is written but SceneCellStreamer isn't built. A globe *cannot* ship
   without distance LOD - and note the documented failed experiment: naive per-cell frustum culling
   made FPS **worse** (2-3 fps). Distance-based streaming + real LOD is the only path that has ever
   worked here.
6. **Float precision.** Positions up to ±63,710 units in float32 give about 4 mm resolution, fine, but
   `renderSpace` origin-shifting should be switched on for this map rather than left as identity.

---

## 4. The core architectural recommendation: two views, one dataset

The temptation is to build a true walk-on-sphere engine and rewrite the mover. I recommend against
it as a first move. Instead:

**Globe view** - a real sphere. Cube-sphere quadtree terrain (six cube faces, each recursively
subdivided toward the camera, projected onto the sphere, displaced by the height tiles). Orbit /
free-fly camera. This is the "fly around a mini Earth" deliverable, and it is *also* the natural
strategy interface for the Kaiju game: you look at your planet, you see territory colours, you see
portals glowing at node locations, you issue orders.

**Surface view** - the existing flat engine, unchanged. When you drop to the surface at some
lat/lon, we build a **local tangent patch**: a flat-engine world whose X is east, Z is north, and
whose Y is elevation **with the curvature drop baked in** (that d²/2R table from §1). The player and
every existing system see an ordinary flat map and work unmodified. Because the drop is baked into
the heights, the horizon genuinely curves away: at a few hundred units of view distance the drop is
about 2 units (invisible), at 2,000 units it is 31 (a real, visible horizon). Walk far enough and
the patch re-centres, which is what `renderSpace.setRenderOrigin` was built for.

Why this is the right call:
- Phase 2 (fly around a mini Earth) ships without touching the 3,429-line controls file at all.
- Every existing system - weapons, monsters, HUD, colliders, loot, challenges - works on the surface
  on day one, because `sampleHeight` still answers.
- The seam is honest: you cannot walk continuously around the whole planet in surface view without a
  re-centre, but circling the planet is an 11-hour march even for a Kaiju, so a re-centre every few
  thousand units is invisible in practice.
- If we later want true continuous sphere-walking, the tangent patch is exactly the abstraction you
  refactor *into* it. Nothing is thrown away.

**The simulation is separate from both views.** Kaiju positions, territory, flags, portals and
points live in geographic coordinates (lat/lon or unit vector) on a server. Both views are just
renderers of that state. This matters because the Kaiju war continues while nobody is looking at it.

### Territory grid

Reuse the cube-sphere quadtree as the territory grid - the same subdivision that renders the planet
also numbers it. At quadtree level 7 that's 98,304 cells averaging 0.52 km² (~720 m across); at
level 8, 393,216 cells of 0.13 km² (~360 m). Level 7 is my starting recommendation for flag-planting
granularity. The same cell ids double as the multiplayer area-of-interest zones, which is exactly
how the existing L2/Durable-Object plan is already structured.

---

## 4a. The Kaiju models (Synty POLYGON Kaiju Pack)

Chosen source: Synty **POLYGON - Kaiju Pack**, $69.99 on the Unity Asset Store (id 313691), 163 MB,
v1.1.1, Unity 2022.3 / Unreal 5.3 / **FBX source files**. Synty's own store lists it at $34.99 on
sale but currently sold out, so buy through the Unity Asset Store.

**Contents: four Kaiju - Gorilla, Lizard, Crab, Alien.** Multiple colour variants each. Humanoid rig,
Mecanim compatible.

### The one thing to know before buying
**No animations are included.** The pack ships rigged and "animation ready" and nothing else. This is
normal for Synty creature packs and it is survivable here, because this repo already has the exact
tooling for it, but it means the Kaiju are a *retargeting* job, not a drop-in.

### How they slot into the existing pipeline
- Take the **FBX source / Unity package**, not the Unreal project. Documented gotcha: the Unreal
  source rig has caused broken conversions before; the Synty-rigged FBX (Hips root) is the good one.
- Rigged characters are explicitly **skipped** by `convert_scifi_set.py` (the world-props converter).
  Kaiju go through the character path instead: `convert_synty.py` / `build_character.py` /
  `retarget_to_synty.py`, all in `/Users/geoffreymccabe/siege-worlds-port/props/`.
- Read `/Users/geoffreymccabe/siege-worlds-port/props/MONSTER_MODEL_PLAYBOOK.md` first. The rules
  that will bite here: do not scale a rig by looping over bone head/tail (corrupts connected rigs),
  do not run unit-normalise on an animated rig, use rotation-only retargeting, and judge the result
  zoomed on a real GPU render rather than a full-body glance.
- "Humanoid rig, Mecanim compatible" is good news: it means **Mixamo clips retarget onto them** via
  the existing `retarget_to_synty.py`, and the creature clips already in
  `/Users/geoffreymccabe/dreadroot/public/Anim_Creature_Biped/` and `/public/Anim_Locomotion/` are
  candidates too.
- Monster glbs are tracked in git and served from Pages, **not R2**, and must stay under 25 MiB, and
  must **not** be Draco-compressed (the monster loader has no decoder wired). Synty low-poly should
  land at a few MB each, so this is fine, but check before committing.

### Animation set we actually need
Walk, run, swim (3D, for the ocean game), attack, take-hit, death, roar, and a flag-plant or
territory-claim gesture. Roughly seven to nine clips per species.

**The Crab is the risk.** A humanoid rig driving a crab means biped locomotion clips will look wrong
on it, and the crab is the natural deep-ocean unit, so it matters. Expect the Crab to need either
hand-authored or purpose-bought quadruped/creature clips. Gorilla, Lizard and Alien should all take
biped retargets acceptably.

### Design fit
Four species maps cleanly onto "the portal owner chooses what type of Kaiju to create", and suggests
an obvious spread: Gorilla as the land bruiser, Crab as the armoured deep-sea unit, Lizard as the
amphibious all-rounder, Alien as the strange/ranged one. Given that most of the game is meant to
happen underwater, the Crab is arguably the most important model in the pack, which is unfortunate
given it is also the hardest to animate.

Four species is enough for launch but thin for long-term variety. Colour variants plus size tiers
plus per-species stat spreads will carry it further. Synty releases more creature packs on the same
rig family, so the pipeline built once is reusable.

### Rendering many Kaiju
Skinned meshes are expensive and this game wants a lot of them. Reuse the existing AI distance
buckets (FULL / THROTTLED / FROZEN) as the *render* LOD too: full skinned mesh near the camera, a
cheap animated proxy at mid range, a silhouette or billboard at globe range. From orbit a Kaiju at
10 units tall on a 63,710-unit planet is a speck, so globe view should draw territory colour and unit markers
rather than real models.

---

## 5. The DD69 node → portal link

What's actually there (verified in `/Users/geoffreymccabe/Divi-Desktop-6.9`):
- `crates/supervisor/src/network.rs` gets connected peers from the daemon's `getpeerinfo`.
- IPs are geolocated through a Tauri command (`geolocate_ips`) into `geoCache.ts`.
- `ui/src/wallet/knownPeers.ts` keeps a 30-day rolling store of every node ever seen, **each with
  lat, lon, city, country** - currently ~92 nodes in localStorage.
- `crates/supervisor/src/wallet.rs` already calls `signmessage`.

So: **each known node already carries the exact lat/lon a portal needs.** Converting to a sphere
position is trivial arithmetic.

Two things need building:
1. **A server-side node registry.** Today the list lives in one desktop app's localStorage. The game
   needs a shared, authoritative list (a small service that runs a node, polls `getpeerinfo` +
   geolocation, and publishes node → lat/lon). The scanner node behind DIVI LOVE SCAN /
   scan.divi.love is the obvious host.
2. **The "you must run a node" gate.** The clean version: the game shows a challenge string, DD69
   signs it with the node's address via `signmessage`, the game server verifies the signature *and*
   verifies that address/IP is a currently-live node in the registry. Session token issued, expires,
   re-proves periodically. If the game is ever embedded inside DD69's own window, the proof is local
   and even simpler. Notably this makes portals *scarce and geographic* - a real, novel hook.

Design consequence worth naming now: portals are wherever nodes actually are, which today means
Europe/North America heavy and near-empty oceans and southern hemisphere. That's either a feature
(land grab from the populated north) or something to balance with neutral/NPC portals.

---

## 6. Build phases (full plan)

Fifteen phases in four parts. Every phase ends with something Geoff can open and judge, and no
phase depends on a later one. No time estimates anywhere, per standing preference: each phase names
its **bottleneck** instead, meaning the one thing that decides how long it actually takes.

Notation: **Unblocks** = what this phase makes possible. **Bottleneck** = the hard part.

---

### PART 1 - THE PLANET

At the end of Part 1 you have a real mini Earth you can fly to, land on, walk across and swim in.
It is a sandbox, not a game, but everything after it is content on top of a finished world.

---

#### P1 - Kaiju Lab (detailed above under STEP 1)

**Goal:** a spherical mini Earth you can fly around, with one of our existing animated monsters
standing on it, a tool to flip between the four Kaiju candidates, and a 5% scale tool.

**You can test:** Cmd-J to a new map, orbit the planet, recognise continents, dive at one, see a
Fort Golem standing on it, cycle monsters, scale one up and down and read its implied real size.

**Work:**
- Offline: one 478 MB ETOPO download, resample and cut into cube-face quadtree height tiles, push to
  R2 via the existing `assetBase.ts` path, delete locally.
- New `globe` ground kind in `src/config/worldDefinition.ts`, plus a `kaiju-lab` world definition.
- `GlobeTerrain`: cube-sphere quadtree, distance-based split and merge, skirt rings to hide LOD
  seams, tile streaming through the existing budgeted work queue and worker pool.
- Sea-level sphere shell, atmosphere rim glow.
- Free-fly camera mode.
- `SiegeWorldLayers` gates all DreadRoot and SWW content off the new map, reusing the existing
  gating pattern rather than inventing one.
- Monster cycle tool (`[` / `]`) over the four-entry Kaiju list, and scale tool (`-` / `=`) at 5%
  steps, driving the `sizeMul`, `speedMul` and `animSpeed` knobs that already exist, with the Froude
  maths (speed by the square root of size, animation by one over the square root).
- HUD readout: monster name, height in units, implied real-world height, scale multiplier, and
  Everest and ocean depth for reference.

**Unblocks:** everything. Also settles the Kaiju size question by eye, which no amount of arithmetic
can.

**Bottleneck:** the cube-sphere quadtree LOD renderer. It is the single biggest genuinely new
component in the whole project, and this repo has a documented history of terrain performance traps
including one plausible optimisation that made FPS twenty times worse. Build it distance-based from
the first commit.

**Risk:** LOD seams and popping. Skirts fix the cracks; hysteresis on the split and merge thresholds
fixes the popping. Both are known techniques, but they need to be in from the start.

---

#### P2 - Sphere locomotion

**Goal:** walk and run a Kaiju across the planet surface, in third person and first person, with
gravity pointing at the planet centre.

**You can test:** land on a coastline, walk inland, climb a mountain range, look back and see the
horizon curve. Switch between third and first person.

**Work:**
- A dedicated Kaiju controller, separate from the shared `FortressControls.tsx`. This is
  deliberate: that file is 3,429 lines, hardcodes world-up as (0,1,0), and is co-built with another
  Claude. Touching it is the biggest avoidable risk in the project.
- Gravity toward the planet centre, ground-follow against the globe height field, orientation so the
  Kaiju's up vector is the surface normal.
- Third-person chase camera and first-person head camera, with the scale tool still live so camera
  distances follow Kaiju size.
- `renderSpace.setRenderOrigin` switched on and re-basing near the player, so float32 precision
  stays sane at 63,710 units from the centre.

**Unblocks:** everything that happens on the ground. Also the first real read on whether the game
feels good.

**Bottleneck:** keeping it out of the shared controller while still reusing its good parts (step
handling, slope limits, jump arcs). Expect some deliberate duplication rather than a risky refactor.

**Risk:** the ground-follow and the rendered surface disagreeing, so the Kaiju sinks or floats. Same
class of bug the repo has hit before with baked-mesh maps.

---

#### P3 - Terrain quality

**Goal:** terrain that looks right up close, and ground that looks like the place it is.

**You can test:** stand in the Grand Canyon and see red layered rock, walk the Sahara and see
yellow dunes, walk a forest and see forest floor with trees, and none of it looks like smooth
melted plasticine.

**Work, two halves that can run in parallel:**

*3a, terrain amplification (§2a):* rent a VPS for a day or two, stream the Copernicus GLO-30 tiles,
fit per-sector terrain parameters at 10 to 25 km sectors (terrain class, roughness power spectrum,
ridge orientation and strength, erosion character, relief scale), discard the source, ship roughly
380 MB of parameters. Build the runtime generator that synthesises everything finer than 463 m,
blending parameters across sector boundaries so there are no seams.

*3b, biome materials (§2b):* download ESA WorldCover, downsample to about 1 km, ship as a compressed
class map of a few MB, plus Blue Marble as a colour tint. Shader selects and blends procedural
materials from class, tint, slope, altitude and latitude. Scatter vegetation instanced from the
Synty nature biome sets already converted into this repo.

**Unblocks:** anything that requires the world to look finished. Also removes the last dependency on
large stored datasets.

**Bottleneck:** the amplification fitting is genuine research, not a script. Making the Alps look
like the Alps rather than like generic fractal mountains is exactly where the cited papers spend
their effort, and it will need iteration on how it looks rather than a one-shot conversion.

**Risk, and this is the one to watch:** the CPU and GPU implementations of the generator must agree
exactly. Rendering runs on the GPU, but collision, ground-follow and Kaiju AI all run on the CPU
through `sampleHeight`. Any drift and Kaiju sink into hills or hover above them. One shared
definition, careful float discipline, and a test that samples both and compares.

---

#### P4 - Ocean and underwater

**Goal:** the ocean as a place, since that is where most of the game is meant to happen.

**You can test:** wade off a continental shelf, sink, swim in full 3D, watch visibility fall off
with depth, descend into a trench and find it genuinely deep and dark.

**Work:**
- Global sea-level sphere shell as a new water kind, replacing the axis-aligned box model that
  `WaterVolume` currently assumes.
- Depth-driven visibility and colour, reusing `UnderwaterEffect`.
- Movement at reduced speed while submerged.
- True 3D swim movement, which the codebase declares (`movement: 'swim'`) and has never
  implemented.
- Procedural seafloor detail, which is not optional: only 27.3% of the seabed is mapped to modern
  standards, so abyssal plains, trench walls, seamounts and vent fields are authored rather than
  sourced.

**Unblocks:** the underwater half of the game, which is most of it.

**Bottleneck:** the swim controller. Ground-based movement has a floor to stand on; 3D swimming has
no such constraint and needs its own feel, buoyancy, and camera behaviour.

**Risk:** underwater is where the world looks most invented, so it is where art direction matters
most and where "roughly right" is least forgiving.

---

### PART 2 - THE GAME SKELETON

Single player, running locally, no server. The purpose of Part 2 is to find out whether the game is
fun before spending anything on infrastructure. If the loop is not fun here, it will not be fun
with a server behind it.

---

#### P5 - Kaiju as autonomous units

**Goal:** spawn a Kaiju, give it one order, and watch it carry the order out by itself.

**You can test:** point at a location, spawn a Kaiju, and it walks there on its own, routing around
mountains and into water, without further input.

**Work:**
- Kaiju as a new adapter on the existing behaviour-tree AI in `src/features/enemies/ai/`. This is
  the right reuse: five enemies already run on that system and it has adapters, a manager, a spatial
  index and distance-based tick throttling.
- Species definitions with distinct stats, initially mapped onto the four existing monsters and
  later onto the four Synty Kaiju.
- The order vocabulary: go here, take that region, guard that unit, hold position. Orders are
  one-time, not steering; once given, the Kaiju is autonomous. That is the core design constraint
  Geoff set.
- Pathfinding across a sphere, over terrain, in and out of water.

**Unblocks:** every other game system.

**Bottleneck:** making autonomous behaviour **legible**. The player cannot steer, so they must be
able to predict roughly what a Kaiju will do, or the game reads as broken rather than emergent. This
is a design problem more than a coding one and it will need iteration.

---

#### P6 - Territory and flags

**Goal:** land ownership that accumulates as Kaiju move.

**You can test:** walk a Kaiju across a region and watch territory change colour behind it, from
the ground and from orbit.

**Work:**
- Territory grid reusing the cube-sphere quadtree cells at a fixed level. Level 7 gives 98,304 cells
  averaging about 720 m across, which is the recommended starting granularity.
- Claiming by presence: a Kaiju standing in a cell claims it over time, and plants a flag.
- Contest and decay rules, so territory can be taken back.
- Ownership overlay rendered on the globe, which doubles as the strategy view.

**Unblocks:** scoring, and the entire point of the war.

**Bottleneck:** rendering ownership for up to a hundred thousand cells cheaply, at both orbit and
ground range. Almost certainly a texture-based overlay rather than per-cell geometry.

---

#### P7 - Miners

**Goal:** a fragile unit that generates value and needs protecting, which is what forces Kaiju to
defend rather than only advance.

**You can test:** deploy miners, watch them extract, watch an enemy Kaiju kill them easily, watch
your own Kaiju autonomously come back to defend them.

**Work:**
- Miner unit: slow, weak, extracts from the surface, feeds the points economy.
- Defence behaviour in the Kaiju AI: a threat near a friendly miner pulls a nearby Kaiju off its
  current order, then returns it.
- Extraction rates tied to terrain and territory.

**Unblocks:** the strategic tension. Without miners the game is only a land grab.

**Bottleneck:** tuning defence so Kaiju protect miners without abandoning everything else and
oscillating between the two.

---

#### P8 - Combat

**Goal:** Kaiju fight each other, and it is worth watching.

**You can test:** two Kaiju from opposing portals meet and fight without any input, and the outcome
makes sense from their species and stats.

**Work:**
- Combat routed through the existing `EnemyCombatRegistry`, so damage goes through one adapter as it
  already does for every other enemy.
- Species matchups, damage, health, knockback at Kaiju scale.
- Death, and what a dead Kaiju leaves behind.
- Underwater combat differences: reduced speed, reduced visibility, 3D positioning, different
  effective ranges.

**Unblocks:** the war.

**Bottleneck:** combat between units nobody controls has to read as dramatic rather than as two
animations overlapping. Camera framing, impact effects and scale-appropriate timing carry it.

---

### PART 3 - MAKE IT REAL

Server, multiplayer, and the Divi node hook. Everything here assumes Part 2 proved the loop is fun.

---

#### P9 - Server authority and the headless sim

**Goal:** the war continues when nobody is watching.

**You can test:** issue an order, close the browser, come back an hour later and find the Kaiju
somewhere else, with territory changed.

**Work:**
- Move the simulation server-side onto Cloudflare Durable Objects, keyed by cube-face region, which
  is exactly what the existing L2 architecture plan already assumes.
- A tick that is cheap enough to run continuously across many portals.
- Authoritative validation of every order, following the repo's established rule that build and
  state actions are server-validated RPCs and never client-trusted.
- Persistence of Kaiju positions, territory and points.
- Both views become renderers of server state rather than owners of it.

**Unblocks:** everything multiplayer, and the persistence that makes the game a world rather than a
session.

**Bottleneck:** tick cost. A continuously running planet-wide simulation is a very different cost
profile from a game that only runs while someone is looking, and this repo has already been bitten
once by a runaway server cost (the tree-growth cron).

**Note:** terrain needs no storage or sync at all here, because P3's generator is deterministic. The
server computes the same ground the client does from the same parameters. That is the strongest
practical argument for doing P3 as a generator rather than as tiles.

---

#### P10 - Portals and the Divi node gate

**Goal:** portals exist at real Divi node locations, and you can only play if you run a node.

**You can test:** run a node, prove it from DD69, get a portal at your node's real geographic
location, spawn from it.

**Work:**
- A node registry service: something that runs a node, polls `getpeerinfo` and geolocation, and
  publishes node to latitude and longitude. The scanner node behind scan.divi.love is the obvious
  host. Today that list only exists in one desktop app's local storage, so this is genuinely new.
- The proof-of-node gate: the game issues a challenge, DD69 signs it with the node's address via
  `signmessage` (which the wallet crate already calls), the game server verifies the signature and
  checks that address or IP against the live registry, then issues a session token that expires and
  is periodically re-proved.
- Portals rendered on the globe at node coordinates, visible from orbit.
- Portal ownership, and what a portal can do.

**Unblocks:** the hook that makes this a Divi product rather than a game.

**Bottleneck:** the registry service is new infrastructure that has to be reliable, because if it is
down nobody can play.

**Design consequence to solve here:** node locations are Europe and North America heavy, with
near-empty oceans and southern hemisphere. Either that is the game (a land grab from the populated
north) or it needs neutral and NPC portals to balance the board.

---

#### P11 - Multiplayer

**Goal:** many players sharing one planet.

**You can test:** two accounts, two portals, two armies, one world, seeing each other.

**Work:**
- Area-of-interest streaming keyed by the same quadtree cells used for territory and rendering. One
  grid serving three jobs, which is how the existing architecture plan is already structured.
- Binary snapshots over the existing wire format, which already carries a world id and zone id.
- Client-side prediction and reconciliation for the local player's camera and any directly
  controlled unit.

**Unblocks:** the actual multiplayer war.

**Bottleneck:** area of interest at planet scale. Most players will be far apart, which is easier
than a crowded arena, but the few places where armies collide are the expensive ones.

---

#### P12 - Economy, points and scoring

**Goal:** the constraint that makes decisions matter.

**You can test:** a portal has a finite budget, spending it on the wrong Kaiju in the wrong place
loses you territory, and the scoreboard reflects it.

**Work:**
- Points earned from territory held and mining output, spent on spawning Kaiju and miners.
- Portal budgets and regeneration.
- Species costs so choices have trade-offs.
- Scoring, leaderboards, and whether the world resets in seasons or runs continuously.

**Unblocks:** competitive play.

**Bottleneck:** balance, which is a playtest problem rather than an engineering one, and therefore
open-ended. Build the levers to be adjustable from data, not code.

---

### PART 4 - PRODUCTION

---

#### P13 - Real Kaiju models

**Goal:** replace the placeholder golems and demon with the four Synty Kaiju.

**You can test:** Gorilla, Lizard, Crab and Alien as the four species, each animated.

**Work:**
- Buy the Synty POLYGON Kaiju Pack (§4a), take the FBX source not the Unreal project.
- Convert through the character path (`convert_synty.py`, `build_character.py`,
  `retarget_to_synty.py` in `/Users/geoffreymccabe/siege-worlds-port/props/`), following the rules in
  `MONSTER_MODEL_PLAYBOOK.md`.
- Retarget seven to nine clips per species: walk, run, swim, attack, take-hit, death, roar, and a
  flag-plant gesture.
- Keep each glb under 25 MiB and not Draco-compressed, since the monster loader has no decoder.

**Bottleneck:** the Crab. It has a humanoid rig, so biped locomotion clips will look wrong on it,
and it is the natural deep-ocean unit in a game that is mostly underwater. Expect it to need
purpose-bought or hand-authored quadruped clips.

**Note:** this is deliberately late. The whole game can be built and tuned on the four existing
monsters, and swapping models at the end is a contained change.

---

#### P14 - Performance hardening

**Goal:** hundreds of Kaiju on screen without the frame rate collapsing.

**Work:**
- Render LOD for Kaiju reusing the existing AI distance buckets: full skinned mesh near the camera,
  a cheap animated proxy at mid range, a silhouette or marker at orbit range.
- Terrain LOD tuning, impostors, and the SceneCellStreamer work the repo's own performance plan
  already specifies.
- Mobile headroom.

**Bottleneck:** skinned mesh count. Skinned animation does not instance as cheaply as static
geometry, and this is the known scaling wall for any game with large armies.

---

#### P15 - Balance, polish and launch

**Goal:** ship it.

**Work:** playtest and tune, onboarding and tutorial (autonomous units need explaining), audio,
Kaiju-scale effects, the strategy view UI, and the DD69 side of the experience so running a node
and playing feel like one product.

**Bottleneck:** playtesting, which cannot be shortened by engineering.

---

### Dependency summary

- P1 blocks everything.
- P2 needs P1. P3 needs P1. P4 needs P2 and P3.
- P5 needs P2. P6 needs P5. P7 and P8 need P5 and P6.
- P9 needs P5 through P8 to know what it is simulating, and strongly prefers P3 to be a generator.
- P10 can start any time after P1, since the registry work is independent, but only matters after P9.
- P11 needs P9. P12 needs P6 through P8.
- P13, P14 and P15 come last and can overlap.

### Where the project could be cut short and still be worth having

- **After P4** you have a flyable, walkable, swimmable mini Earth. That is a genuinely novel map
  for Siege Worlds on its own, independent of the Kaiju game.
- **After P8** you have a single-player Kaiju sandbox, which is enough to know whether the idea
  works.
- **After P10** you have the Divi hook proven, which is the strategically important part.

### The one sequencing rule

Do not build Part 3 before Part 2 is fun. Server infrastructure, multiplayer and the node gate are
all expensive, and all of them assume a game worth playing. Part 2 costs comparatively little and
answers the only question that matters.

---

## 7. Biggest risks

1. **Performance.** This repo has a documented history of terrain/streaming perf traps, including one
   plausible optimisation that made FPS 20× worse. The globe must be built with distance LOD from the
   first commit, not retrofitted.
2. **Data volume.** 3.7 billion samples cannot be handled casually. Get the pyramid + R2 hosting right
   in Phase 1 or Phase 2 will drown.
3. **The two-view seam.** If globe↔surface transition feels bad, the whole thing feels like two apps.
   Budget real time for it in Phase 3.
4. **Scope.** "Mini Earth map in SWW" (Phases 1-4) and "Kaiju territory war gated on Divi nodes"
   (Phases 5-7) are two projects. The first is a map. The second is a new game that happens to use it.
   Keeping them separately shippable is what makes this tractable.

---

---

# NEXT PHASES (rewritten 2026-Jul-27, after the first playable build)

## Where this actually stands

Built and shipped: the cube-sphere planet from real ETOPO relief, 225 landmark regions at
Copernicus 30 m, procedural amplification, an ocean with swimming, a Kaiju with genuine spherical
physics, and 39 portals at real Divi node locations.

**Confirmed working by Geoff: the portals, and only the portals.** Everything else is written,
type-checked, unit-tested where it is testable, and unverified on screen. The last several rounds
were not new features, they were basic defects found only because Geoff looked: a mirrored planet,
a 180-degree-wrong spawn, an invisible Kaiju, flat terrain, vanishing patches, a white screen.

That ratio is the single most important fact for planning. The bottleneck is not building things,
it is that they are built blind.

## P0 - SEE THE THING (do this before any more features)

Every expensive mistake in this project so far was visual and would have been obvious in one
screenshot. Playwright 1.57 and Chromium are already installed, headless WebGL works, and the app
loads clean. The only blocker is that the game sits behind a login.

Build a **dev-only harness route** (`/globe-test`, gated to dev builds) that mounts the globe
layers in a bare Canvas with no auth, no lobby, no game shell:
  - fixed camera positions: orbit, 5 km above the Grand Canyon, standing at Kaiju height
  - a query string to pick the landmark and the mode
  - deterministic: no day/night, no random spawn

Then a script that screenshots those views and writes them to a folder. That converts every
question in this project from "ask Geoff and wait" into a check I can run in twenty seconds:
  - is there relief at the Grand Canyon?
  - is the Kaiju on screen?
  - are there seams between patches?
  - did the last change break the planet?

Everything below is faster and safer once this exists. It is the highest-value work available and
it is not close.

## P1 - CLOSE OUT THE PLANET

Only after P0, and each item verified by screenshot:

1. **Terrain relief actually visible.** The remaining open question. If the Grand Canyon still
   reads flat, the displacement is not reaching the mesh and that is a narrow, findable bug.
2. **Lighting.** Relief is invisible without directional shading regardless of geometry. Confirm
   the sun is lighting the planet sensibly at every point on the globe, not just near the origin.
3. **Seams.** The skirt-normal fix is in but unverified.
4. **LOD popping** as patches split, which no test can catch.
5. **Textures.** Still none: colour is per-vertex only. The Synty nature biome sets are already
   converted in this repo and map onto the ESA WorldCover classes, which is the cheap route to
   ground that reads as ground.

## P2 - THE GAME LOOP (the first thing that is actually a game)

In order, each playable on its own:

1. **Territory.** Claim ground by walking on it, on the cube-sphere quadtree cells (level 7,
   about 720 m). Ownership rendered as colour on the globe, which doubles as the strategy view.
2. **Spawning from portals.** Points, a per-portal budget, choose a species. The portal ring is
   already built and placed.
3. **Autonomous Kaiju.** One order, then it acts alone, on the existing behaviour-tree AI. This
   is the design risk: the player cannot steer, so behaviour must be predictable enough to read
   as intent rather than as a bug.
4. **Miners.** Fragile, valuable, and the reason Kaiju must defend rather than only advance.
5. **Combat.** Kaiju versus Kaiju, through the existing EnemyCombatRegistry.

Stop after this and decide whether the loop is fun BEFORE spending anything on infrastructure.

## P3 - MAKE IT REAL

1. **Live node registry.** Today's portals are a snapshot read out of DD69's local storage. A
   service that polls a node and publishes continuously is what makes new nodes appear as new
   portals.
2. **Proof of node.** Sign a challenge with the node's key, verify against the live registry.
   This is the actual product hook: no node, no portal.
3. **Server simulation.** The war has to continue when nobody is watching, which means a headless
   tick. Terrain needs no storage or sync because the generator is deterministic.
4. **Multiplayer**, then the points economy and scoring.

## P4 - PRODUCTION

Synty Kaiju pack and its animation retargeting (the Crab is the known hard one), performance work
for many Kaiju on screen, balance, launch.

## The one process change

Nothing here should be built without a way to look at it. P0 is not overhead, it is the fix for
the actual failure mode of this project so far.

## Sources
- ETOPO 2022 Global Relief Model - https://www.ncei.noaa.gov/products/etopo-global-relief-model
- ETOPO 2022 User Guide - https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/docs/1.2%20ETOPO%202022%20User%20Guide.pdf
- GEBCO_2025 Grid - https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2025-grid
- GEBCO download - https://download.gebco.net/
- Copernicus DEM 30 m now freely available (ESA) - https://sentinels.copernicus.eu/-/copernicus-dem-30-metre-dataset-now-freely-available
- Copernicus DEM on AWS Open Data - https://registry.opendata.aws/copernicus-dem/
- Copernicus GLO-30 via OpenTopography - https://portal.opentopography.org/raster?opentopoID=OTSDEM.032021.4326.3
- Seabed 2030 progress, 27.3% mapped (2025) - https://seabed2030.org/2025/06/21/seabed-2030-announces-millions-of-square-kilometers-of-new-seafloor-data-on-world-hydrography-day/
- Seafloor mapping mostly satellite-gravity derived - https://eos.org/articles/new-seafloor-map-only-25-done-with-6-years-to-go
- Terrain amplification using multi-scale erosion (ACM TOG) - https://dl.acm.org/doi/10.1145/3658200
- Multi-theme generative adversarial terrain amplification (ACM TOG) - https://dl.acm.org/doi/10.1145/3355089.3356553
- Real-time terrain enhancement with controlled procedural patterns (CGF 2024) - https://onlinelibrary.wiley.com/doi/full/10.1111/cgf.14992
- Terrain super-resolution through aerial imagery and FCNs (CGF 2018) - https://onlinelibrary.wiley.com/doi/abs/10.1111/cgf.13345
- ESA WorldCover 10 m global land cover - https://esa-worldcover.org/en/data-access
- ESA WorldCover on AWS Open Data - https://registry.opendata.aws/esa-worldcover-vito/
- Random-Access Neural Compression of Material Textures (NVIDIA, ACM TOG) - https://research.nvidia.com/labs/rtr/neural_texture_compression/
- NVIDIA RTX Neural Texture Compression SDK - https://github.com/NVIDIA-RTX/RTXNTC
- NASA Blue Marble Next Generation - https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/
- Blue Marble w/ topography and bathymetry - https://visibleearth.nasa.gov/images/73580/january-blue-marble-next-generation-w-topography-and-bathymetry
- Cube-sphere terrain background - https://acko.net/blog/making-worlds-1-of-spheres-and-cubes/
- Three.js quadtree planet engine (forum showcase) - https://discourse.threejs.org/t/another-quadtree-planet-engine/61587
