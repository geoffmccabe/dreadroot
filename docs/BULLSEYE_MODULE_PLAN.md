# Bullseye Module — Design & Phased Plan (DRAFT, pending answers)

A flexible, cross-game (SWW + DreadRoot + Pinkland) combat module: a small
"bullseye" zone inside the head hitbox that, when hit, deals big bonus damage and
fires a configurable chain of effects — sound, a knockdown/topple sequence, and a
directional blood spray with decals. Per-monster config drives colors, sizes,
animations, sounds, and behavior changes. Built so it's reusable and fun to extend.

> Terminology: "bullseye" throughout (the user's "headshot" typos = bullseye).
> Distinct from the existing **headshot** (2× damage, top of the head box).

---

## 1. The bullseye hitbox

- A box **centered inside the head box**, riding the same bone-followed center
  (so it tracks the skull through animation, like the head box already does).
- Size = a **percentage of the head box**, scaled DOWN for big enemies so a giant's
  bullseye stays small (not a free 4× on a huge target). Percent by the enemy's
  **max dimension** (the larger of height or footprint length):
  | max size | bullseye % |
  |----------|-----------|
  | 0–4 m    | 30% |
  | 4–6 m    | 20% |
  | 6–8 m    | 15% |
  | 8–10 m   | 10% |
  | 10–15 m  | 6%  |
  | 15 m+    | 3%  |
- **Damage:** 4× base (vs 2× for a normal headshot). Resolved through the same
  combat-math path as headshot so it's consistent client + future server.
- Detection: in `refineBulletHit`, after the head-box test passes, also test the
  bullseye box; if hit → bullseye. (Bullseye ⊂ head box, so a bullseye is also a
  headshot, but we take the bullseye result.)
- `!hb` shows it as a third box (gold) nested in the red head box.

OPEN: bullseye box shape — a CUBE whose side = pct×(head box width), or the head
box scaled by pct on all 3 axes? (Plan assumes: scale all 3 half-extents by pct,
so it's a mini centered head box.)

---

## 2. Effects on a bullseye (configurable per monster)

Triggered by a classification flag on the hit (e.g. `hitZone: 'body' | 'headshot'
| 'bullseye'`). A generic dispatcher reads the monster's bullseye config and runs:

### 2a. Sound
A special bullseye sound (3D positional at the hit). **User will provide the audio
file** — see the reminder at the bottom.

### 2b. Default topple sequence ("the bullseye animation")
The monster goes down dramatically:
- Pivots at the **feet**, toppling in the **bullet's horizontal direction** (away
  from the shooter).
- Does a full **360° spin** while falling, ending **flat** (net 90° upright→flat,
  plus the full spin = a 450° flip pivoting at the feet).
- Direction decides the landing face: shot from the FRONT → lands on its **back**;
  shot from the BACK → lands on its **face**.
- Duration ~0.6–0.8 s, eased; overrides normal AI/animation for that window.
- Per-monster overridable (some monsters get custom sequences).

OPEN: Is a bullseye an instant **special death** (always topples + dies), or just
4× damage + the topple, and if the monster survives it gets back up? (Plan assumes:
the topple plays on every bullseye; if it survives, it recovers to idle.)

### 2c. Directional blood spray (reuse the vomit-demon spray system)
- **Origin:** the EXIT side — trace the bullet vector through the head and emit
  from the opposite surface (impact point pushed along the bullet dir by ~head
  size), so blood erupts out the far side.
- **Direction:** the bullet's velocity direction.
- **Count:** 100 droplets. **Speed:** 50% of the bullet's speed. **Cone:** 25°
  solid angle. **Opacity:** 70%. **Color:** per-monster blood color.
- **Shape:** elongated teardrops, 8:1 (length:width), pointing along flight.
- **Physics:** heavy air resistance — droplets decelerate **rapidly** then fall.
  Model = quadratic drag (a = −k·v·|v|) + gravity, high k so they shed speed in
  ~0.2–0.4 s (small droplets have low terminal velocity, ~6–9 m/s; high drag-to-
  mass). Tuned in testing.

### 2d. Blood decals (everything fades over 10 s)
- Hits a **monster mesh** → blood circle (reasonable size) on it, fades 10 s.
- Hits a **tree / rock / other mesh** → blood circle, fades 10 s.
- Hits the **ground** → leaves its own teardrop shape, fades 10 s.
- Decals follow the surface they land on; pooled + capped for performance.

---

## 3. Cross-game module architecture

- Lives in a shared, engine-agnostic location: `src/features/bullseye/` (or
  `src/features/combat/bullseye/`), usable by SWW, DreadRoot, Pinkland — they
  share the combat registry + bullet loop already.
- **Inputs:** a hit event `{ hitZone, hitX/Y/Z, dirX/Y/Z, speed, monsterRef }`.
- **Per-monster config** (lives with each game's monster definitions):
  - `bullseye.enabled`, `damageMult` (default 4), `sizePct` override
  - `bloodColor`, `bloodCount`, `bloodSpeedFactor`, `bloodConeDeg`,
    `bloodTeardropRatio`, `bloodOpacity`, `dropletSize`, `decalSize`, `fadeSeconds`
  - `sound`, `animation` ('topple' | custom id), `behavior` hooks
- **Effect dispatcher** is generic; **detection** plugs into the box-hitbox system
  (SWW has it today; DreadRoot/Pinkland enemies can adopt boxes or a simpler
  bullseye zone later).
- Damage stays in the shared `resolveBulletHit` path (server-safe). Blood/animation
  are client-side cosmetic.
- The same `hitZone` flag can later drive OTHER fun reactions per monster
  (enrage, flee, split, special death) — the module is built to extend.

---

## 4. Phased plan (build + test one at a time)

- **P1 — Bullseye hitbox + 4× damage.** Add the nested box (size table), detect in
  `refineBulletHit`, deal 4×, show gold box in `!hb`. *Test: shoot it, see 4× number.*
- **P2 — Effect dispatcher + per-monster config scaffold.** The `hitZone` flag +
  a generic bullseye-effects entry point reading per-monster config. *Test: console
  confirms a bullseye fires with the right config.*
- **P3 — Default topple sequence.** The feet-pivot 360° fall in bullet direction.
  *Test: front shot → back; back shot → face.*
- **P4 — Bullseye sound.** Wire the audio file you provide. *Test: hear it.*
- **P5 — Blood spray.** Reuse the vomit spray: 100 teardrops, exit-side origin,
  50% speed, 25° cone, 70% opacity, blood color, drag physics. *Test: visual.*
- **P6 — Blood decals.** Monster/mesh circles + ground teardrops, 10 s fade,
  pooled. *Test: shoot near ground / a wall / a monster.*
- **P7 — Cross-game + full per-monster config.** Generalize the module for
  DreadRoot + Pinkland; expose all the per-monster knobs. *Test in each game.*

Each phase ships behind config so unset monsters are unaffected.

---

## 5. Decisions (LOCKED)
1. **4× damage. Stun 2s, then get back up if not killed** (not an instant death).
2. **Topple = 450°** (a full 360° flip + the final 90° to land flat), pivoting at
   the feet about the horizontal axis ⟂ to the bullet's horizontal direction.
   Direction = bullet dir → front shot lands on BACK, back shot lands on FACE.
3. **Bullseye box = the head box scaled by pct on all axes** (a cube only if the
   head box is a cube). Rides the same bone-followed head center.
4. Max dimension = **max(height, footprint)**.
5. Blood emits from the **traced EXIT point**.
6. **Bullseye blood is fully variable** per monster: color, opacity (0..1), and
   other effects — e.g. robot = translucent golden-green, demon boss = opaque
   black. Default = red, ~70% opaque.
7. **Normal headshots do NOT bleed** — bullseye only.
8. **Player feedback** = a floating "BULLSEYE" text indicator above the head, just
   under the points/damage number (plus the monster's reaction). (P1 done.)
9. **No performance caps needed** — can't bullseye more than one monster in the window.
10. **Multiplayer**: damage is server-safe. Blood seen by everyone = STRETCH GOAL
    (P5 ships client-side first).
11. **Blood spray size scales with BULLET size** (all bullets identical today → one
    size; future big-bullet guns can scale it). Default color red, ~70% opacity.
12. **Water + lava**: blood leaves NO trace (no decal).

## REMINDER TO USER
➡️ **You still owe me the bullseye SOUND file** (for Phase 4). Ping me when ready.
</content>
