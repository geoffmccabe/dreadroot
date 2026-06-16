# Effects Module — Formal Phased Implementation Plan

> Companion to `EFFECTS_MODULE_SCOPE.md` (the audited architecture). This is the
> step-by-step build plan with concrete code, math, schema, and SQL. **DRAFT for
> audit** — we review this against the codebase + best practices before executing.
>
> End state: a universal, DB-backed, creator-authorable effects system. Creators
> open the Admin → Effects panel, design a smoke/steam/glitter variant (all the
> Layer-1 variables), save it to the database, then attach it to monsters/items
> they create, triggered by events ("on bite → emit toxic smoke, plus the bite").
> The fire-smoke we want now is simply the **first seeded variant** in that system.

---

## Guiding constraints (from repo memory + CLAUDE.md)

- **Shared Supabase:** DreadRoot + Pinkland + Siege Worlds share ONE database. New
  tables are additive (safe), but seed/RLS/columns affect all games. Scope per
  game with a nullable `game_id` (NULL = shared/global preset).
- **Resilient, no-DB-gating:** the engine must run with a **hardcoded fallback
  recipe** if the DB row is missing — never blank-screen waiting on a fetch.
- **Co-build:** another Claude owns gated `isSiege` edits on `claude1-recovery`.
  ONE shared `src/version.ts`; fetch-rebase-bump; `tsc --noEmit` + `npm run build`
  before every push.
- **SQL is applied by the user via the Supabase dashboard** (copy/paste blocks),
  then `types.ts` is regenerated. Never assume CLI migration.
- **No new UI without request** — the Effects panel IS requested, so it's in scope.

---

## Data model

Two new tables. Effects are **data**, triggers **bind** an effect to a source +
event. (Alternative considered: embed triggers inside each creature's existing
`ai_config: Json`. Rejected as the primary path — a dedicated table is queryable,
works for items too, and avoids bloating creature configs. We can still mirror a
denormalized copy into `ai_config` later if runtime fetch cost demands it.)

### `effect_definitions` — one row per authorable effect variant

```sql
-- copy/paste this into the Supabase SQL editor
create table public.effect_definitions (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,                       -- stable slug, e.g. 'fire-smoke'
  name         text not null,                       -- display name
  family       text not null default 'smoke',       -- smoke | steam | glitter | gas | spark | mist
  backend      text not null default 'billboard',   -- billboard | points | compute
  blend        text not null default 'alpha',        -- alpha | additive
  params       jsonb not null default '{}'::jsonb,   -- ALL Layer-1 visual variables (see shape below)
  gameplay     jsonb,                                -- NULL = visual only; else { kind, payload, radius, ... }
  game_id      uuid references public.games(id),     -- NULL = shared across games
  owner_id     uuid references auth.users(id),       -- NULL = built-in; else creator-owned
  is_builtin   boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index effect_definitions_code_game_uniq
  on public.effect_definitions (code, coalesce(game_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index effect_definitions_family_idx on public.effect_definitions (family);

alter table public.effect_definitions enable row level security;

-- Everyone can read active effects; only owners (or service role) write theirs.
create policy effect_defs_read on public.effect_definitions
  for select using (is_active);
create policy effect_defs_write_own on public.effect_definitions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
```

### `effect_triggers` — bind an effect to a creature/item + event

```sql
-- copy/paste this into the Supabase SQL editor
create table public.effect_triggers (
  id            uuid primary key default gen_random_uuid(),
  effect_id     uuid not null references public.effect_definitions(id) on delete cascade,
  target_kind   text not null,                       -- 'creature' | 'item'
  target_slug   text not null,                       -- creature slug ('shombie') or item key
  event         text not null,                       -- on_spawn | on_bite | on_hit | on_death | on_move | continuous
  anchor        jsonb not null default '{}'::jsonb,   -- { bone?, yOffset?, xOffset?, zOffset? } where it emits
  emit          jsonb not null default '{}'::jsonb,   -- per-binding overrides { count?, burst?, spawnRate? }
  game_id       uuid references public.games(id),     -- NULL = all games
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);

create index effect_triggers_target_idx on public.effect_triggers (target_kind, target_slug, event);
alter table public.effect_triggers enable row level security;
create policy effect_triggers_read on public.effect_triggers for select using (enabled);
```

### `params` JSONB shape (the Layer-1 vocabulary, all optional w/ engine defaults)

