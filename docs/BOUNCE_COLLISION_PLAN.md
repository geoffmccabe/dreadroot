# Bounce / Ricochet Collision Plan

**Status:** Approved design, not yet built. Audited against AAA-FPS practice and our actual stack
(`three-mesh-bvh` + voxel AABB). This doc is the committed plan to follow.

**Origin:** The Rocket Belt lets the player reach 40 m/s (10× walk). Our movement is applied
*discretely* — each frame computes one `deltaMovement`, tests only the **destination** position,
and reverts if blocked. It never checks the path between old and new position. So a single fast
frame (~1.3 m at 30 fps) can skip a thin wall entirely and land the player inside a building,
where the push-out logic (nearest-face) then shoves them *deeper*. The fix generalises to anything
fast: knockback, dashes, blasts.

---

## 1. Root cause (verified in code)

| System | File(s) | How it moves | Collision |
|---|---|---|---|
| Player walk/sprint/**belt** | `FortressControls.tsx` (~2483–3020), `FortressCollision.ts` | discrete `deltaMovement`, `moveDt = min(delta, 1/30)` | axis-by-axis AABB, **test final pos only**, revert on hit |
| Player mesh (buildings/rocks) | `meshColliderSystem.ts` `resolvePlayerMeshCollision` | per-frame shapecast | BVH shapecast, push-out along contact normal (already computes the normal) |
| Monster knockback | `siegeHorde.ts`, `MonsterEnemy.tsx` (~1019–1029) | `kvx/kvz` impulse, discrete | discrete-then-revert: can't penetrate, but **dead-stops** at a wall (+ slam damage) |
| Player knockback | `FortressControls.tsx` `applyKnockback` (~393–414) | impulse, capped 42 m/s, decays 0.2 s | runs through the normal collision loop |
| Grenade | `grenadePhysics.ts` `stepGrenadePhysics` | swept sphere (0.25 m), gravity | per-axis voxel bounce + cylinder reflection, restitution 0.4, rolls/settles |
| Bullets | `bulletPhysics.ts`, `ricochet.ts`, `useFortressFrameLoop.ts` | travelling projectile (not hitscan) | ray-vs-AABB (voxels) / ray-vs-cylinder (enemies); ricochet via `reflect()`; **voxel normal faked** by `calculateHitNormal` (dominant axis) |

Two latent issues fall out of the audit:

- **Bullets very likely do NOT ricochet correctly off Siege mesh buildings** — they only test
  voxel AABBs and fake an axis-aligned normal; mesh buildings are triangle geometry.
- **Monster knockback dead-stops at walls** instead of sliding/bouncing.

---

## 2. The realisation

The bounce **math is already the same everywhere** (and copy-pasted in three places). What actually
differs between bullet / grenade / player / monster is only:

1. **The swept shape** — ray (bullet), small sphere (grenade), capsule (player), cylinder (monster).
2. **Where the surface normal comes from** — faked axis (bullet voxel), velocity-axis flip
   (grenade), radial (cylinder), or the *true* triangle normal (mesh).
3. **What you do with the hit** — ricochet+decay, bounce+settle+explode, bounce 1/3, stop+slam.

So the right shape is **two shared modules + a thin per-mover policy** — not one god-module
(over-engineering, regresses tuned feel) and not N silos (today's state, inconsistent normals).

---

## 3. Audit findings (the part that changes the design)

### 3a. We do NOT have analytic swept/TOI — and that's fine
`three-mesh-bvh` gives us **shapecast** (static capsule-vs-triangles overlap, broad+narrow phase),
not a convex-sweep time-of-impact solver. Every serious R3F controller on this library
(gkjohnson's demo, BVHEcctrl) does the same thing: **substep the move and shapecast each step.**
The step where the capsule first overlaps yields the contact point + normal (already computed by
`resolvePlayerMeshCollision`). Bounce angle is accurate to the step size (~0.3 m) — visually
indistinguishable from a true sweep. **In practice "swept" and "substepped" converge into one
technique.**

### 3b. The cost is CPU/main-thread, not GPU
All of this is BVH queries + vector math on the main thread. The T-pose flash is the only
animation-touching piece and is negligible (skinning already runs; we reset a few in-memory
skeletons for ~0.3 s). The real risk is running expensive shapecasts on too many entities per
frame — prevented by design (§3c).

### 3c. AAA discipline: CCD only for fast objects (this is what keeps FPS safe)
- **Speed-gated:** swept resolution runs only for an entity moving faster than
  `CCD_SPEED_GATE` (~0.4 m/frame) — the boosting player, or a monster *during* its knockback
  window. A 1000-monster horde walking around does **zero** swept queries; they keep today's cheap
  discrete-revert path. Only the few dozen flung by a blast (>6 m/s) get swept collision, for the
  ~0.5–1.3 s their knockback lasts.
- **Capped substeps:** `steps = ceil(distance / CCD_MAX_STEP)`, hard cap `CCD_MAX_SUBSTEPS = 8`.
  Worst case (40 m/s @ 33 ms = 1.3 m) ≈ 5 shapecasts that frame, only while boosting. Player
  already does 1 shapecast/frame today.
- **Graceful degradation:** hook the existing `frameLoop` / `budgetedWork` (2 ms/frame) budget.
  If a blast flings 40 monsters in one frame and swept work would exceed budget, the overflow
  falls back to today's discrete-revert behaviour — never a stall. Worst case = today's behaviour.
- **Bounce recursion capped** at `BOUNCE_MAX_PLANES = 3` (Quake's rule) so a corner-wedged entity
  can't loop infinitely.

Worst realistic frame = "grenade lands in a crowd" → a few dozen entities each doing ≤8
broad-phase-culled shapecasts for under a second, under a hard budget ceiling. Self-limiting and
well inside an AAA frame budget.

---

## 4. Architecture

```
                       ┌─────────────────────────────┐
   movement / impulse  │  Module B: sweepAndResolve   │   uses existing:
   (any source) ─────► │  (shape, from, to) →         │   • BVH shapecast (mesh)
                       │  {stoppedAt, normal, frac}   │   • axis-AABB / voxel DDA
                       │  speed-gated + substepped     │
                       └──────────────┬──────────────┘
                                      │ emits
                                      ▼
                          bounce event {entity, impactSpeed, normal}
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                        ▼
   Module A (math kernel)     per-mover POLICY          Impact-Pose controller
   reflect() / slide() /      • player: bounce 1/3      triggerImpactPose(speed)
   restitution()              • monster: bounce/slide   + update(dt)  (Phase 3)
   (pure fns, no state)       • grenade: settle+explode (reusable: monsters now,
                              • bullet: ricochet+decay   characters later)
```

### Module A — Collision-response math kernel (pure functions, no state)
- Home: promote `src/features/combat/ricochet.ts` (already has `reflect(dir, n) = D − 2(D·N)N`).
- Add `slide(v, n)` (cancel only the into-surface component → skim along wall) and a restitution
  helper.
- Migrate the grenade stepper and bullet frame-loop to import `reflect()` here; delete their
  inlined copies.
- **One reflection model for the whole engine.** Choice of bounce vs slide is one line at the
  call site, using the same normal.

### Module B — Swept query (generalises two systems that already work)
- `sweepAndResolve(shape, from, to)` → `{ stoppedAt, normal, fractionRemaining, blocked }`.
- `shape` ∈ {ray, sphere, capsule, cylinder}; dispatches to the **existing** BVH shapecast
  (`resolvePlayerMeshCollision`) for mesh and the **existing** axis-AABB / `voxelTrace.raycastVoxels`
  for blocks.
- Adds only: the substep loop, the speed gate, and a uniform hit record. **Not a new collision
  engine** — a uniform face over production code.

### Bounce event
- Tiny emitter carrying `{ entity, impactSpeed, normal }`. Monster hit-hooks already exist
  (`siegeHorde` `applyDamage`, the `MonsterEnemy` knockback block). Physics stays ignorant of
  animation/gameplay — consumers subscribe.

### Per-mover policy (stays separate — this is the right seam, not debt)
- **Player belt:** reflect leftover travel across the normal, scale by `BOUNCE_DAMP` (1/3),
  re-sweep the bounce segment, cap at `BOUNCE_MAX_PLANES`.
- **Monster knockback:** bounce or slide off walls (replaces dead-stop) while above the gate;
  keep existing slam-impact damage.
- **Grenade:** unchanged behaviour, now calling Module A.
- **Bullet:** unchanged behaviour, now calling Module A; later reads true mesh normals (Phase 4).

---

## 5. Impact-Pose Controller (comedic T-pose flash) — Phase 3

**Goal (Geoff):** when a player or monster hits something with pre-impact speed **> 6 m/s**, snap
them to a momentary T-pose at the instant of contact, then transition back to whatever pose they
were in *during* the bounce. Comical. Monsters now; reusable for visible characters later.

**Why it's nearly free in our code:** each monster has its **own** `AnimationMixer` + **own** cloned
skeleton (`MonsterEnemy.tsx` — `SkeletonUtils.clone`), and the current clip is tracked in a `cur`
ref. So we **never change which clip plays** — we only suppress then restore its *influence*:

1. On a hard impact, set `tposeUntil = now + ~0.3 s` and snap the rig to **bind pose** (Synty rigs
   bind ≈ T-pose, so the bind pose *is* the gag — no new animation art).
2. During the bounce, ramp the playing clip's weight 0→1 over the window, so it eases out of the
   T-pose straight back into idle/walk/run/attack. Because the clip never changed, "return to the
   previous pose" is automatic.
3. Gate clip switches during the window (exactly like the existing `stunned` branch at
   `MonsterEnemy.tsx:1037`); the flash check goes **first**, ahead of the hit/stun reaction.

Each monster has its own skeleton, so a bounced cluster T-poses **independently** at slightly
different instants — exactly the intended comedy. Re-impact re-arms the timer.

**Two ways to produce the pose:**
- **Procedural (recommended):** force the skeleton to bind pose and ramp the clip weight back up.
  Zero art, works on every rig. Precedent exists: headshots already apply a procedural spine-bone
  lean *on top* of animation, proving per-frame bone overrides survive to render.
- **Authored clip (fallback):** play a dedicated `tpose` one-shot; needs the clip added to every
  model.

**Reusable for characters later, no rework:** monsters (`MonsterEnemy`) and the character renderers
(`SiegeCharacter` / `SiegeCharacterPair`) all use the identical drei `useAnimations` +
fadeOut/fadeIn + `cur` ref + `play()` pattern. So the controller is a standalone helper —
`triggerImpactPose(speed)` + per-frame `update(dt)` taking (mixer, actions, currentActionRef).
Monsters wire it now; visible characters mount the same helper later by subscribing to the same
bounce event. (First-person player has no visible body → no-op for self; this is for
third-person/other visible characters.)

---

## 6. Tuning constants (data, never hardcoded in hot paths)

| Constant | Value | Purpose |
|---|---|---|
| `CCD_SPEED_GATE` | ~0.4 m/frame | below → cheap discrete path (no swept work) |
| `CCD_MAX_STEP` | ~0.3 m | substep length (also bounce-angle granularity) |
| `CCD_MAX_SUBSTEPS` | 8 | hard cap per entity per frame |
| `BOUNCE_MAX_PLANES` | 3 | re-bounce recursion cap (anti corner-loop) |
| `BOUNCE_DAMP` | 1/3 | player belt leftover-travel scale; per-surface restitution otherwise |
| `POSE_FLASH_MIN_SPEED` | 6 m/s | T-pose trigger threshold |
| `POSE_FLASH_HOLD` | 0.05–0.1 s | fully T-posed at instant of impact |
| `POSE_FLASH_BLEND` | 0.25–0.4 s | ease back (or tie to bounce flight time) |

---

## 7. Build order (each phase ships + is FPS-measured before the next)

- **Phase 0 — Module A (math kernel).** Promote `ricochet.ts`; add `slide` + restitution; migrate
  grenade + bullet to import `reflect()`. *Trivial risk.* Confirm bullets/grenades behave
  identically.
- **Phase 1 — Module B + player belt bounce.** Build `sweepAndResolve` over existing shapecast +
  voxel AABB; wire into the player movement apply site, gated on per-frame displacement so normal
  walking is byte-for-byte unchanged. Apply the 1/3 bounce + re-sweep + 3-plane cap. **Fixes the
  Rocket-Belt tunnelling.** **Measure FPS** (existing harness: median-of-3, tab closed) while
  boosting into walls — gate before touching monsters.
- **Phase 2 — Monster knockback bounce (speed-gated).** Replace dead-stop with `sweepAndResolve`
  only while knockback speed > gate; below it, today's exact path. Keep slam damage. **Measure FPS**
  with a worst-case blast in a 100+ horde; confirm budget fallback never stalls.
- **Phase 3 — T-pose impact flash.** Standalone `triggerImpactPose`/`update` helper; mount on
  monsters; wired to the bounce event for character reuse later. **Validate the one unknown first**
  (§8.1) on a single test monster before rollout.
- **Phase 4 (optional, later) — Bullet ricochet off mesh buildings.** BVH raycast vs building/rock
  colliders reading the real triangle normal via Module B. Broad-phase culled; bullets capped at
  100 in flight. Last because it's polish, not a bug fix, and has the most per-frame volume.

---

## 8. Open items to validate during build (honest unknowns)

1. **Skeleton bind-pose reset ordering** vs the auto-updating mixer — in three.js dropping a clip's
   weight to 0 *freezes* the last pose rather than resetting to bind, so the procedural path must
   explicitly reset the skeleton to bind each frame during the window (the headshot-override pattern
   shows the frame ordering that makes this stick). **Phase 3 gate.**
2. **Full-res building BVH shapecast cost** — colliders are built un-decimated
   (`COLLIDER_RATIO = 1.0`); measure a substep shapecast against the densest building before
   trusting the 8-substep cap.
3. **Blast-on-crowd worst case** — measure 30–40 simultaneously knocked monsters; confirm the
   budget fallback engages cleanly.
4. **Determinism** — fixed `CCD_MAX_STEP` keeps the swept path deterministic (the future
   server-authority / L2 DO plan needs this); verify no `Math.random` leaks into it.

---

## 9. References
- three-mesh-bvh (shapecast / spatial queries): https://github.com/gkjohnson/three-mesh-bvh
- BVHEcctrl (R3F BVH character controller, substep+shapecast pattern): https://github.com/pmndrs/BVHEcctrl
- Quake `PM_ClipVelocity` (trace + clip-velocity slide): https://www.gamedev.net/forums/topic/552794-quake-pm_clipvelocity/
- NVIDIA PhysX — Advanced Collision Detection (CCD substeps): https://archive.docs.nvidia.com/gameworks/content/gameworkslibrary/physx/guide/Manual/AdvancedCollisionDetection.html
- Collision response & coefficient of restitution: https://research.ncl.ac.uk/game/mastersdegree/gametechnologies/previousinformation/physics6collisionresponse/2017%20Tutorial%206%20-%20Collision%20Response.pdf
