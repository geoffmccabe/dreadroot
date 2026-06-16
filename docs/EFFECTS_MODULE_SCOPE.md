# Universal Volumetric Effects Module — Scope (audited)

> Engine-level, game-agnostic module for smoke / steam / glitter / gas / mist /
> sparks and any future "cloud of stuff in the air" effect. Shared by DreadRoot,
> Pinkland, Siege Worlds, and all future games on this engine.
>
> First use: smoke trailing off burning enemies (purely visual). Built so the
> SAME module later powers poison gas, sleep clouds, glittery flower steam, etc.,
> with the world able to KNOW a cloud exists so it can damage/status entities.
>
> **This revision incorporates a performance audit** against current best
> practice (Unreal Niagara scalability docs, three.js/WebGL + WebGPU particle
> techniques, mobile fill-rate research — see Sources). Where the first draft was
> risky, the risk and the fix are called out inline and in the Audit section.

---

## TL;DR of the audit

The original "copy the existing `<points>` flame renderer and animate it on the
CPU every frame" plan would have hit three known failure modes. Corrected design:

1. **Render with instanced billboards, NOT `gl.POINTS`.** `gl_PointSize` is
   hardware-capped (~63–255px); big/near smoke would stop growing and look
   broken. Camera-facing instanced quads have no size cap, allow per-particle
   rotation, flipbooks, and soft particles.
2. **Stateless vertex-shader simulation, NOT CPU-per-frame.** CPU writes each
   puff's birth-time + seed + ballistic params ONCE at spawn; the vertex shader
   computes position/size/alpha/spin from a single `uTime` uniform every frame.
   Live particles then cost ~0 CPU and zero per-frame GC — critical, since the
   D-Flow panel already flags GC pauses as a real FPS limiter here.
3. **Overdraw / fill-rate is the real GPU-melt risk, not particle count.** On
   mobile, stacked transparent quads re-shading the same pixels is what tanks
   FPS. Mitigations are first-class in this plan (capped on-screen size, fewer/
   larger flipbook puffs, alpha-trimmed quads, optional half-res particle buffer,
   cheap fragment shader, additive-where-possible to skip sorting).

The 3-layer structure, continuous (non-voxel) rendering, pluggable backends,
distance+frustum culling, and world-knowable gameplay volumes from the prior
draft all survive — they're reinforced by the research, not replaced.

---

## Goals

1. One reusable engine module, not a one-off smoke hack. Drop-in for every game.
2. Rich per-effect variability: color, opacity, lifetime/persistence, rise,
   flutter/turbulence, size growth, spin, spawn rate, spread, blend, gravity.
3. Named **recipes** so weapons/animations/items reference an effect by name
   ("fire-smoke", "poison-gas", "glitter-steam") with zero engine edits to add one.
4. **World-awareness layer**: a cloud can register a gameplay *volume* the world
   can query — what effect, what potency, what stage of life, which source/item —
   so entering it can poison/sleep/blind/slow/lag/heal an entity.
5. **Pluggable visual backends** so a game can change *how* an effect is drawn
   (points / instanced billboards / future WebGPU compute) without touching
   recipes or gameplay.
6. Hold **< ~1 ms total particle time on mobile** with 100+ emitters
   (e.g. 100 flaming NPCs flying through the air).

---

## Continuous, not voxel-based

Smoke lives in the voxel *world* but is NOT voxel-based. Puffs use continuous
floating-point world coordinates and move on smooth curves (sub-voxel rise,
drift, flutter); never snapped to the 1×1×1 grid, never drawn as cubes. The look
is soft and realistic, free of the blocky terrain aesthetic.

The voxel world is only *read*, never imposed:
- **Occlusion / soft particles (optional, later):** a puff may sample scene depth
  (the existing opaque/voxel depth buffer) so it fades where it meets a wall
  instead of clipping hard; ground-hugging gas may sample the collision grid to
  pool on top of blocks. This is a lookup — it never makes smoke voxel-shaped.
- **Gameplay volumes** (Layer 2) are continuous spheres/columns with real radii
  (a poison cloud is 3.7 m across, not "4 blocks"), sampled by `sampleAt(point)`.

