# Crawlie Senses + Pathfinding Plan (SWW)

Reusable surface-crawling locomotion + a creature "senses" system (sight / sound / smell),
with per-character and per-monster scores, gated pathfinding, and a body-rotating "hop".

Status: PLAN ONLY (no code written yet). Repo: `dreadroot-sww`.

---

## 0. Where we are today (verified in code)

**Crawlie = monster type 18**, component-driven (not CFG-driven like types 1–17/19).
- Identity / model: `src/components/siege/siegeMonsterCatalog.tsx:134,148-149`, model `skeletonflesh_crawl.glb`.
- Surface walker: `src/components/siege/CrawlerMonster.tsx` (self-contained, ~344 lines).
  - `castSurface()` (63–111): ray vs BVH world mesh + monster boxes + peer crawler boxes → nearest hit + normal.
  - `projTangent()` (226–232): player pos projected onto current surface plane → heading tangent toward player.
  - Wall detect / transition (237–245), sticky-snap to surface (252–286), convex-edge wrap (260–276).
  - Orient body to surface via quaternion basis (318–331). Yaw set each frame from tangent (312).
  - Existing recovery: ±70° detour after ~1s jam (217–225); orbit-break drop after 2.5s no-progress on STEEP surface (324–332); flip-flop reset (310–316).
- No A* for Crawlie (pure raycast seek). Other monsters use grid A* in `siegePathfinding.ts`.

**Config / admin plumbing (reuse this):**
- Code defaults: `CFG[type]` in `siegeMonsterCatalog.tsx`; merged with admin overrides via `effectiveCfg(type)`.
- Overrides stored in Supabase `sw_monster_overrides` (+ IndexedDB cache) via `monsterStats.ts`.
- Admin NPC editor: `SwEnemiesPanel.tsx` (Admin → NPC → "Enemies SW"). Component types (6/9/18) currently show read-only stats — name+tags only.

**Sensory today = almost nothing:**
- Aggro = plain distance check `dist < c.aggro` (default 400 m) at `MonsterEnemy.tsx:1178`.
- Partial LOS raycast only to *block melee* through walls (`MonsterEnemy.tsx:692-709`). No vision cone, no hearing, no smell.

**The spinning bug — likely root cause:**
When the player lies nearly along the crawler's current surface normal (e.g. crawler on a near-vertical
wall, player out away from the wall), the goal-projected tangent (226–232) shrinks toward zero and its
*direction* becomes numerically unstable. Yaw is then re-set every frame from that unstable tangent (312),
so the body whips around (visual spin) while net translation cancels to ~0. The existing orbit-break only
fires on STEEP surfaces after 2.5s and only when distance-to-player isn't shrinking, so an in-place spin on
a moderate surface never trips it. Wall-detect toggling (237–245) flipping the surface normal back and forth
can compound it.

---

## 1. Research basis (how shipped FPS games solve "senses + AI")

- **Thief: The Dark Project** — the canonical model: multiple stacked **viewcones** per AI (angle/length/acuity),
  LOS raycast confirmation, sound propagation with attenuation, and a single **awareness value** per AI→target
  that **rises fast, decays slowly** through discrete states. Visibility of a target = lighting + movement +
  exposure. Fully data-driven/tunable per AI type. → exactly the per-creature-score system requested.
- **F.E.A.R.** — separate eye/ear/nose sensors feeding cached world-knowledge; GOAP picks actions. Lesson:
  keep *sensing* separate from *acting*.
- **Alien: Isolation** — 4 nested vision cones (focused/normal/peripheral/close); discrete **SoundEvent**
  objects (footsteps, gunfire, flashlight, tracker) the AI queries; light/smoke obscure vision. Camo/standing-still
  reduces detection. → our camo + stealth + sound-event model.
- **Surface crawling (insect-on-walls)** — raycast trio (ahead / below / cliff) reads surface normals; align body
  to normal; the well-known failure is **snapping/"jink"** on transitions — fix is hysteresis + slerp, and a **hop**
  is the clean way to cross a >60° normal change instead of snapping.