```jsonc
{
  "lifetime": 3.0,            // sec (persistence)
  "spawnRate": 5,            // puffs/sec for emitters
  "spread": 0.25,            // m initial scatter radius
  "size0": 0.4, "size1": 1.6, // start/end size (m) — smoke grows
  "opacity0": 0.55, "opacity1": 0.0,
  "rise": 0.9,               // m/s upward (becomes -gravity if you prefer)
  "gravity": 0.0,            // +sinks (heavy gas), -rises; rise is shorthand for -gravity
  "wind": [0, 0],            // x,z m/s global drift
  "flutterAmp": 0.35, "flutterFreq": 1.2,
  "spin": 0.6,               // rad/s per-particle rotation
  "color0": "#6b6b6b", "color1": "#9a9a9a",
  "sprite": "smoke_soft",    // atlas/sprite key; flipbook optional
  "flipbook": null,          // { cols, rows, fps } or null
  "cullDistance": 100, "fadeStart": 80, "fadeEnd": 100,
  "frustumCull": true,
  "softParticles": false,
  "importance": 0.3          // significance weight (0..1) for budget culling
}
```

### Seed the FIRST variant (`fire-smoke`) — the grey smoke for flaming enemies

```sql
-- copy/paste this into the Supabase SQL editor
insert into public.effect_definitions (code, name, family, backend, blend, params, gameplay, is_builtin, game_id)
values (
  'fire-smoke', 'Fire Smoke', 'smoke', 'billboard', 'alpha',
  '{
     "lifetime": 3.0, "spawnRate": 6, "spread": 0.18,
     "size0": 0.35, "size1": 1.5, "opacity0": 0.5, "opacity1": 0.0,
     "rise": 1.0, "gravity": 0.0, "wind": [0,0],
     "flutterAmp": 0.3, "flutterFreq": 1.1, "spin": 0.5,
     "color0": "#5e5e5e", "color1": "#9a9a9a",
     "sprite": "smoke_soft", "flipbook": null,
     "cullDistance": 100, "fadeStart": 80, "fadeEnd": 100,
     "frustumCull": true, "softParticles": false, "importance": 0.25
   }'::jsonb,
  null,           -- gameplay = NULL → purely visual
  true, null      -- built-in, shared across all games
);
```

After applying, regenerate types:
`npx supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts`
(or via dashboard) so `effect_definitions` / `effect_triggers` are typed.

---

## The math (one place, referenced by every phase)

### Stateless puff simulation (vertex shader)
Each puff stores **immutable** instanced attributes at spawn: `aBirth` (sec),
`aSeed` (vec3 random), `aSpawn` (vec3 world), and the recipe supplies uniforms.
The vertex shader computes everything live from one `uTime`:

```glsl
// per-instance attributes
attribute vec3  aSpawn;
attribute float aBirth;
attribute vec3  aSeed;     // stable randoms in [0,1)
attribute vec2  aCorner;   // base quad corner in [-0.5,0.5]

uniform float uTime;
uniform float uLifetime, uRise, uGravity, uSize0, uSize1, uSpin;
uniform float uFlutterAmp, uFlutterFreq, uSpread;
uniform vec2  uWind;
uniform vec3  uCamRight, uCamUp;   // billboard basis from the camera
varying float vLife;               // 0..1 normalized age (for fragment fade/flipbook)

void main() {
  float age = uTime - aBirth;
  float life = age / uLifetime;          // 0..1
  vLife = life;
  if (life < 0.0 || life > 1.0) {        // dead/unborn → collapse offscreen, ~free
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;
  }

  // Ballistic vertical motion: closed-form, no per-frame state.
  //   y(t) = rise*age - 0.5*gravity*age^2     (rise up, optional gravity pull)
  float y = uRise * age - 0.5 * uGravity * age * age;

  // Initial scatter + horizontal wind drift.
  vec2  scatter = (aSeed.xy - 0.5) * 2.0 * uSpread;
  vec2  drift   = uWind * age;

  // Flutter (turbulence) derived in-shader from the seed — nothing stored.
  float ph = aSeed.z * 6.2831853;
  float fx = sin(uFlutterFreq * age + ph)        * uFlutterAmp;
  float fz = cos(uFlutterFreq * age + ph * 1.7)  * uFlutterAmp;

  vec3 center = aSpawn + vec3(scatter.x + drift.x + fx, y, scatter.y + drift.y + fz);

  // Size grows over life; per-particle spin rotates the quad corner.
  float size = mix(uSize0, uSize1, life);
  float ang  = uSpin * age + ph;
  float cs = cos(ang), sn = sin(ang);
  vec2  rc  = vec2(aCorner.x * cs - aCorner.y * sn, aCorner.x * sn + aCorner.y * cs);

  // Camera-facing billboard (no gl_PointSize cap).
  vec3 worldPos = center + (uCamRight * rc.x + uCamUp * rc.y) * size;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
```