---

## The two feasibility tricks

**(A) Two decoupled densities.** Visual density is HIGH (hundreds of puffs make a
convincing trail); gameplay density is LOW (ONE coarse volume per cloud). Kept
independent. A burning enemy emits a fat *visual* trail but registers NO gameplay
volume (zero gameplay cost — the Phase-1 case). A poison grenade emits a visual
cloud AND one coarse volume. We never pay per-puff gameplay cost. This also
sidesteps a hard GPU limitation (below): GPU particle positions can't be read
back to the CPU cheaply, so gameplay must NOT depend on them — and here it never
does, because the volume is authored CPU-side analytically.

**(B) Fire-and-forget, GPU-resident puffs.** Once a puff is born it's pinned in
world space and forgotten by the CPU: the vertex shader rises/flutters/fades it
from its birth time. A moving/flying emitter leaves a trail for free, and a live
puff costs ~0 CPU. The CPU's only per-frame job is bumping `uTime`.

---

## Layer 1 — Visual renderer (pluggable backends)

The *look* is not hard-coded. Layer 1 is a stable interface plus swappable
backends, so a recipe — or a whole new game — picks how its effect is drawn
without inheriting one fixed style.

### Stable interface (`FXBackend`)
Every backend implements the same contract: `emitPuff / emitBurst /
createEmitter / update(frame) / setQuality / stop / dispose`. Layers 2 and 3 only
ever touch this interface — they never know which backend renders. Swapping or
adding a backend changes zero gameplay code.

### Backends
- **`InstancedBillboardBackend` (Phase-1 DEFAULT, the corrected design).**
  `InstancedBufferGeometry`: one base quad, per-particle instanced attributes
  (`aBirthTime`, `aSeed`, `aSpawnPos`, `aVelocity`, `aLifetime`, `aSize0/1`,
  `aSpin`, `aColor0/1`). One draw call. Camera-facing billboarding + all motion
  computed in the **vertex shader** from `uTime`. No `gl_PointSize` cap, supports
  per-particle rotation, flipbooks, and soft particles. This is the smoke/steam/
  glitter default.
- **`PointsBackend` (kept for legacy/tiny effects).** The existing batched
  `<points>` path. Fine for small, fixed-size, non-rotating sparks that never
  approach the size cap. NOT for big foreground smoke.
- **`ComputeBackend` (future, WebGPU/TSL).** Compute-shader, GPU-resident state
  for true feedback physics (collisions, curl-noise advection, 100k+). Optional
  enhancement; core smoke must NOT depend on it so the WebGL path stays identical.

A recipe names its backend; the module instantiates it. New visual need = new
backend behind the same interface.

### Shared recipe vocabulary (each backend interprets in its medium)
- **colorStart / colorEnd** gradient over life (or rainbow/twinkle for glitter).
- **opacityStart / opacityEnd** + fade curve.
- **lifetime** (sec) — persistence (smoke ~3 s).
- **riseSpeed / gravity** — negative gravity rises (smoke, steam); positive sinks
  (heavy gas pooling on the ground).
- **wind** (x,z) optional global drift.
- **flutter** — turbulence amplitude + frequency (derived in-shader from `aSeed`
  via a hash, not stored — saves bandwidth).
- **sizeStart / sizeEnd**, **spin** (per-particle rotation rate).
- **spread** — initial scatter radius.
- **spawnRate** — puffs/sec for emitters (smoke ~5/s).
- **blend** — `additive` (glitter, bright steam, embers — order-independent, no
  sort) or `alpha` (thick dark smoke). Likely 2 batched draws total, one per
  blend mode. Always `depthWrite:false`, `depthTest:true`.
- **sprite / flipbook** — soft round blob, or an N×M sub-UV atlas animated from
  `age/lifetime` (optionally inter-frame blended) for realistic turbulent smoke
  with few particles.
- **softParticles** (quality toggle) — fade at geometry intersection via scene
  depth.
- Backends may expose extra backend-specific options (mesh LOD, compute forces).

---

