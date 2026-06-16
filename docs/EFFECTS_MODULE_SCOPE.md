# Universal Volumetric Effects Module — Scope

> Engine-level, game-agnostic module for smoke / steam / glitter / gas / mist /
> sparks and any future "cloud of stuff in the air" effect. Shared by DreadRoot,
> Pinkland, Siege Worlds, and all future games/worlds on this engine.
>
> First use: smoke trailing off burning enemies (purely visual, no gameplay
> effect). Built so that the SAME module later powers poison gas, sleep clouds,
> glittery flower steam, etc. — with the world able to KNOW a cloud exists so it
> can damage / status entities that walk into it.

## Goals

1. One reusable module, not a one-off smoke hack. Drop-in for every game.
2. Rich variability per effect: color, opacity, lifetime/persistence, rise,
   flutter/turbulence, size growth, spawn rate, spread, blend mode, gravity.
3. Named **recipes** so weapons/animations/items reference an effect by name
   ("fire-smoke", "poison-gas", "glitter-steam") with zero engine edits to add a
   new one.
4. **World-awareness layer**: a cloud can register a gameplay *volume* the world
   can query — "what is at this point in space, what effect, what potency, what
   stage of its life, and what item/source spawned it?" — so entering it can
   poison / sleep / blind / slow / lag / heal an entity.
5. Cheap enough for 100+ emitters at once (e.g. 100 flaming NPCs flying through
   the air) without tanking FPS on mobile.

## Continuous, not voxel-based

The smoke lives in the voxel *world* but is NOT itself voxel-based. Puffs use
full continuous floating-point world coordinates and move on smooth curves
(sub-voxel rise, drift, flutter) — they are never snapped to the 1×1×1 grid and
never rendered as cubes. The result is soft and realistic, free of the blocky
look of the terrain.

The voxel world is only *read*, never imposed:
- **Occlusion / spawn validity (optional, later):** a puff may sample the
  collision grid so it doesn't bloom through a solid wall, or so ground-hugging
  gas pools on top of blocks. This uses the existing `SpatialHashGrid` as a
  lookup — it does not make the smoke voxel-shaped.
- **Gameplay volumes** (Layer 2) are continuous spheres/columns with real
  radii, sampled by `sampleAt(point)`. They work *within* the voxel system
  (entities have world positions) without being quantized to voxels — a poison
  cloud can be 3.7 m across, not "4 blocks."

## The core feasibility trick (two decoupled densities)

- **Visual density is high** — hundreds of tiny puffs make a convincing trail.
- **Gameplay density is low** — ONE coarse volume represents a whole cloud.

These are kept independent. A burning enemy emits a fat *visual* trail but
registers NO gameplay volume (zero gameplay cost — current use case). A poison
grenade emits a visual cloud AND registers a single coarse gameplay volume the
world samples. So we never pay per-puff gameplay cost.

A second trick (visual): **fire-and-forget puffs.** Once a puff is born it is
pinned in space — it rises straight up, flutters, fades, and dies on its own. It
never tracks the emitter. A moving/flying emitter therefore leaves a trail for
free, and a live puff costs only a few float ops per frame.

---

## Layer 1 — Visual renderer (pluggable backends)

The *look* is not hard-coded. Layer 1 is split into a stable interface and
swappable backends, so a recipe — or a whole new game — can pick how its effect
is drawn without inheriting one fixed visual style.

### Stable interface (`FXBackend`)
Every backend implements the same small contract the rest of the engine talks to:
`emitPuff / emitBurst / createEmitter / update(frame) / stop / dispose`. Layers 2
(world-awareness) and 3 (recipes) only ever touch this interface — they never
know or care which backend is rendering. Swapping or adding a backend changes
zero gameplay code.

### Backends (start with one, add freely)
- **`PointsBackend`** (Phase 1 default) — generalization of the existing
  `UniversalFlameRenderer`: a single batched `<points>` cloud, one draw call,
  ring-buffer pool, GPU point sprites. Cheapest; great for smoke/steam/glitter.
- **`SpriteBackend`** (later) — camera-facing textured quads / soft billboards
  for thick, lit, or animated-flipbook smoke where round points aren't enough.
- **`MeshBackend` / custom** (later) — instanced meshes, volumetric shells, or a
  bespoke shader for a game that needs something none of the above gives.

A recipe names its backend (`backend: 'points' | 'sprite' | '<custom>'`) and the
module instantiates it. New game with a new visual need = write a new backend
behind the same interface; no edits to recipes, world-awareness, or call sites.

The variables below (color, opacity, lifetime, rise, flutter, size, blend, etc.)
are the *shared* recipe vocabulary; each backend interprets them in its own
medium, and a backend may expose extra backend-specific options for things only
it supports (flipbook frame, mesh LOD, etc.).