### Fragment fade (smooth in/out, optional flipbook + soft particles)
```glsl
varying float vLife;
uniform sampler2D uSprite;
uniform float uOpacity0, uOpacity1;
uniform vec3  uColor0, uColor1;
// fade-in over first 12%, fade-out over last 35%
float fadeIn  = smoothstep(0.0, 0.12, vLife);
float fadeOut = 1.0 - smoothstep(0.65, 1.0, vLife);
float alpha   = mix(uOpacity0, uOpacity1, vLife) * fadeIn * fadeOut;
vec3  col     = mix(uColor0, uColor1, vLife);
gl_FragColor  = vec4(col, alpha) * texture2D(uSprite, vUv);
// soft particles (Phase 5): alpha *= smoothstep(0.0, k, sceneDepthLin - fragDepthLin);
```

### Emitter spawn cadence (CPU, accumulator — no per-frame alloc)
```ts
// dt seconds since last frame; emitter at world pos `p`
acc += dt * spawnRate;            // spawnRate puffs/sec
while (acc >= 1) { acc -= 1; spawnPuff(p); }   // spawnPuff overwrites oldest ring slot
```

### Distance + frustum cull (per emitter, cheapest first)
```ts
const d2 = dx*dx + dz*dz;                       // squared, no sqrt
if (d2 > cullDistance*cullDistance) return;     // emit nothing
// frustum: reuse THREE.Frustum from camera each frame; test a padded sphere
if (frustumCull && !frustum.intersectsSphere(emitterSphere)) return;
```

### Significance score (budget eviction — evict lowest first)
```
S = importance * distanceFalloff * ageFalloff
distanceFalloff = clamp01(1 - (d - near) / (far - near))
ageFalloff      = 1 - life            // older puffs/emitters cheaper to drop
```

### Gameplay potency by persistence stage (Phase 4)
```
stage = age / lifetime                       // 0..1
shape(stage) = stage < 0.2 ? stage/0.2       // ramp up to peak
                           : 1 - (stage-0.2)/0.8   // linear decay to 0
potency = basePotency * shape(stage)         // poison dps, status strength, etc.
```

---

## Phase 1 — Visual engine + fire-smoke on burning enemies

**Goal:** burning enemies trail realistic grey smoke. Pure visual. Correct
foundation (instanced billboards + stateless sim). Works with a hardcoded
fallback recipe even if the DB row isn't present yet.

**Files (new):**
```
src/effects/
  types.ts                         // Recipe, Volume, FXBackend, handles
  FXBackend.ts                     // interface
  backends/InstancedBillboardBackend.tsx
  EffectsRoot.tsx                  // mounts backends, routes emits by recipe
  effectRecipes.ts                 // loads DB rows → recipes, + hardcoded FALLBACKS
  budget.ts                        // global caps + significance eviction
```

**Recipe loader with fallback (no DB gating):**
```ts
// effectRecipes.ts
import { FIRE_SMOKE_FALLBACK } from './fallbacks';
const cache = new Map<string, Recipe>([['fire-smoke', FIRE_SMOKE_FALLBACK]]);
export function getRecipe(code: string) { return cache.get(code) ?? FIRE_SMOKE_FALLBACK; }
export async function loadRecipesFromDB() {
  const { data } = await supabase.from('effect_definitions')
    .select('*').eq('is_active', true)
    .or(`game_id.is.null,game_id.eq.${GAME_UUID}`);
  for (const row of data ?? []) cache.set(row.code, rowToRecipe(row));
}
```

**Backend handle (the public emit API):**
```ts
export interface FXBackend {
  emitPuff(recipe: Recipe, p: THREE.Vector3, o?: Overrides): void;
  emitBurst(recipe: Recipe, p: THREE.Vector3, count: number, o?: Overrides): void;
  createEmitter(recipe: Recipe, getPos: (out: THREE.Vector3) => boolean): Emitter;
  update(camera: THREE.Camera, dt: number): void;   // bumps uTime, runs emitters, culls
  setQuality(q: 'low'|'med'|'high'): void;
  dispose(): void;
}
export interface Emitter { stop(): void; }
```

**Mount once** in the Fortress shell next to `UniversalFlameRenderer`
(`FortressScene.tsx`). Expose `effectsRef` via context (mirror
`AdminPanelContext.flameDemoRef`).

