# KAIJU CITY — Dubai

*Plan, with the open-source research for each part. Written 2026-Aug-08.*

**The ask (Geoff):** all four districts — Downtown, Sheikh Zayed Road, Dubai Marina and The Palm —
"or it won't have the right 3D effect and scale". Buildings as box colliders. Destructible: "if,
when hit, they break into shards and those shards fall at 9.8 m/s² it would be amazing." Night time,
for the blinking lights. Facade textures can be supplied.

---

## Where it stands

Two of the six parts are **already proven against real data**, not estimated. The rest is designed
but unbuilt.

| Part | Status |
|---|---|
| 1. Building data | **Proven.** Real Dubai buildings fetched and parsed. |
| 2. Shape + collider | **Proven.** Oriented boxes computed correctly from real footprints. |
| 3. Rendering | Designed. Uses patterns already working in this repo. |
| 4. Night lights | Designed. Cheap. |
| 5. Destruction | Researched. Recommendation below, and it is *not* the obvious one. |
| 6. Physics frame | **The real risk.** Identified, with a fix. Read this one. |

---

## 1. Building data — SOLVED

**OpenStreetMap, via the Overpass API, fetched once offline.** Free, ODbL licence (one line of
attribution in the credits). Dubai's towers are mapped in detail — real outlines, real heights, real
names.

Measured, not guessed. Downtown Dubai, a 3.3 × 2.5 km box:

```
2,834 buildings
  Burj Khalifa .... 522 m     Index Tower ..... 326 m
  Gevora Hotel .... 356 m     Rose Rayhaan .... 315 m
  The A-Tower ..... 334 m     Opera Grand ..... 288 m

  over 300 m ...  6      80–150 m ....  75
  150–300 m .... 56      under 80 m ... 304
```

**The gap, and how it closes.** Only about one building in six carries a height tag. But the ones
that do are the towers — mappers care about towers. Everything missing is villas, warehouses and car
parks. Those get a height derived from footprint area with a *seeded* random, so the skyline is real
and the filler is merely plausible, and the city is identical on every rebuild.

