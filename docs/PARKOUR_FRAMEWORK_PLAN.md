# Parkour — phased plan

Rewritten 2026-Aug-29 after Geoff's direction on automatic vaulting, mid-move
decisions, and climbing gated by skill/items. Research findings kept at the end.

---

## The behaviour we are building toward

Stated as rules, because these are what the architecture has to make possible:

1. **No key press to vault.** Run into a wall you can clear and you clear it,
   without losing speed.
2. **A vault is interruptible.** The character passes through a decision point
   on top of the obstacle, and what happens next depends on what is held THEN,
   not on what was held when the move started:
   - still moving forward → continue over and keep running
   - stopped moving forward → abort, stand up on top of the block
   - jump pressed → leap from the top as if jumping while running
3. **Two-block wall + jump = flip off it.** Land on the feet, facing back.
4. **Jump INTO a wall = grab it.** Land in a hanging/climbing position, then
   climb — but only as far as the character's **climbing skill** and any
   **climbing items** (e.g. climbing claws) allow.
5. Neither the climbing skill nor the claws exist yet. We build the **seam** for
   them now so adding them later is data, not surgery.

Rule 2 is the one that breaks the current code. Today a mantle is a fire-and-
forget scripted path that ignores input from the moment it starts. Everything in
Phase 2 below exists to fix that.

---

## What we have today (audited, not assumed)

**Two rival parkour brains that do not know about each other.**

| | `src/features/traversal/` | `src/components/siege/charlineup/` |
|---|---|---|
| Files | `obstacleProbe.ts`, `voxelObstacleProbe.ts`, `traversalMoves.ts`, `mantle.ts` | `obstacleDetector.ts`, `parkourGraphs.ts`, `parkourDemo.ts` |
| In the game? | YES — via `FortressControls.tsx` | NO — dev lineup panel, fake obstacles |
| Moves | stepUp, vaultLow, vaultHigh, mantle, slideUnder, wallRun | same + dropRoll + flourish flips |
| Step-up max | 0.6 | 0.4 |
| Vault-low max | 1.4 | 1.3 |
| Wall-run max | (none) | 3.5 |

They disagree on every threshold. Fixes land in one and not the other — that is
the root of the "botched" feeling, and it is structural, not a bug.

Three faults, all in the live one:

1. **Reactive.** `tryStartMantle` only looks at the wall on the frame you press
   jump while holding forward. Automatic vaulting is impossible by construction.
2. **One ray, dead ahead.** Approach ANGLE is never measured, so a wall flip or
   a side vault cannot even be expressed.
3. **One answer.** `chooseTraversal` is an if-ladder returning a single move, so
   "2-3 random vault variants" has nowhere to live.