**Integration with burns** — `src/components/fortress/useBurnSystem.ts`. When a
burn entry is created, attach an emitter that follows the burn's resolved
position (we already resolve it every frame at lines ~532). When the burn ends
(`removeBurn`, line ~237), `emitter.stop()`:
```ts
// in BurnEntry: smokeEmitter?: Emitter
// on create (applyBurn), after entry is built:
entry.smokeEmitter = effects.createEmitter(getRecipe('fire-smoke'), (out) => {
  const p = getEntityPosition(entry); if (!p) return false;
  out.copy(p).add(entry.hitOffset ?? ZERO); return true;
});
// in removeBurn(): entry.smokeEmitter?.stop();
```
The emitter drops fire-and-forget puffs at the burn's current spot — a moving
NPC trails smoke automatically; the puffs never track the NPC.

**Budget/quality:** global ring buffer cap (start 3000 instances), emitter cap,
significance eviction; mobile defaults to `low` (smaller cap, no soft particles).

**Acceptance:** shoot an enemy → fire (unchanged) now trails grey smoke that
rises, flutters, fades over ~3 s, leaves a trail as it walks, and costs < ~1 ms.
FPS unchanged on the D-Flow panel. Works before any SQL is applied (fallback).

---

## Phase 2 — Effects Admin panel (author + save smoke variants)

**Goal:** Admin → Effects gets a "Smoke / VFX" mode where a creator tweaks every
variable with live preview and **saves a new `effect_definitions` row**.

**Files:**
- New: `src/components/AdminPanel.SmokeEffectsPanel.tsx` (mirror
  `AdminPanel.FlameEffectsPanel.tsx` structure: sliders/inputs + live preview +
  save).
- Edit (gated, additive): `AdminPanel.tsx` Effects tab (~line 378) to add the new
  sub-panel alongside `<FlameEffectsPanel/>`; `AdminPanelContext.tsx` to expose
  `effectsRef` for preview.

**Live preview:** the panel writes current slider values into a transient recipe
and calls `effects.emitPuff/createEmitter` at a fixed preview point in front of
the camera (same trick as `flameDemoRef`).

**Save (owner-scoped upsert, mirrors ShombieDesignPanel save):**
```ts
const save = async () => {
  const row = {
    code: slugify(name), name, family, backend: 'billboard', blend,
    params,                       // the full JSONB from the sliders
    gameplay: gameplayKind === 'none' ? null : { kind: gameplayKind, payload },
    game_id: scope === 'shared' ? null : GAME_UUID,
    owner_id: user.id, is_builtin: false, is_active: true,
  };
  const { error } = await supabase.from('effect_definitions')
    .upsert([row], { onConflict: 'code,game_id' });
  if (error) throw error; toast.success(`Saved effect "${name}"`);
  await loadRecipesFromDB();      // refresh the in-memory cache
};
```

**Acceptance:** create "Toxic Smoke" (green, slow rise, longer life), save it, see
it appear in the variant list, preview it live. Row exists in `effect_definitions`.

**Styling (see Audit E):** wrap the panel root in `className="admin-panel-dialog"`
and build it from `@/components/ui/*` (Card/Tabs/Slider/Input/Label/Button/Badge)
using semantic tokens ONLY (`bg-card`, `text-foreground`, `--primary`,
`--brand-accent-*`) — never a hardcoded hex for chrome. It then auto-themes per
game via `--hud-bg-h` (blue→pink→…) with zero panel edits, satisfying the
universal-engine per-game-CSS requirement. The smoke color pickers write hex into
recipe `params` — that's effect DATA, not theme, and is correct.

**Reconcile with nebula system (see Audit F):** new module owns the runtime;
reuse the existing `nebulaEffectRegistry`/`flameDemoRef` preview UX patterns,
don't fork its point renderer.

---

## Phase 3 — Trigger binding (attach effects to monsters/items by event)

**Goal:** a creator attaches a saved effect to a creature/item on an event. The
plant-monster example: bind `toxic-smoke` to creature `plantmonster`, event
`on_bite`, anchor `{ bone: 'jaw' }` → every bite emits a toxic puff from the
mouth, in addition to the bite damage.

**Authoring UI:** in each creature's DesignPanel (and an item editor), a small
"Effects" sub-section lists `effect_triggers` for that target and lets the
creator add `{ effect, event, anchor }`. Saves rows to `effect_triggers`.

**Runtime trigger registry (loaded once, indexed):**
```ts
// triggerRegistry: Map<`${kind}:${slug}:${event}`, TriggerBinding[]>
export function fireEvent(kind, slug, event, ctx: { pos, bone?, entity? }) {
  const list = triggerRegistry.get(`${kind}:${slug}:${event}`); if (!list) return;
  for (const t of list) {
    const recipe = getRecipe(t.effectCode);
    const p = resolveAnchor(ctx, t.anchor);            // bone world-pos or offset
    if (t.emit.burst) effects.emitBurst(recipe, p, t.emit.count ?? 12);
    else effects.emitPuff(recipe, p);
    if (recipe.gameplay) volumeField.register(recipe, p, ctx);  // Phase 4
  }
}
```