Key architectural takeaway: **sense → awareness → decide → path**. Pathfinding runs *only* when awareness is high
enough, evaluated at a few Hz, not every frame. This is lighter AND more believable.

---

## 2. Target architecture (north star)

Three small, reusable modules, each its own file (keep CrawlerMonster/MonsterEnemy thin):

1. **`surfaceLocomotion.ts`** — extract Crawlie's surface-walk core into a config-driven module
   (`castSurface`, `projTangent`, stick-snap, orient, **hop**). Any creature = a config + model + this module.
2. **`perception.ts`** — per-monster `PerceptionState` + `senseTarget(monster, target, world)` →
   `{ awareness, state, lastKnownPos }`. Sight + hearing + smell sensors feed one awareness accumulator.
3. **`soundEvents.ts`** — a tiny global bus: player actions push `SoundEvent { pos, loudness, t }`; monsters query it.

Data model (all tunable in admin, stored where existing config already lives):

- **Per-character (player) scores** — 6 character models each get: `camo` (visual concealment, only helps when
  still), `stealth` (quietness; reduces sound emission), `scent` (smell strength). Dynamic inputs layered on top:
  movement speed, weapon fire, landing/glide impact, light level at player.
- **Per-monster (NPC) sensor scores** — `sight` (acuity + range + FOV cone(s)), `hearing` (acuity + range),
  `smell` (acuity + range). Stored in `sw_monster_overrides` (same path as existing stats).
- **Per-world** — a `wind` direction vector → "downwind" test; (optional) ambient light level.

Awareness accumulator (the "if-then layer" you described):
```
each sense tick (~4 Hz):
  sight  = inRangeAndCone && LOS ? distanceFalloff * lightFactor * moveFactor * (1 - camoIfStill) : 0
  smell  = downwind(±30°) && inSmellRange ? scent / smellAcuity * distanceFalloff : 0   // ignores walls
  hear   = nearestSoundEvent within hearRange ? loudness * (1 - stealth) / hearAcuity : 0
  raise awareness fast toward max(sight,smell,hear); else decay slowly
  state: Unaware → Suspicious(go to lastKnownPos) → Alert(pursue)
gate: run pathfinding/seek ONLY when state >= Alert (else wander or investigate)
```

This replaces the naive `dist < aggro` at `MonsterEnemy.tsx:1178` and the Crawlie's always-on seek.

---

## 3. Phased build

### Phase 1 — Fix the spin (Crawlie only; no UI, no DB) ← do first
Pure edit to `CrawlerMonster.tsx`. Quick win, low risk, independently shippable.
1. **Heading deadzone:** if the pre-normalized goal-tangent magnitude is below a threshold (player nearly along
   the surface normal), HOLD current heading instead of chasing a degenerate direction.
2. **Turn-rate clamp / slerp:** cap yaw change per frame instead of instantly setting yaw from tangent — kills the
   visual spin and the transition "snap".
