# Co-Build Note: Monster SENSES are owned by the other window — leave a seam

**To the Claude improving monsters / NPC pathfinding & behaviour: please read this before you
touch target-acquisition.** A second Claude window is building the monster **senses** system
(sight / sound / smell + stealth) as a separate, self-contained layer. We've split the work so we
don't collide. You build everything *else*; you leave one clean gap where senses plug in.

Full design lives in `docs/CRAWLIE_SENSES_PATHFINDING_PLAN.md`. This note is just the boundary.

---

## The one idea: a sense → action sequence, split down the middle

A monster deciding what to do is a 5-step pipeline:

1. **STIMULUS** — the player (and player actions) emit signals: movement noise, weapon fire,
   landing/glide impact, scent strength, visual exposure (size, light, standing-still).
2. **SENSE** — each monster's sensors filter those stimuli by range, vision cone + line-of-sight,
   wind/downwind, and light level.
3. **AWARENESS** — per monster→target meter that rises fast and decays slowly, with states:
   `Unaware → Suspicious (go to last-known spot) → Alert (pursue)`.
4. **GATE** — produces the answer "do I know about a target, where is it, how sure am I?" — throttled
   (a calm monster re-checks every ~1s, not every frame).
5. **ACTION** — pathfind, move, climb/hop, attack, flee, animate.

**Steps 1–4 are the senses window's (the other Claude). Step 5 is yours.**
The boundary is between step 4 and step 5. You consume the gate's answer; you do not implement it.

---

## What YOU own (everything except sensing)

- Locomotion, surface-walking, the future reusable creature-movement framework, the "hop" between
  surfaces, A* / steering / nav, behaviour states (wander / pursue / investigate / attack / flee),
  animation, combat, the NPC admin panel for all **non-sense** stats.
- All of `MonsterEnemy`, `siegePathfinding`, the EMS NPC system, the catalog/config plumbing, etc.

## What the SENSES window owns (do NOT build these)

- New modules (reserved names — don't create or edit them): **`perception.ts`** (the sense→awareness→gate
  logic) and **`soundEvents.ts`** (the player stimulus bus).
- The **per-character scores**: `camo`, `stealth`, `scent` — and their admin fields + storage.
- The **per-monster sensor scores**: `sight` (range + FOV cone + acuity), `hearing` (range + acuity),
  `smell` (range + acuity) — and their admin fields + storage.
- The world **wind / downwind** direction and any light-level sampling used for detection.

Please don't add detection logic (vision cones, hearing, smell, camo/stealth checks) or those score
fields to the admin panels or DB — even partially. If you think you need one, leave a TODO and ping
Geoff; the senses window will fill it.

---

## The seam: one function you route through ("leave a space")

Instead of reading the player's position or doing `dist < aggro` / LOS directly, funnel **every**
"do I have a target and where is it?" decision through a single acquisition call that the senses
window owns:

```ts
// owned by the senses window — you import and call it, you don't implement its insides
acquireTarget(monster, world): {
  pos:       Vec3,                                  // where to head (last-known when not currently sensed)
  state:     'unaware' | 'suspicious' | 'alert',
  awareness: number,                                // 0..1
} | null                                            // null = no target → wander
```

- **Today** the senses window will ship a thin **stub**: it returns the nearest player when within
  `aggro` and line-of-sight clear (≈ current behaviour), so your pathfinding/behaviour runs unchanged.
- **Later** the same function gets the real eyes/ears/nose + awareness + camo/stealth/scent + the
  re-check throttle. **Your call sites never change** — you already route through the seam.

So your task re: senses is only: **replace direct player-position / `dist < aggro` / aggro-LOS reads in
your behaviour code with a call to `acquireTarget()`**, and branch on `state` (alert → pursue, suspicious
→ move to `pos` and look around, null → wander). Build the wander/pursue/attack/hop machinery however you
like behind that.

If the stub doesn't exist yet when you reach a call site, stub it locally as "nearest player within
aggro + LOS" and add `// SENSES-SEAM` next to it so the senses window can find and replace it.

---

## Quick rules of thumb

- See a vision cone, hearing, smell, wind, camo, or stealth concept? **Not yours** — leave the seam.
- See pathfinding, movement, hop, behaviour states, combat, animation? **Yours.**
- Touching shared files (`MonsterEnemy.tsx`, catalog, admin): fine, but don't add sense fields; tag any
  target-acquisition spot with `// SENSES-SEAM`.
- `git fetch` + sync `src/version.ts` before pushing (one shared number). We just had a commit race —
  prefer staging your own files explicitly over `git add -A`.