**Hook points (already mapped):**
- `on_bite` / `on_hit` — `src/features/enemies/ai/adapters/ShombieAdapter.ts`
  ~line 200, right after `applyAttackResultTo(...)` (the strike apex). Generic
  router: `src/features/enemies/ai/applyAttack.ts` ~line 92.
- `on_death` — adapter `applyDamage()` returns `true` (despawn).
- `on_spawn` — `use{Creature}System.ts` spawn fn, after instance creation.
- `on_move` / `continuous` — emitter created on spawn, stopped on death.

**Bone anchor resolution** reuses the bone-follower machinery already built for
burns (`createBurnFollower` in the adapters) to find the named bone's world
position at fire time.

**Acceptance:** the toxic-bite plant monster emits a green puff from its mouth
each bite (visual). No code edit per-creature — purely DB rows + the generic
`fireEvent` calls at the mapped hook points.

---

## Phase 4 — Gameplay volumes (make the smoke DO something)

**Goal:** `effect_definitions.gameplay` is honored. The toxic puff becomes a real
poison cloud entities can walk into.

**Files:** `src/effects/EffectVolumeField.ts` (continuous-sphere spatial index,
modeled on `spatialHashGrid.ts`), consumers in player/NPC movement.

- On a gameplay-recipe emit, register ONE coarse volume (center, radius, kind,
  payload, bornAt, lifetime, faction, sourceItemId).
- `sampleAt(pos)` on the player/NPC move tick → apply via the stage-potency
  formula above. Poison = DOT, sleep/blind/slow = status, lag = input jitter.
- Short-circuits to zero cost when the field is empty (the common case).

**Acceptance:** standing in the plant monster's toxic cloud ticks poison damage
that's stronger when the cloud is fresh and fades as it dissipates.

---

## Phase 5 — Realism + scale polish (staged backends, as profiling demands)

Drop-ins behind the 3-stage interface (Audit B); none touch game code:
- **shade → Six-way lighting flipbooks (top realism win).** 2 baked lightmap
  textures + flipbook, relit at runtime by scene lights (2 samples + 6 weighted
  adds, pure WebGL2, mobile-safe). Needs offline-baked assets (EmberGen/Houdini
  or CC0) — a content task. Makes smoke read as lit volume, not a flat decal.
- **shade → VAT/EmberGen flipbook pipeline** feeding the six-way shader (bake sim
  + lightmaps offline, KTX2/Basis compressed for mobile VRAM).
- **composite → WBOIT** (weighted-blended OIT, single-pass, mobile-OK) so many
  overlapping puffs blend without sort-popping; **MBOIT** as a desktop tier.
- **composite → half-res particle RT + depth-aware upsample** (only if profiling
  shows overdraw-bound) — 4–16× fill-rate cut.
- **shade → soft particles** via the existing opaque-pass depth buffer (toggle).
- **simulate → `ComputeBackend` (WebGPU/TSL + curl-noise advection)** for
  turbulent, collision-aware, 100k+ clouds; WebGL2 falls back to the stateless
  sim so the look degrades gracefully, never breaks.
- **simulate+shade → raymarched volumetric** as a DESKTOP-only localized hero
  backend (one explosion/chimney at half-res), never the default.

---

---

# AUDIT v2 — world models, future-proofing, GC/heap, flexibility, styling

This audit checks the plan against the actual code (both world models), current
graphics research, the FPS/GC budget, hard-coded-value flexibility, and the
styling/theming system. Findings are folded back into the phases above where
noted; cross-cutting findings are here.

## A. Works in BOTH world models (voxel + Siege Worlds) — CONFIRMED, one fix

The engine renders EITHER the voxel world (`CameraTrackedBlocks`) OR Siege
Worlds terrain (`SiegeWorldLayers`), chosen by `isSiege` in
`FortressScene.tsx` (~L257, swap at L1732). Everything the effects module needs
is mounted in the SHARED shell, not per-world:
- `UniversalFlameRenderer` (`FortressScene.tsx` ~L1766), `useBurnSystem` (~L1479),
  camera (`useThree`, ~L262), player controller, weapons — all shared.
- Siege enemies register with `EnemyCombatRegistry` via `siegeHorde.ts` (~L62), so
  **burns already work in Siege Worlds today**. The smoke emitter rides the same
  burn entries → works in both worlds with zero per-world code.