Known live bug (`docs/OPEN_ISSUES.md` #4): a two-block stack climbs ~four blocks
and plays the climb in mid-air.

---

## Modularity rules (Geoff's constraint, binding on every phase)

- Everything new lives in **`src/features/parkour/`**. Nothing else.
- **`FortressControls.tsx` must get SHORTER, not longer.** It currently carries
  ~40 lines of mantle logic (refs, the per-frame branch, the start check). All
  of it moves out. Its final contact with parkour is one hook call and one
  position read — roughly 6 lines, replacing ~40.
- **One file per idea, target under 200 lines.** If a file needs a second
  paragraph to explain what it is for, it is two files.
- No new state in the Fortress components. Parkour owns its own state and hands
  back a position.

Planned files (each ≤ ~150 lines):

    src/features/parkour/
      surroundings.ts     what the scanner returns (types only)
      voxelScanner.ts     fills it from the voxel grid
      moveTypes.ts        the shape of a move definition (types only)
      moves/              one file per move: vaultLow, vaultHigh, mantle,
                          slideUnder, dropRoll, wallFlip, wallHang, wallRun
      chooser.ts          asks every move "do you fit?", picks one
      runner.ts           drives the chosen move, owns the cancel windows
      capability.ts       climbing skill + items gate (stubbed, always-allow)
      useParkour.ts       the ONE hook FortressControls calls
      debugOverlay.ts     draws the scan + every candidate's verdict

---

## Phase 1 — One system, no behaviour change

**Goal: stop the bleeding. Nothing should look different afterwards.**

1. Create `src/features/parkour/`.
2. Move the *good* parts of `features/traversal` into it: the probe interface
   and the voxel probe are sound and stay, renamed into the new shape.
3. Fold the lineup's extra moves (`dropRoll`, `flourish`) and its clip table
   into the same place. Delete `obstacleDetector.ts` and the duplicate
   thresholds — the lineup demo then drives the REAL system with fake input,
   which is what it should always have done.
4. Move all mantle logic out of `FortressControls.tsx` behind `useParkour()`.

**Done when:** the game behaves exactly as today, `FortressControls.tsx` is
~40 lines shorter, and there is exactly one table of thresholds in the repo.

**Risk:** low. Pure refactor, and the existing `check:lineup` harness plus the
D-Flow traversal readout both still work as before-and-after evidence.

---

## Phase 2 — The scanner and the debug overlay

**Goal: see what the character sees. This is also the fix for the climbing-air bug.**

1. `voxelScanner.ts` runs **every frame while moving**, not on a keypress.
2. It samples a fan — centre, ±30°, ±60° — out to ~2.5m, and returns one
   `Surroundings` record: obstacle height, depth, headroom, far-side ground,
   wall normal, **approach angle**, drop ahead, and whether the top is standable.
3. `debugOverlay.ts` draws the fan and the numbers in the world, toggled from
   the D-Flow panel.

**Done when:** walking at a two-block stack shows on screen exactly what heights
it is reading — which will either confirm or kill the "climbs four blocks"
theory in one test instead of ten.

**Why this is before any new move:** every parkour bug so far has been invisible.
Guessing and asking Geoff to retest is the slowest loop we have.

---

## Phase 3 — Moves as data, and the chooser

**Goal: replace the if-ladder. Still behaviour-neutral.**

1. Each move becomes one small object: name, clips, the window it accepts
   (height range, depth range, headroom, angle range, min speed, airborne or
   grounded, key required or not), the path it drives, and a weight.
2. `chooser.ts` asks EVERY move "do you fit these surroundings?", collects all
   that say yes, and picks by weight. Variants (three different 1-block vaults)
   are three entries or one entry with a clip array.
3. Port the current six moves across unchanged.

**Done when:** behaviour is identical, but adding a move is adding a file.

---

## Phase 4 — Automatic vaulting

**Goal: rule 1. Run at a low wall and go over it.**

1. Trigger on **contact while moving forward at speed**, not on a key. The
   scanner already knows the vault is available ~0.5s out, so the wind-up can
   start before the collision rather than snapping at it.
2. Speed gate: below walking pace you stop at the wall instead. A vault from a
   standstill looks absurd, and this is also the "did I mean to do that?" guard.
3. Cooldown so brushing a wall repeatedly does not re-fire.

**Done when:** running a corridor of 1-block walls reads as continuous movement.

**Risk:** medium — the failure mode is vaulting things you did not want to vault
(a doorstep, your own fortress wall while building). Build-mode should suppress it.

---

## Phase 5 — Cancel windows: the mid-vault decision

**Goal: rules 2 and 3. This is the heart of the whole thing.**

`runner.ts` stops being a fixed path and becomes three phases with an input read
between them:

    plant  →  [APEX — read input here]  →  exit

At the apex, on top of the obstacle:

| held at apex | result |
|---|---|
| forward | continue over, land running (today's vault) |
| nothing | abort — stand up on top of the block |
| jump | launch from the top, as a running/walking jump |
| jump, and a 2-block wall ahead | **wall flip** — push off, land on feet |

Also in this phase: **jump into a wall → hang.** A separate entry condition
(airborne, moving into a wall too tall to clear) puts the character into a
`wallHang` state at the ledge, from which climbing begins.

**Done when:** the same run-up produces four different outcomes depending on
what Geoff does mid-move, and none of them drop him through the world.

**Risk:** highest in the plan. Interruptible scripted motion is where these
systems usually break — an abort that hands back at the wrong height puts you
inside a block. Every exit must hand back through one function, never inline.

---

## Phase 6 — Climbing, and the skill/item gate

**Goal: rule 4, and the seam for rules that do not exist yet.**

1. `capability.ts` exposes one function: given the character and their
   inventory, how high can they climb, can they hang, how fast do they climb?
2. **Ships stubbed and permissive** — everyone can climb, nothing is blocked.
   The gate exists so the later change is a data change.
3. Climb up from `wallHang`, one block at a time, respecting that height cap.

Two things to decide, not assume:

- **A climbing stat is a schema change**, and character stats are shared with
  Siege Worlds. Adding a sixth stat needs to be agreed rather than slipped in.
- **Climbing claws are an item**, so they need an item ID and a slot in the
  existing inventory before the gate can read them.

**Done when:** climbing works and is limited by a number that a future skill or
item can change without touching the parkour code.

---

## Phase 7 — Animation gaps

Only now, once we know which slots are empty.

We have **11 parkour clips**: 3× 1m vault variants, 2m dive-over, backslide-
under, wall-run-with-right-turn, jump-down-to-roll, 2 front flips, plus
`Climbing Up Wall`.

**Confirmed missing** for the rules above:

- flip OFF a wall, landing on the feet (we have front flips and a SIDE flip over
  a 1m object — neither is a wall push-off)
- a hang / braced-on-ledge pose to hold before climbing
- left-turn wall run (we only have right)
- safety-roll landing, ledge shimmy, crouch idle

**Where to get them, cheapest first:**

1. **Mixamo** — ~2,500 free clips on our EXACT skeleton, zero retargeting. Search
   here before anything else; it very likely covers all of the above.
2. **Quaternius Universal Animation Library 1 + 2** — CC0, 130+ clips each,
   explicitly includes parkour, FBX/glTF/BLEND. This is the "second vast set"
   Geoff was told about, and it is real — but it is a DIFFERENT rig and needs a
   Blender retarget pass before it fits our characters.
3. **CMU / ACCAD mocap** — thousands of free BVH, heaviest retargeting cost.

Epic's UE5 Game Animation Sample (500+ clips, the obvious best answer) is
licensed for use inside Unreal Engine only. Not usable here.

Note: the root-rig three (Flamma, Jeanette, Shi Yang) share no bone names with
the Mixamo six and have no parkour clips at all. They keep ordinary jumping.

---

## Sequencing

| Phase | What | Visible change | Risk |
|---|---|---|---|
| 1 | One system, out of FortressControls | none | low |
| 2 | Scanner + debug overlay | debug only | low |
| 3 | Moves as data + chooser | none | low |
| 4 | Automatic vaulting | **yes** | medium |
| 5 | Cancel windows, wall flip, wall hang | **yes** | high |
| 6 | Climbing + skill/item gate | **yes** | medium |
| 7 | Animation gaps from Mixamo | polish | low |

Phases 1-3 are refactors that change nothing on screen. That is deliberate: the
current system cannot express the rules above, and bolting them onto it is how
we end up with a third rival implementation.

---

## Research behind this (2026-Aug-29)

Every serious implementation is the same four stages: **scan continuously →
propose candidates → pick one → warp the clip onto the real surface.**

Two MIT-licensed references, both Unity/C#, so we take the shape and not the code:

- **Dynamic Parkour System** (knela96, MIT, 1.4k stars) — the closest match to
  what Geoff described. A detection controller scans every frame; a vaulting
  controller holds a LIST of action objects (VaultObstacle, VaultOver, VaultDown,
  Slide, Reach, ClimbLedge, JumpPrediction), each with its own `CheckAction()`
  and its own tuning asset (clip, ray origin, ray length, land offset, start
  delay). Adding a move = adding one object. **Phase 3 is this pattern.**
- **Traverser** (AitorSimona, MIT, last touched 2021) — better climbing:
  procedural ledge-to-ledge, free hang, drop-down, custom motion warping. Read
  it for Phase 6; it depends on Unity Animation Rigging so nothing is liftable.

**Nothing comparable exists in JavaScript or three.js** — checked; only toy demos.
`pmndrs/ecctrl` was evaluated in `docs/CHARACTER_ANIMATION_PLAN.md` and has no
traversal at all.

**Motion warping is still not needed here.** Voxel obstacles are whole blocks and
our clips were authored at exactly that granularity (`..._Over_1m_Object`,
`..._Over_2m_Object`). A mesh world (Siege Worlds) will need it; the scanner is
behind an interface so that stays a drop-in.