**Alternatives considered.** Overture Maps (OSM + Microsoft's ML footprints, has ML-derived heights)
is a better dataset but ships as multi-gigabyte Parquet — worth revisiting only if OSM's coverage
disappoints. Google Photorealistic 3D Tiles is the real textured city, but it is a paid API, heavy to
stream, and its licence forbids the kind of use this is.

**Estimated total for all four districts:** roughly 40,000–70,000 buildings, about 1.5 MB.

---

## 2. Shape and collider — SOLVED

Each footprint is reduced to its **smallest containing rectangle at any angle** — rotating calipers
on the convex hull, which is exact rather than a search. Six numbers per building: position (2),
size (2), rotation (1), height (1). **24 bytes.**

This matters more than it sounds. Dubai's street grid runs at about 50° to north, so an
axis-aligned box around a rotated tower is up to 40% too big in both directions — the towers would
look bloated and the colliders would keep the Kaiju an invisible 15 m away from every wall.

Verified against real buildings, and the numbers are right:

```
The Address – Dubai Mall    192 m tall, footprint  85 × 22 m, rotated 111°   (a slim tower)
The Palace – Downtown        20 m tall, footprint 248 × 103 m, rotated -80°  (a low, wide hotel)
Burj Residences 8           150 m tall, footprint  32 × 23 m, rotated  -6°
```

One rotated box is simultaneously **the render instance, the collider, and the thing that gets cut
into shards.** One piece of data doing three jobs.

The dozen landmarks with distinctive silhouettes — the Burj's setbacks, the Burj Al Arab's sail —
want their real outline or a hand-built model. Everything else is a box and nobody will know.

---

## 3. Rendering

**One instanced draw for the whole city.** 60,000 boxes is about 720,000 triangles, which is not a
lot; the repo already draws instanced blocks in the tens of thousands.

**Facades procedurally, not from textures.** A window grid derived in the shader from each
building's height and width, so a 60-storey tower gets 60 rows of windows with nothing stored. This
is the same approach as the muzzle-flash star and the fire flipbook, and it is the reason those cost
nothing to ship. Geoff's facade textures layer on top of this later for close-up detail — the
procedural grid is what makes 60,000 buildings affordable, and a texture is what makes ten of them
beautiful.

**Level of detail** by distance band: full windows near, flat tinted boxes far.

---

## 4. Night lights

Two effects, both nearly free:

- **Window lights**, on and off at random per window, from a hash of the window's cell index and a
  slow time bucket. No data, no update cost — it is arithmetic in the fragment shader.
- **Aircraft warning beacons**, red, slow pulse, on every roof over 150 m. Additive points; the same
  system already drawing muzzle flashes.

At night, a Kaiju silhouetted against a lit skyline is the whole reason to build this.

---

## 5. Destruction — researched, and the recommendation is to NOT use the library

Geoff: *"it would be better that we don't have to invent."* Agreed in principle. Here is what exists.

**What is out there:**

- **`ConvexObjectBreaker`** — ships inside three.js itself (`examples/jsm/misc`). Cuts a convex mesh
  into pieces at an impact point. Used in three.js's own `physics_ammo_break` demo. Mature, free,
  already available.
- **`three-pinata`** (dgreenheck) — a modern library that fractures and slices arbitrary meshes in
  real time. Actively maintained, and the better choice of the two for general meshes.
- **Rapier** — Rust/WASM physics, the current standard for the web, used with either of the above to
  give the fragments real rigid-body behaviour.

**Why I would not reach for them here, and it is not stubbornness.**

Those libraries solve *fracturing an arbitrary mesh*. Our buildings are **boxes**. Cutting a box into
chunks is a handful of lines, and — more importantly — a box cut *the way a building breaks* looks
far better than a generic convex fracture: slice it into floor slabs, then split those vertically, and
the debris reads as **pieces of building**, with floors and walls, instead of as gravel. A general
fracture library cannot know that a building has floors.

The physics is the same story. The repo **already** simulates position, velocity, gravity toward the
planet's centre, air drag, ground collision and bounce — that is the bullet system, working and
tested. A shard is that, plus rotation. Perhaps eighty lines, reusing code that already handles the
sphere correctly.

Against that, adding Rapier means a 1–2 MB WASM payload, a second physics world to keep in step with
the existing one, and the precision problem in §6 that its `f32` maths would make worse.

**Recommendation: build it, using the systems already here.** Roughly 30–60 chunks per tower, each a
box, each falling under real gravity, bouncing once or twice and settling into rubble that stays.
Shard-to-shard collision is the one thing this gives up — at 300 m scale, falling debris reads
convincingly without it.

**If that proves too crude, the upgrade path is Rapier in the local frame from §6** — which is
exactly the design that makes it possible. Nothing here forecloses it.

---

## 6. The real risk: coordinates, and the fix

**This is the part that would quietly ruin everything, so it is designed first.**

The planet's surface sits **63,710 units from the world origin**. Single-precision floats — which is
what GPUs use, and what Rapier uses — carry about 7 significant digits, so at that distance the
smallest representable step is roughly **0.4 metres**. Shards would jitter and vibrate rather than
settle. Buildings 20 m apart would fight for the same coordinates.

**The fix is standard for planetary games: a local frame.** Everything within a few kilometres of the
fight is simulated in a **tangent plane centred on the player** — Y up, gravity straight down at
9.81 m/s², coordinates near zero, full precision. Positions convert to and from planet coordinates
only at the boundary, which happens once per object per frame and costs nothing.

This buys three things at once: the precision problem disappears, gravity becomes a constant vector
that any physics engine understands, and if Rapier is ever wanted it drops straight in.

---

## Phases

**Phase 1 — the city exists.** Fetch all four districts, bake to `public/siege/city/dubai.bin`,
render as instanced grey boxes at the right place on the globe. Success: fly to Dubai and see a
correctly shaped skyline.

**Phase 2 — it looks like a city.** Procedural windows, night lighting, warning beacons, facade
variation. Success: it reads as Dubai at night.

**Phase 3 — it is solid.** Box colliders. The Kaiju cannot walk through towers; bullets and flame
hit them. Success: you can lean on a building.

**Phase 4 — it breaks.** Fracture into floor-slab chunks on impact, real gravity, rubble that stays.
Success: knock a tower down.

**Phase 5 — polish.** Landmark models, dust clouds on collapse, fires in the wreckage, damage that
persists.

Phases 1–3 are the ones that make the place worth visiting. Phase 4 is the one Geoff actually wants.

---

## Decisions

**Coverage — all four districts at once** (Geoff, 2026-Aug-08). Not Marina first: "it's not much
extra work to just do them all", and he is right — the fetch is the same script over a bigger box,
and the scale only reads correctly when the skyline continues to the horizon.

**Damage heals on restart, for now.** Geoff: *"make it heal if I restart the game, but keep the
option open to permanently destroy cities and harvest the materials in the buildings."*

That second clause is a real constraint on today's design, not a someday-nice-to-have, and it costs
almost nothing to honour IF it is honoured now:

1. **Every building has a stable id.** Damage is keyed by the building's OpenStreetMap id, written
   to `dubai-ids.bin` and not loaded by the game yet. The array index would have been free and is
   the obvious choice — and it is wrong: insert one building on a future re-fetch and every index
   after it shifts, so every saved ruin silently moves to a different tower. An OSM id is stable for
   as long as the building exists in the real world, which is exactly the lifetime needed.
2. **Damage lives in ONE place** — a map of building id to damage state. Today it is in memory and
   dies with the page. Making it permanent is changing where that map is read and written, and
   nothing else in the renderer or the collider needs to know.
3. **Materials are derived, never stored.** Volume is width x depth x height, which is already in
   the file; tonnage of concrete, steel and glass is a multiplier on that. Harvesting a building
   therefore needs no new data at all — just a rule about how much a cubic metre of tower is worth.

The one thing to be careful of: a re-fetch that changes building shapes would leave saved damage
describing a building that is no longer the same size. That is a versioning problem for the day
persistence ships, and the header already carries an origin it can be stamped alongside.

**Night, for the lights.**

---

## Open questions

1. **Where does the fight start?** The four districts span about 20 km. Marina is the densest cluster
   of tall towers and the best place to *fight among* buildings; Downtown has the Burj. Suggest
   dropping in at Marina with the rest walkable.
2. **How much of the city is solid at once?** Colliding against 60,000 buildings is wasteful when
   only a few hundred are within reach. Suggest a moving window of a few kilometres.

## Sources

- OpenStreetMap / Overpass API — https://overpass-api.de/
- Overture Maps Foundation, buildings theme — https://overturemaps.org/
- three.js `ConvexObjectBreaker` — https://threejs.org/docs/pages/ConvexObjectBreaker.html
- three.js `physics_ammo_break` example
- three-pinata — https://github.com/dgreenheck/three-pinata
- Rapier physics — https://rapier.rs/