- Both worlds use identical continuous THREE world-space coords, so a world-space
  particle system is world-agnostic.

→ **EffectsRoot mounts once next to `UniversalFlameRenderer`. Phase 1 has ZERO
world-specific dependencies.** (De-risked.)

**The one real fix — ground height is world-specific, never hardcode `y=0`:**
- Siege: `sampleHeight(x,z)` from `src/components/siege/terrainHeight.ts` (~L25),
  bilinear over loaded tiles; passed to the frame loop as
  `groundHeightFn: isSiege ? sampleHeight : undefined` (`FortressScene.tsx` ~L1369).
- Voxel: no heightfield — ground is blocks in the spatial hash (`groundHeightFn`
  is `undefined`); height comes from a block lookup/raycast.

Phase-1 fire-smoke rises from the emitter point and needs NO ground height. Only
**ground-pooling gas / ground-contact fade** (Phase 4+) needs it. Resolution:
inject a nullable, world-agnostic provider into `EffectsRoot`:

```ts
// EffectsRoot prop, set once per active world (no hardcoded ground)
groundHeightAt?: (x: number, z: number) => number | null;
// Siege → sampleHeight; voxel → a spatial-hash top-solid lookup; null → effect
// simply skips ground-snap (rises/floats normally). A recipe flag `needsGround`
// guards it so most effects never call it.
```

## B. Future-proofing — split the backend into 3 swappable stages

Research verdict (2024–2026 state of the art) reshapes the backend interface.
Instead of one monolithic backend, `FXBackend` is internally three swappable
stages, so the cheap mobile path and future desktop/WebGPU path coexist behind
one interface with **no game-code changes**:

```
FXBackend = simulate → shade → composite
```

| Stage | Phase-1 (ship now, mobile) | Future backends (same interface) |
|-------|----------------------------|----------------------------------|
| **simulate** (where puffs are) | Stateless vertex-shader sim (closed-form rise+flutter, ~0 CPU) | **WebGPU TSL compute + curl-noise advection** (divergence-free turbulence, 100k+; WebGL2 falls back to stateless) |
| **shade** (how a puff looks) | Soft alpha sprite, color/opacity gradient | **Six-way lighting flipbooks** (AAA realism sweet-spot, pure WebGL2: 2 lightmap samples + 6 weighted adds → smoke that reacts to scene lights); VAT/EmberGen-baked flipbooks |
| **composite** (how puffs blend) | `additive` (order-independent, no sort) + `alpha` (`depthWrite:false`) | **WBOIT** (weighted-blended OIT, single-pass, mobile-OK) → **MBOIT** (desktop tier) for many overlapping puffs without sort-popping |

Verdicts that set the priorities (sources at the bottom of this doc):
- **Six-way lighting flipbooks — SHIP-NOW, #1 realism-per-ms.** Pure shader, no
  compute. The headline future realism upgrade (Phase 5). Needs offline-baked
  flipbook + 2 lightmap textures (EmberGen/Houdini, or CC0 assets) — a CONTENT
  dependency, not a code one. Design the `shade` stage for it now; supply assets
  later.
- **WebGPU TSL compute + curl-noise — SHIP-NOW on WebGPU, WebGL2 fallback.** The
  forward motion engine for turbulent, interactive, art-directable smoke. Keep
  core smoke stateless so the fallback is identical.
- **WBOIT — SHIP-NOW (mobile).** Bake the `composite` abstraction from day one;
  start additive/alpha, add WBOIT in Phase 5.
- **Raymarched volumetric / froxel — DESKTOP-ONLY / future**, localized hero
  effects only. Future `simulate+shade` backend, never the default.
- **Gaussian-splat / neural smoke — RESEARCH-ONLY.** No backend; watch-list (no
  authoring/dynamics path yet).

Net: Phase 1 ships stateless-vertex + soft-sprite + additive/alpha. Six-way
lighting, WBOIT, and WebGPU curl-noise are Phase-5 drop-ins behind the staged
interface — the module is future-proof without over-building now.

## C. FPS / GC / heap hardening (the top priority)

The D-Flow panel already flags GC pauses as a real FPS limiter, so the hot path
must be **allocation-free**. Mandatory rules, enforced in code review:

- **SOA `Float32Array`s** for every per-particle attribute, pre-allocated to max
  count ONCE; `InstancedBufferGeometry` + `InstancedBufferAttribute`. Spawn =
  advance a ring cursor and overwrite in place; upload only the dirty slice via
  `BufferAttribute.updateRanges` (never the whole buffer).