## Layer 2 — World-awareness (`EffectVolumeField`)

A lightweight spatial index of *gameplay* clouds — SEPARATE from the visual
renderer and from the solid-block collision grid. Modeled on `SpatialHashGrid`'s
cell layout but storing effect volumes, not colliders. A cloud with a gameplay
payload registers ONE volume (not per-puff):

### Volume record
- **id**, **center**, **radius** (+ optional height for a column).
- **kind** — `none` (visual only), `poison`, `sleep`, `blind`, `lag`, `slow`,
  `heal`, … (open enum).
- **sourceItemId / sourceType** — which item/weapon/animation made it.
- **tier / intensity** — potency.
- **bornAt / lifetime** and derived **stage** 0→1 (`born → peak → dissipating →
  gone`) so potency scales with freshness.
- **faction / ownerId** — so friendly clouds don't hurt allies (or do, by design).
- **payload** — `damagePerSecond`, `statusDurationSec`, etc.

### Query API
- `sampleAt(position) → Volume[]` — every active volume covering that point.
  Called per entity (player + NPCs) on their movement tick. Returns nothing and
  costs nothing when no gameplay clouds exist (the common case). Consumers (player
  damage, enemy AI) read volumes and apply effects; the module makes the cloud
  *knowable*, each game decides what poison/sleep mean.

### Why this is cheap and GPU-safe
- One coarse volume per cloud, not per puff; volumes auto-expire with the cloud.
- `sampleAt` runs only for entities that moved and short-circuits when the field
  is empty. Visual-only smoke registers no volume.
- **Never reads GPU particle state** (which would stall the WebGL pipeline). The
  volume is independent CPU data, so gameplay works even when visuals are fully
  GPU-resident.

---

## Layer 3 — Recipe registry (`effectRecipes`)

Named presets bundling Layer-1 visual params + Layer-1 backend choice + optional
Layer-2 gameplay payload. Items/weapons/animations reference a recipe by name.
Adding "glitter-steam for steaming flowers" = one new entry, no engine code.

Examples: `fire-smoke` (grey→clear, rises, ~3 s, alpha, flutter, no payload —
Phase 1); `poison-gas` (green, sinks/pools, long life, payload
`{kind:'poison',damagePerSecond}`); `sleep-cloud` (purple, additive,
`{kind:'sleep',statusDurationSec}`); `glitter-steam` (additive sparkle, twinkle,
gentle rise); `steam` (white, fast rise, short, additive).

---

## PERFORMANCE AUDIT — risks & resolutions