3. **True-progress watchdog:** track actual world-space displacement over a ~0.6s window (not "is moving" / "is
   distance shrinking"). If translation/sec < epsilon → trigger recovery on ANY surface, not just steep ones.
   This is what actually catches in-place spin.
4. Recovery escalates: heading kick → (Phase 2) hop → drop to ground.
- *Confidence this fixes the reported spin: ~70%.* The degenerate-tangent + per-frame-yaw is the most likely
  cause, but I can't see it in-game; the watchdog is a safety net that catches whatever the exact trigger is.

### Phase 2 — Reusable locomotion + Hop (Crawlie + future creatures; no UI/DB)
1. Extract surface-walk core from `CrawlerMonster.tsx` into `surfaceLocomotion.ts` (config-driven). Crawlie becomes
   a thin wrapper passing its config. Verified no behavior change before adding features.
2. **Hop:** when a transition needs a normal change > 60° (dot < 0.5), enter a HOP state — ballistic arc (reuse
   `GRAV`) from launch to the landing point on the new surface, **slerp body orientation old→new normal during
   airtime** so it rotates to match the new plane mid-air, then resume crawl. Config: `hopEnabled`, `hopMinAngle`,
   `hopHeight`, `hopSpeed` — per-creature, so some crawl-snap and some hop.
3. Result: "easily apply to other creatures" = new config + model reusing `surfaceLocomotion.ts`.

### Phase 3 — Perception core: SIGHT + awareness gating (touches both monster paths)
1. New `perception.ts`: `PerceptionState` per monster + `senseTarget()` returning awareness/state/lastKnownPos.
2. Sight sensor: vision cone(s) (range + FOV) + reuse/extend the existing LOS raycast (`MonsterEnemy.tsx:692-709`)
   + distance falloff + light + player-movement + **camo-when-still**.
3. Gate: replace `dist < aggro` (MonsterEnemy.tsx:1178) and Crawlie's always-seek with `state >= Alert`. Evaluate
   senses at ~4 Hz; pathfind only when alerted → **net CPU win** even though it adds logic.
4. Per-monster sight scores read from config (code default + `sw_monster_overrides`); per-character camo read from
   character config (see Phase 6 / open question on character config location).

### Phase 4 — HEARING (SoundEvent bus)
1. New `soundEvents.ts` global ring-buffer. Player pushes events: footstep cadence while moving, weapon fire (loud),
   landing after jump/glide (loud), all scaled by the player's `stealth` score.
2. Hearing sensor in `perception.ts`: nearest recent event within `hearRange` raises awareness → sets lastKnownPos.
   Hearing works without LOS. Decays.

### Phase 5 — SMELL + wind/downwind
1. Per-world `wind` vector (default + admin-set). `downwind(monster, player)` = player within ±30° solid angle on
   the upwind line from the monster AND within `smellRange`.
2. Smell sensor: scent strength (`scent` / monster `smellAcuity`) × distance falloff, **ignores walls**. Raises
   awareness + lastKnownPos. This is the "they smell you through a wall but can't see you" channel.

### Phase 6 — Admin + tuning + debug (NEEDS YOUR OK — UI)
Per your rule (never add UI uninvited) this phase is proposal-only until you approve each piece:
1. NPC panel: unlock sensor fields for component monsters in `SwEnemiesPanel.tsx` (sight/hearing/smell ranges +
   acuity + hop flags). Stored in `sw_monster_overrides` — same path as today.
2. **Character scores panel:** the 6 characters need camo/stealth/scent fields. Likely a NEW table + a NEW admin
   tab — I'll propose the exact wiring and wait for go (this is the main "new UI + new DB" piece).
3. Debug overlay: floating awareness-state / camo labels above monsters (styled with the game's panel theme, not
   inline) for live tuning. Off by default behind the work-mode key.

### Phase 7 — Rollout + validation
1. Apply `surfaceLocomotion.ts` + hop to at least one other creature to prove reuse.
2. Apply `perception.ts` to the CFG monsters (replace their distance aggro) and confirm the perf win in D-Flow.
3. Tune scores per character/monster; verify camo "walk-past", downwind smell, and sound-event reactions feel right.

---

## 4. Risks / things to confirm
- **Where the 6 characters' config lives** is not yet mapped — Phase 6 char-scores table depends on it. Resolve before Phase 3 needs camo, or stub camo as a constant until then.
- **Shared Supabase** — new columns/tables may touch other games (DreadRoot/Pinkland). Confirm which DB `dreadroot-sww` uses before any schema change; port client reads before flipping shared server.
- **No UI without explicit approval** (Phase 6). Phases 1–5 are code-only and need no panels to function (use code defaults first).
- Phase 1 confidence ~70% (can't observe in-game); Phases 2–5 are additive and independently testable.

## 5. Recommended order
1 (spin fix) → 2 (locomotion+hop) → 3 (sight gate) → 4 (hearing) → 5 (smell/wind) → 6 (admin, on approval) → 7 (rollout).
Phase 1 ships on its own immediately.