- **Zero per-frame allocation** in `emitPuff` / `update` / emitter ticks: no
  `new THREE.Vector3`, no array `.map/.filter/.flat`, no object literals, no
  template-string keys. Use module-level scratch vectors (same discipline as
  `numPosKey`/colliders) and numeric keys.
- **Pool emitters.** `createEmitter` returns a handle from a pre-allocated pool;
  `stop()` returns it to the pool. A burning NPC creates ONE emitter at ignite
  (not per frame); its `getPos` closure is created once, not per tick.
- **Parse once, reuse forever.** DB rows → recipes parsed once on load;
  `THREE.Color` objects and uniform structs built at recipe-load, never per puff.
  No JSON parse, no Supabase call, no string work on the hot path.
- **Stateless sim = almost no per-frame uploads** (attributes are write-once),
  so the per-frame CPU cost is one `uTime` uniform + emitter cadence math.
- **Hard caps as backstop:** global ring-buffer instance cap + emitter cap;
  significance eviction drops lowest-value first. No unbounded growth.
- **Verify on the D-Flow panel** each phase (MeshRebuilds, GC pauses, heap
  column) — ship behind the runtime-fallback rule, watch heap stays flat.

## D. Flexibility — no hard-coded values where they don't belong

Audit of literals in the draft → move to config/data:
- Per-effect values (lifetime, size, colors, rise, cull distance, importance…)
  are already **recipe `params` in the DB** ✓.
- **Engine-level constants must NOT be literals in code.** Introduce
  `src/effects/effectsEngineConfig.ts` — a single config object, **overridable
  per game** (keyed by `GAME_ID`): `maxInstances`, `maxEmitters`, quality-tier
  definitions (low/med/high caps + toggles), default `cullDistance/fadeStart/
  fadeEnd`, soft-particle depth constant `k`, sprite-atlas registry. Different
  games on the engine get different budgets/quality without code edits.
- **No hardcoded ground (`y=0`)** — pluggable `groundHeightAt` (finding A).
- **No hardcoded sprite paths** — sprites resolved through an atlas registry
  (data), so a new game can ship its own sprite set.
- **Fallback recipe is the seed mirror, not a magic literal** — generated from
  the same shape as the DB row so they can't drift.

## E. Panel styling + per-game theming — token-only, auto-themes per game

Confirmed stack: **Tailwind + shadcn/ui**, HSL design tokens in
`src/index.css`, admin panels scoped by `.admin-panel-dialog` (L581) which
re-maps shadcn tokens onto the HUD tokens. Crucially, `--hud-bg-h` (L110) is
documented as *"the ONLY value that changes per game (blue→pink)."*

→ **The SmokeEffectsPanel must render inside `.admin-panel-dialog` and use
ONLY shadcn components + semantic tokens — never a hardcoded hex for chrome.**
Then it auto-themes per game (DreadRoot blue, Pinkland pink, Siege Worlds its
own hue) the instant that game sets `--hud-bg-h`, with zero panel edits. This is
exactly the "universal engine, per-game CSS" requirement.

Concrete rules for the panel:
- Components from `@/components/ui/*`: `Card`, `Tabs`, `Slider`, `Input`,
  `Label`, `Button`, `Badge` — same set `AdminPanel.FlameEffectsPanel.tsx` uses.
- Colors via tokens only: `bg-card`, `text-foreground`, `border-border`,
  `text-muted-foreground`, `--primary`, `--brand-accent-*`, `--rarity-*`. No
  literal `#hex`/`rgb()` in the panel chrome.
- Spacing/typography via tokens (`--hud-font-*`, `--spacing-*`, `--radius`).
- Wrap the panel root in `className="admin-panel-dialog"` so the frosted-glass
  HUD scope + slider/button contrast overrides apply (L614–650).
- **Effect colors are DATA, not theme:** the smoke color pickers write hex into
  recipe `params` (a grey/green smoke is the same in every game). That's correct
  and separate from UI theming. Per-game *effect* variation comes from `game_id`
  on `effect_definitions`, not from the theme tokens.
- **Future-proofing the theme system:** today per-game hue is a single token set
  in `:root`. Recommend (small, separate task) a `data-game="<slug>"` attribute
  on the app root with per-game `--hud-bg-h` overrides, so multiple games' themes
  can coexist in one build. The panel needs no change when that lands — it's
  already token-only.

## F. Reconcile with the existing `src/features/particles/` nebula system