| # | Risk | Severity | Resolution |
|---|------|----------|-----------|
| 1 | **`gl_PointSize` cap** — `<points>` smoke stops growing when big/near; looks broken | High (visual break) | **Instanced billboards** (camera-facing quads), no size cap, per-particle spin |
| 2 | **CPU-per-frame sim** — recomputing every particle each frame burns CPU + churns GC | High (FPS, GC pauses) | **Stateless vertex-shader sim** — CPU writes birth-time+seed once; VS does the rest from `uTime`. ~0 CPU/live particle, zero per-frame GC |
| 3 | **Overdraw / fill-rate** — stacked transparent quads re-shading pixels = mobile GPU melt | **Highest on mobile** | Cap on-screen size + live count; **fewer/larger flipbook puffs** not thousands of blobs; **alpha-trimmed octagon quads** (don't rasterize empty corners); **optional ½-res particle render target + depth-aware upsample** (4–16× fill cut); minimal fragment shader (1 texture fetch, no lighting) |
| 4 | **Transparency sorting** — per-particle CPU sort doesn't scale | Med | **Additive** wherever the look allows (glitter, bright steam) = order-independent, no sort. Dark alpha smoke: `depthWrite:false` + accept minor mis-sort, or sort coarsely per-emitter. No per-particle CPU sort, ever |
| 5 | **Whole-buffer frustum culling** — three.js culls the whole points/instanced object, not per-particle | Med | **Emit-side cull is the big win** (far/off-screen emitters spawn nothing). Per-puff distance+frustum test in the sim. Manual **fixed bounding sphere** (padded) per backage mesh; disable auto-cull or feed correct bounds |
| 6 | **Unbounded growth** — many emitters → buffer/GPU blow-up | Med | Central **budget manager**: global live-particle + live-emitter caps; **significance scoring** (importance + distance + age) culls lowest first; per-quality-tier profiles (Low disables decorative emitters, shrinks counts, cuts cull distance + tick rate) |
| 7 | **GPU particles can't talk to CPU** — gameplay can't read GPU positions without a stall | Med (design trap) | Already handled by **two-density split**: gameplay volumes are CPU-authored, never derived from GPU particles |
| 8 | **Render-pipeline integration** — ½-res RT / depth prepass could clash with existing passes and the co-build window | Med (regression) | Phase 1 ships **without** the ½-res pass (just capped count+size+trimmed quads); add it behind a **quality flag** only if profiling shows overdraw bound. Soft particles reuse the existing depth buffer; gated as a toggle |
| 9 | **GPU granularity floor (~64)** — a GPU pass per tiny puff wastes resources | Low | All smoke flows through ONE shared system/backend; we never spin a pass per puff |
| 10 | **WebGPU migration churn** | Low (future) | Keep core smoke **stateless** so it runs identically on the WebGL2 fallback; WebGPU/TSL is an optional `ComputeBackend` swap behind the same interface, not a rewrite |

### Hard performance contract (targets)
- **Total particle frame time:** < **1 ms on mobile**, < 2–3 ms desktop.
- **1–2 draw calls** for all smoke (one per blend mode).
- **Zero per-frame allocations** in the hot path (SOA `Float32Array`s,
  pre-allocated ring buffer, `updateRanges` for only the dirty spawn slice).
- **Global caps:** ring-buffer hard cap (~2–4k instances) + emitter cap;
  significance-culled when exceeded.

---

## Culling, LOD & quality tiers

Because all puffs live in one world-spanning buffer, three.js's built-in object
frustum culling is all-or-nothing — we cull ourselves, cheapest-first:

1. **Emit-side cull (biggest win):** an emitter past `cullDistance` or outside the
   frustum drops spawnRate to zero — puffs are never created. Protects the
   100-NPCs-on-fire case (only the near/on-screen few emit).
2. **Per-puff cull:** squared-distance test + frustum test (with a small radius
   pad so puffs don't pop at screen edges) in the sim. Skipped puffs still *age*,
   so they re-enter view at the correct life stage — no popping.
3. **Significance LOD:** full → reduced count + slower tick → cheap impostor (a
   single animated billboard) → culled, by distance × importance × age.

### Settings (per recipe, engine defaults)
- **`cullDistance`** (default **100 m** for smoke; tunable per recipe).
- **`fadeStart`/`fadeEnd`** smooth distance fade band (e.g. 80→100 m).
- **`maxEmitDistance`** optional smaller emission radius (existing puffs finish,
  no new ones spawn as you walk away).
- **`frustumCull`** on by default (off for mirrors/minimaps).
- **`quality`** Low/Med/High profile: caps count, size, cull distance, tick rate,
  and toggles soft particles / ½-res buffer. Mobile defaults to Low/Med.
- Global ring-buffer hard cap is the final backstop.

---

## Memory & GC discipline (matches engine norms)

- **SOA `Float32Array`s** per attribute (birthTime, seed, pos, vel, lifetime),
  backing `InstancedBufferAttribute`s — contiguous, cache-friendly, GC-free.
- **Pre-allocate max count once; ring buffer recycles.** Spawn = advance a write
  cursor, overwrite the oldest slot in place, mark only that subrange dirty via
  `BufferAttribute.updateRanges`. Never allocate/free per particle; reuse
  module-level scratch vectors for spawn math (same discipline as `numPosKey`/
  colliders elsewhere).
- Most attributes are **write-once** (stateless sim) → almost no per-frame upload.

---

## File layout (proposed, engine-shared)

```
src/effects/
  FXBackend.ts                 // Layer 1 — stable backend interface
  backends/
    InstancedBillboardBackend.tsx  //   DEFAULT — instanced quads + vertex sim
    PointsBackend.tsx              //   legacy/tiny sparks
    ComputeBackend.tsx             //   future WebGPU/TSL
  EffectsRoot.tsx              // mounts active backends, routes emits by recipe
  EffectVolumeField.ts        // Layer 2 — gameplay-cloud index + sampleAt
  effectRecipes.ts            // Layer 3 — named presets (visual + backend + payload)
  budget.ts                   // global caps + significance culling
  types.ts                    // recipe/volume/backend/handle types
```

Mounted once in the Fortress shell near the flame renderer so every world gets it.

## Integration points

- **Burn system** (`useBurnSystem.ts`): each active burn creates one emitter
  (`fire-smoke`) dropping puffs at the burn's current world position each tick;
  `stop()` when the burn ends. Visual only, no volume. All Phase 1 needs.
- **Grenades / area weapons**: on explode, `emitBurst` for the poof +
  `EffectVolumeField.register` for a lingering gameplay cloud.
- **Player / NPC movement**: `sampleAt(pos)` on the move tick, apply effects.
- **Animations / props**: e.g. a flower's idle animation calls `createEmitter`
  with `glitter-steam`.

## Phasing

- **Phase 1 (now):** `InstancedBillboardBackend` (instanced quads + stateless
  vertex sim) + recipe system + `fire-smoke` + emit from burns + emit-side &
  per-puff culling + budget caps. Pure visual. No ½-res pass, no soft particles
  yet (capped size/count + trimmed quads carry mobile). Ships the smoke wanted
  today on a correct foundation.
- **Phase 2:** `EffectVolumeField` + `sampleAt` + ONE gameplay effect end-to-end
  (poison gas from a grenade). Optional ½-res particle buffer + soft particles if
  profiling shows overdraw bound.
- **Phase 3:** more recipes (steam, glitter, sleep, blind) + status consumers +
  faction/source/stage potency. Optional `ComputeBackend` (WebGPU/TSL) for
  collision-aware or 100k-scale clouds, behind the same interface.

---

## Sources / further reading

Unreal / massive-particle architecture:
- Epic — Scalability & Best Practices for Niagara:
  https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-and-best-practices-for-niagara
- More VFX Academy — Niagara Optimization Pt.2 (profiling, frame-time budgets):
  https://morevfxacademy.com/niagara-vfx-optimization-part-2-profiling-scalability-and-performance-tips/
- Epic forums — Fixed Bounds for GPU emitters:
  https://forums.unrealengine.com/t/what-does-fixed-bound-do-in-niagara-gpu-emitter-properties/676187
- realtimevfx.com — Improve Smoke Performance / Overdraw:
  https://realtimevfx.com/t/ue4-improve-smoke-performance-overdraw/874
- realtimecollisiondetection.net — Optimizing particle-system rendering (cutout/overdraw):
  https://realtimecollisiondetection.net/blog/?p=91

three.js / WebGL / WebGPU particle technique:
- Maxime Heckel — Field Guide to TSL and WebGPU:
  https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/
- utsubo — Migrate Three.js to WebGPU (2026) checklist:
  https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- keaukraine — Implementing Soft Particles in WebGL/OpenGL ES:
  https://dev.to/keaukraine/implementing-soft-particles-in-webgl-and-opengl-es-3l6e
- WebGLFundamentals — working around gl_PointSize limits:
  https://webglfundamentals.org/webgl/lessons/webgl-qna-working-around-gl_pointsize-limitations-webgl.html
- Geeks3D — Point sprites vs instanced billboards benchmark:
  https://www.geeks3d.com/20140929/test-particle-rendering-point-sprites-vs-geometry-instancing-based-billboards/
- npartas — Adaptive Offscreen (half-res) Particles:
  https://npartas.blogspot.com/2017/04/adaptive-offscreen-particles.html
- Codrops — Dreamy GPGPU particles with three.js:
  https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/
- Interplay of Light — Order-Independent Transparency pt.1:
  https://interplayoflight.wordpress.com/2022/06/25/order-independent-transparency-part-1/
