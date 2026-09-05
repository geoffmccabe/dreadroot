# Starblink world generation - phased plan

Status: **plan only, nothing built.** Written 2026-Sep-04, against v4.352.99.

Goal: fill all 90,307 parcels with organic terrain (mountains, hills, canyons, cliffs) and a very
dense mushroom forest with trees up to 100-200 m, generated rather than hand-placed, and stored as
a handful of numbers rather than millions of rows. The centre 7 parcels (the Fortress) stay flat.

---

## 1. What already exists

Checked in the live code, not assumed. This is why the job is smaller than it looks.

| Piece | Where | State |
|---|---|---|
| Sculptable heightfield | `src/components/siege/terrain/heightField.ts` | Working. **Sparse**: stores only edited samples, everything else returns a flat baseline. |
| Hex ground reads it | `src/components/siege/StarblinkHexGround.tsx` | Working. Per-vertex height, rebuilds on edit. |
| Procedural scatter | `src/components/siege/builder/pgState.ts` | **Working, and better than expected.** |
| Mushroom species | `src/components/siege/builder/mushroomCatalog.ts` | 30 species already catalogued. |
| Instanced rendering | `src/components/siege/builder/ProceduralObjectsLayer.tsx` | Already draws PG output as `InstancedMesh` per species sub-mesh. |

The existing scatter already supports, per species: rarity weight, min/max height, altitude band and
max ground slope; and globally: count, size bias, random yaw, **max tilt (the lean)**, stretch
variation and a seed. Its defaults are already `minH: 10, maxH: 200`, which is exactly the size
range asked for.

**So the algorithm is largely done. Two things are missing, and they are the whole job:**

1. **Terrain is flat.** The heightfield's unedited baseline is a constant. There is no generator.
2. **The forest is stored, not generated.** `generate()` scatters a fixed `count` into a rectangle
   and the result is saved as an instance list (`siege_pg_sets`). Fine for one grove; impossible for
   900 km2, which is the "don't take too much space" problem.

---

## 2. The core idea

Both problems have the same answer: **make it a pure function of position and a seed, evaluated on
demand, and never store the output.**

- Terrain height at (x, z) = `noise(x, z, seed)`, computed when a parcel is drawn.
- The mushrooms in parcel (q, r) = `hash(q, r, seed)` driving the existing scatter rules.

Total storage for the whole world becomes **one seed plus a page of tuning parameters**. Manual
brush edits keep working, as sparse overrides on top of the generated baseline: an untouched world
stores nothing at all, and a sculpted hill stores only the samples actually moved.

---

## Phase 1 - Procedural terrain

**The change that unlocks it is one line.** `getSampleAt()` currently returns a constant `baseY` for
any unedited sample. Give the heightfield a pluggable baseline provider and that constant becomes
`terrainHeight(x, z)`. Nothing else in the engine has to know: ground-follow, physics, monsters,
coin drops and the terrain brush all read `getHeight()` and keep working.

New module `src/features/starblink/terrainGen.ts`, layered noise, cheap and deterministic:

| Layer | Wavelength | Amplitude | What it makes |
|---|---|---|---|
| Continental | 6-10 km | +/- 120 m | Broad highlands and basins, so the world is not uniform |
| Mountains (ridged) | 2-4 km | 0-320 m | Ranges with real ridgelines, not blobs |
| Hills | 600-1200 m | +/- 50 m | The general roll of the land |
| Roughness | 40-80 m | +/- 4 m | Stops slopes looking like glass |

Proposed ceiling: **peaks around 400 m**, valleys near 0. With 100-200 m mushrooms on top that is a
600 m skyline, which reads as dramatic without making travel miserable. Every number above is a
constant in one file, so tuning is a one-line edit, not a redesign.

**The Fortress stays flat.** Multiply the whole result by a falloff that is 0 inside the 7-parcel
rosette and eases to 1 by about 500 m out. Flat plaza, no cliff at its edge.