### Emit API (handle, like the flame renderer)
- `emitPuff(recipe, position, overrides?)` — one fire-and-forget puff.
- `emitBurst(recipe, position, count, overrides?)` — N puffs at once (explosion
  poof, glitter pop).
- `createEmitter(recipe, getPosition, overrides?)` → handle — a *source* that
  drops puffs at `spawnRate` per second at its current position until stopped.
  Used by burns: the emitter asks the burn for its current spot each tick and
  drops a puff there. `emitter.stop()` when the fire goes out.

### Per-recipe visual variables
- **colorStart / colorEnd** — gradient over the puff's life (e.g. grey→transparent,
  or rainbow for glitter).
- **opacityStart / opacityEnd** — fade curve endpoints.
- **lifetime** (sec) — persistence; how long a puff lives (smoke ~3s).
- **riseSpeed / gravity** — vertical drift. Negative gravity = rises (smoke,
  steam); positive = sinks/pools (heavy gas hugging the ground).
- **wind** (x,z vector, optional) — global drift direction.
- **flutter** — turbulence amplitude + frequency (the side-to-side wander; reuses
  the sin/cos turbulence already in the flame renderer).
- **sizeStart / sizeEnd** — puffs usually grow as they rise and thin out.
- **spread** — initial scatter radius around the spawn point.
- **spawnRate** — puffs/sec for emitters (smoke ~5/s).
- **blend** — `additive` (glitter, embery smoke, magic) or `alpha` (thick opaque
  smoke). Likely 2 batched draws total, one per blend mode.
- **sprite** — soft round blob vs sparkle/star (glitter twinkle) vs wispy.
- **jitter / twinkle** — per-particle flicker (glitter).
- **lodFadeStart / lodFadeEnd** — distance fade (reuse flame LOD).

### Cost controls
- Single shared ring buffer, hard cap (~2000–3000 puffs). Oldest recycled.
- Distance throttle: far emitters drop spawnRate or stop emitting.
- Per-frame CPU work per puff is tiny (rise + fade + flutter). 100 NPCs ≈ 500
  puffs/sec, ~1500 alive — comfortably inside budget.
- Optional later upgrade: move puff animation to a GPU vertex shader (write
  position+birthtime once at spawn, shader does rise/fade) if profiling ever
  demands it. Not needed for Phase 1.

---

## Layer 2 — World-awareness (`EffectVolumeField`)

A lightweight spatial index of *gameplay* clouds — SEPARATE from the visual
renderer and from the solid-block collision grid. Modeled on `SpatialHashGrid`'s
cell layout but storing effect volumes, not colliders.

A cloud with a gameplay payload registers ONE volume (not per-puff):

### Volume record
- **id**, **center** (world point), **radius** (and optional height for a column).
- **kind** — `none` (visual only), `poison`, `sleep`, `blind`, `lag`, `slow`,
  `heal`, … (open enum; new kinds added by consumers).