There IS a prior particle/nebula system (`nebulaEffectRegistry`, editor params,
captured in `FlameEffectsPanel`). DECISION: the new `src/effects/` module owns
the **runtime** (instanced billboards + staged backends) — the nebula system is
point-based and purpose-built for captured nebula looks, not creator smoke.
**Reuse its panel/preview UX patterns** (slider plumbing, live capture-to-preview
via `flameDemoRef`); do NOT fork its renderer. Revisit folding nebula effects
into the universal module as a later backend once the new module is proven.

---

## Build/PR hygiene per phase

1. `git fetch` + rebase `claude1-recovery`; bump shared `src/version.ts`.
2. `npx tsc --noEmit` (catches missing imports — esbuild prod build won't) +
   `npm run build`.
3. Commit + push; state the new `vX.Y.Z` in chat.
4. DB phases: provide copy/paste SQL, user applies via dashboard, then regen
   `types.ts`. Engine ships with the hardcoded fallback so it never blocks on SQL.

## Audit resolutions & remaining questions

**Resolved by Audit v2:**
- ✅ Works in both world models (shared shell, shared burns) — Phase 1 is
  world-agnostic. Ground height is the only world-specific bit → pluggable
  `groundHeightAt` provider, used only by ground-pooling effects (Phase 4+).
- ✅ Future-proofing → 3-stage swappable backend (simulate/shade/composite);
  six-way lighting + WBOIT + WebGPU curl-noise are Phase-5 drop-ins.
- ✅ GC/heap → SOA + ring buffer + pooled emitters + parse-once + zero per-frame
  alloc; verified on D-Flow each phase.
- ✅ Flexibility → engine constants move to per-game `effectsEngineConfig`; no
  hardcoded ground, sprite paths, or caps.
- ✅ Panel styling → `.admin-panel-dialog` + shadcn + semantic tokens only →
  auto-themes per game via `--hud-bg-h`.
- ✅ Nebula reconcile → new module owns runtime, reuse nebula panel/preview UX.

**Still open (decide before/early in execution):**
1. **Triggers in a table vs `ai_config` JSON** — table is the plan; confirm the
   per-frame trigger lookup is cached (Map built once on load), not re-fetched.
2. **`game_id` typing** — definitions tables today look game-shared; confirm the
   `games` FK + `GAME_UUID` lookup path (`useCreatureRegistry` uses `games.slug`).
3. **RLS for creator-owned effects** — is `owner_id = auth.uid()` enough, or do we
   need a moderation / `is_public` gate before others reuse a creator's effect?
4. **Item event hooks** — items lack the creature attack hooks; where do
   `on_use`/`on_hit` fire for items? (May need an item-event emitter.)
5. **Bone anchor availability** — not every model has named bones; define the
   offset fallback contract (reuse `createBurnFollower`'s nearest-bone pick).
6. **Per-game theme wiring** — small separate task: `data-game` attribute + per-
   game `--hud-bg-h` overrides so multiple games' themes coexist in one build.
7. **Six-way lighting assets** — content dependency (EmberGen/Houdini or CC0
   flipbook + lightmaps); confirm an asset source before scheduling that Phase-5
   item.

---

## Audit v2 sources (cutting-edge smoke technique)

- Unity — Six-Way Lighting in VFX Graph (the AAA lit-smoke standard):
  https://docs.unity3d.com/Packages/com.unity.visualeffectgraph@17.2/manual/six-way-lighting.html
- Unity blog — Realistic smoke with 6-way lighting:
  https://unity.com/blog/engine-platform/realistic-smoke-with-6-way-lighting-in-vfx-graph
- O3DE — Six-point lighting tutorial:
  https://docs.o3de.org/docs/learning-guide/tutorials/rendering/six-point-lighting-tutorial/
- SideFX — Vertex Animation Textures 3.0:
  https://www.sidefx.com/docs/houdini/nodes/out/labs--vertex_animation_textures-3.0.html
- three.js forum — Houdini VAT 3.0 for WGSL/WebGPU:
  https://discourse.threejs.org/t/houdini-vertex-animation-textures-vat-3-0-for-wgsl/92245
- Maxime Heckel — Real-time volumetric raymarching in three.js (desktop verdict):
  https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/
- Codrops — WebGPU/TSL compute particles (Jan 2026):
  https://tympanus.net/codrops/2026/01/28/webgpu-gommage-effect-dissolving-msdf-text-into-dust-and-petals-with-three-js-tsl/
- nibi — TSL compute-shader GPU particle engine: https://github.com/monoton-music/nibi
- Interplay of Light — OIT endgame (WBOIT / MBOIT):
  https://interplayoflight.wordpress.com/2022/07/10/order-independent-transparency-endgame/
- 3D Gaussian Splatting (INRIA 2023, research watch-list):
  https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/