**Decisions wanted from Geoff:** the 400 m ceiling, and whether the world should feel
mountain-dominant or plains-dominant. That is a single ratio between the mountain and hill layers.

## Phase 2 - Canyons and cliffs

Both are shaping passes on the Phase 1 function, not new systems.

- **Canyons.** Carve along winding paths using domain-warped ridged noise, 60-120 m deep and
  150-400 m wide. Domain warping is what stops them looking like straight scratches.
- **Cliffs.** Terrace the mountain layer: quantise height to about 25 m steps, but ONLY where the
  slope is already steep (past roughly 35 degrees). Flat ground stays smooth, steep ground gains
  hard benches and faces. This is the cheapest convincing cliff there is.
- **Slope-aware ground colour.** Steep faces read as rock rather than grass. The honeycomb shader
  already blends by a per-vertex weight, so this is one extra attribute.

Watch out for: cliffs the player can get permanently stuck under, and canyon walls steeper than the
step-up logic can handle. Both need a walkability pass.

## Phase 3 - The procedural forest

New module `src/features/starblink/forestGen.ts`.

For each parcel that streams in: seed a small deterministic RNG from `(q, r, worldSeed)`, then run
**the existing scatter rules** to emit that parcel's mushrooms. Same weighted species pick, same
per-species size and altitude band, same slope rejection, same yaw/tilt/stretch. Nothing about the
look is reinvented; only the driver changes, from "scatter N into a rectangle and save" to "given a
parcel, produce its trees".

Because it is a pure function of the parcel, a tree is in the same spot every visit for every
player, and none of it is stored.

- **Density.** "Very dense" is the goal, so start high, around 250-400 trees per parcel (one every
  5-6 m), and tune down only if the frame rate demands it.
- **Size.** Keep the existing 10-200 m range but bias it: mostly small, with rare giants. A
  power-law pick makes 150 m+ trees genuinely uncommon landmarks rather than wallpaper.
- **Lean.** The existing `tiltMax` already does this; a few degrees is plenty to kill the
  "telegraph poles" look.
- **Keep the Fortress clear**, using the same falloff as the terrain.

Reuse `ProceduralObjectsLayer`'s instancing, batched per streamed parcel.

## Phase 4 - Making it run

This is the phase that will actually be hard, and it should not be underestimated. Hundreds of
trees per parcel across a visible radius is tens of thousands of instances.

- Cull by parcel, on the same streaming grid as the ground.
- Distance LOD: full mesh close, a cheap proxy further out, a billboard beyond that. Giants need a
  larger draw radius than small trees, since a 200 m mushroom is visible from kilometres away.
- Hard per-frame instance budget, spending it on the nearest and largest.
- Measure against the existing FPS work rather than guessing.

## Phase 5 - Tuning and locking

A small panel for world seed, terrain amplitude and roughness, and forest density, so the world can
be re-rolled until it looks right. **Then freeze the seed**, because the moment land is sold the
terrain under it must never change again.

---

## Open questions

1. **Climbing.** "A whole world of 3D objects to climb around on" needs collision on the mushrooms.
   Today the player follows the heightfield; standing on a mesh needs the mesh-collider path, and
   doing that for a dense forest is its own performance problem. This may deserve its own phase.
2. **Water.** Canyons and basins below sea level want water. There is an editable water layer
   already; whether the generated world has a global sea level is a design decision.
3. **Parcel identity.** Land is being sold. It is worth deciding early whether a parcel's terrain
   type (from Section 5 of the land plan) is derived from this generator, so "Mountain" parcels
   actually contain mountains.

## Suggested order

Phase 1 first and alone: a world with real terrain and no trees is immediately worth walking
around, and it de-risks everything else. Phase 3 next, since the forest is the visual payoff and
most of its code exists. Phase 2 is polish. Phase 4 runs alongside 3 rather than after it.
