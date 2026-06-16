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

**Note for audit:** there's an existing `src/features/particles/` nebula effect
system + `nebulaEffectRegistry` capture pattern. DECISION NEEDED: reuse its
editor-param plumbing vs build fresh. Lean: new module owns the runtime; borrow
the panel/preview UX patterns, don't fork the renderer.

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

## Phase 5 — Realism + scale polish (as profiling demands)

- **Half-res particle render target + depth-aware upsample** (only if profiling
  shows overdraw-bound) — 4–16× fill-rate cut.
- **Soft particles** via the existing opaque-pass depth buffer (quality toggle).
- **Flipbook smoke** (sub-UV atlas) recipes for extra realism with few particles.
- **`ComputeBackend`** (WebGPU/TSL) for collision-aware / 100k clouds, behind the
  same `FXBackend` interface; core smoke stays stateless so the WebGL2 fallback is
  identical.

---

## Build/PR hygiene per phase

1. `git fetch` + rebase `claude1-recovery`; bump shared `src/version.ts`.
2. `npx tsc --noEmit` (catches missing imports — esbuild prod build won't) +
   `npm run build`.
3. Commit + push; state the new `vX.Y.Z` in chat.
4. DB phases: provide copy/paste SQL, user applies via dashboard, then regen
   `types.ts`. Engine ships with the hardcoded fallback so it never blocks on SQL.

## Open questions for the audit

1. **Triggers in a table vs in `ai_config` JSON** — runtime fetch/caching cost?
2. **Reconcile with `src/features/particles/` nebula system** — reuse or supersede?
3. **`game_id` typing** — definitions tables today look game-shared; confirm the
   `games` FK + `GAME_UUID` lookup path (`useCreatureRegistry` uses `games.slug`).
4. **RLS for creator-owned effects** — is `owner_id = auth.uid()` enough, or do we
   need a moderation/`is_public` gate before others can use a creator's effect?
5. **Item event hooks** — items don't have the same adapter attack hooks as
   creatures; where do `on_use`/`on_hit` fire for items?
6. **Bone anchor availability** — not every monster model has named bones; define
   the offset fallback contract.