- **sourceItemId / sourceType** — WHICH item/weapon/animation made it ("what item
  it came from").
- **tier / intensity** — potency.
- **bornAt / lifetime** and a derived **stage** 0→1 (`born → peak → dissipating →
  gone`) so potency can scale with how fresh the cloud is ("what stage of
  persistence").
- **faction / ownerId** — so friendly clouds don't hurt allies (or do, by design).
- **payload** — effect-specific params: damagePerSecond, statusDurationSec, etc.

### Query API
- `sampleAt(position) → Volume[]` — every active volume covering that point.
  Called per entity (player + NPCs) on their movement tick. Returns nothing —
  and costs nothing — when no gameplay clouds exist (the common case).
- Consumers (player damage system, enemy AI) read the volumes and apply effects:
  poison = DOT, sleep/blind/slow = status with `statusDurationSec`, lag = input
  jitter, etc. The module does NOT apply effects itself — it just makes the cloud
  *knowable*; each game decides what poison/sleep mean.

### Why this stays cheap
- One coarse volume per cloud, not per puff.
- Volumes auto-expire with the cloud.
- `sampleAt` only runs for entities that moved, and short-circuits to zero work
  when the field is empty. Visual-only effects (burning enemies) register no
  volume at all.

---

## Layer 3 — Recipe registry (`effectRecipes`)

A table of named presets, each bundling Layer-1 visual params + an optional
Layer-2 gameplay payload. Weapons/items/animations reference a recipe by name.
Adding "glitter-steam for steaming flowers" = one new entry, no engine code.

Examples (illustrative):
- `fire-smoke` — grey→clear, rises, ~3s, alpha blend, flutter; **no** gameplay
  payload. (Phase 1.)
- `poison-gas` — sickly green, sinks/pools, long lifetime, alpha; payload
  `{ kind:'poison', damagePerSecond, ... }`.
- `sleep-cloud` — soft purple, additive, payload `{ kind:'sleep', statusDurationSec }`.
- `glitter-steam` — additive sparkle, twinkle, gentle rise; visual only (or a
  buff payload).
- `steam` — white, fast rise, short, additive.

---

## Integration points

- **Burn system** (`useBurnSystem.ts`): each active burn creates one
  `VolumetricFXRenderer` emitter (`fire-smoke`) that drops puffs at the burn's
  current world position every tick; `stop()` when the burn ends. Visual only —
  no volume registered. This is all Phase 1 needs.
- **Grenades / future area weapons**: on explode, `emitBurst` for the poof +
  `EffectVolumeField.register` for a lingering gameplay cloud (poison gas, etc.).
- **Player / NPC movement**: on the movement tick, `sampleAt(pos)` and apply any
  returned effects.
- **Animations / props**: a flower's idle animation calls `createEmitter` with
  `glitter-steam`.

## File layout (proposed, engine-shared)

```
src/effects/
  FXBackend.ts               // Layer 1 — the stable backend interface
  backends/
    PointsBackend.tsx        //   batched <points> backend (Phase 1 default)
    SpriteBackend.tsx        //   billboard/flipbook backend (later)
    ...                      //   custom backends per game (later)
  EffectsRoot.tsx            // mounts active backends + routes emits by recipe
  EffectVolumeField.ts       // Layer 2 — gameplay-cloud spatial index + sampleAt
  effectRecipes.ts           // Layer 3 — named presets (visual + payload + backend)
  types.ts                   // recipe/volume/backend/handle types
```

Mounted once near the flame renderer in the Fortress shell so every world gets it.

## Phasing

- **Phase 1 (now):** Layer 1 renderer + recipe system + `fire-smoke` recipe +
  emit from burns. Pure visual. Ships the smoke the user wants today.
- **Phase 2:** Layer 2 `EffectVolumeField` + `sampleAt` + ONE gameplay effect
  end-to-end (poison gas from a grenade) to prove the world-awareness path.
- **Phase 3:** More recipes (steam, glitter, sleep, blind) + status consumers +
  faction/source/persistence-stage potency scaling.

## Culling & FPS safety (the part that keeps this cheap)

Because all puffs live in ONE big world-spanning buffer, three.js's built-in
object frustum culling can't help (it's all-or-nothing on the whole buffer, so
the renderer keeps `frustumCulled={false}`). Culling is therefore done by us, at
two stages, cheapest-first:

1. **Emit-side cull (biggest win).** An emitter past `cullDistance` from the
   camera, or outside the view frustum, drops its spawn rate to zero — the puffs
   are never created at all. No buffer slot, no per-frame cost. This is what
   protects the 100-NPCs-on-fire case: only the handful of burning NPCs actually
   near/in front of the player emit.
2. **Render-side cull (per-puff).** In the per-frame write loop each puff does:
   - a cheap squared-distance test vs `cullDistance` → skip if beyond, and
   - a frustum test (dot-products against the camera planes, with a small radius
     pad so puffs don't pop at screen edges) → skip if off-screen.
   A skipped puff still *ages* from its birth time, so when it re-enters view
   it's at the correct life stage — no popping, and while off-screen it costs
   only the test, not a buffer write.

### Settings (per recipe, with engine defaults)
- **`cullDistance`** — hard max view range. Default **100 m** for smoke; tunable
  per recipe (dense battlefield smoke could be 60 m; a giant landmark plume could
  be 200 m). Beyond this, nothing emits or renders.
- **`fadeStart` / `fadeEnd`** — smooth distance fade-out band (e.g. 80→100 m) so
  clouds dissolve with range instead of hard-cutting. Reuses the flame LOD model.
- **`maxEmitDistance`** — optional separate, usually-smaller radius for *emission*
  vs *rendering*, so existing puffs finish their life as you walk away but no new
  ones spawn.
- **`frustumCull`** — on by default; can be disabled for effects that must read
  correctly in mirrors / minimaps / wide shots.
- Global ring-buffer **hard cap** is the final backstop regardless of settings.

These are recipe fields, so smoke-on-fire ships with sane defaults (100 m,
frustum-culled) and any future effect can override.

## Performance budget (must hold on mobile)

- Visual: 1–2 draw calls total; ring-buffer hard cap; emit-side + per-puff
  distance & frustum culling; cheap per-puff CPU for what's actually visible.
  100 flaming NPCs in arcs = only the near/on-screen few do any work.
- Gameplay: coarse volumes only; `sampleAt` short-circuits when empty; zero cost
  when no gameplay clouds are active (the default during normal fire combat).
