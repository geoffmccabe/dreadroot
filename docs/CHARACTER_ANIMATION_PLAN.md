# Character Animation — Phased Plan

Status: proposed, 2026-Aug-24. Nothing here is built yet.

## The situation this plan starts from

Measured against the code and the model files, not assumed:

- **DreadRoot renders no player body at all.** The local avatar in
  `src/components/fortress/FortressScene.tsx` is wrapped in a hard-coded
  `false`. You are a floating camera.
- **Other players are the default Mixamo test dummy.**
  `src/components/MultiplayerPlayers.tsx` loads `y-bot.fbx` for everybody,
  ignores the character you chose, and has exactly two states: walk and idle.
- **Siege Worlds is far ahead.** `src/components/siege/SiegeSelfAvatar.tsx`
  drives ten states, armed and unarmed, cross-faded.
- **A good locomotion/parkour slot system already exists**
  (`src/components/siege/charlineup/locomotionClips.ts`) and is used by exactly
  one dev preview panel. It never touches gameplay.
- **About 110 authored clips are sitting unused** across the model files:
  40 locomotion, 22 rifle, 11 parkour, 24 soldier (melee/death/hit), 12 misc
  (climb, glide, crawl, dance), plus 15 baked into each character.

## The constraint that shapes everything

**Two incompatible skeletons that share no bone names.**

| Rig | Characters | What it can use |
|---|---|---|
| Mixamo | Ash, Dago, Fluffer, Jankz, Rajax, Thorn | the whole ~110-clip library |
| Root | Flamma, Jeanette, Shi Yang | only their own 15 clips |

So there will be **two animation sets, permanently**, and the root-rig three will
always do less. That is accepted going in. Phase 7 decides whether to retarget
them properly or retire them — a decision made with real numbers once everything
else works, not now.

The 15 root-rig clips are not nothing: idle, walk, run, backwards, left, right,
jump, aim, shoot, reload, throw grenade, look up/down, dead, fall over. That
covers ordinary movement and combat. What they lack is parkour, melee, crawl,
climb and glide.

## Guiding rule: do not invent what is already solved

Traversal, blending and state machines are solved problems with published
approaches. Every phase that introduces something new begins with a **research
spike that produces a written recommendation before any code**. Where a spike
recommends a dependency, it must be verified on the official registry first
(publish date, download counts, real maintainer, real repository) per the
standing security rules.

---

## Phase 0 — Make the characters visible

No new animation work. This exists because the animation question is currently
academic: you cannot see yourself, and everyone else is an identical grey dummy.
Everything after this is judged by eye, so this has to come first.

1. Turn on the local avatar in DreadRoot.
2. **Render it at 25% opacity.** It is very likely to block the view or sit
   wrong relative to the camera, and a ghost is easy to look past while it is
   being adjusted. Opacity becomes a setting so it can be dialled up as it
   improves rather than needing a code change each time.
3. Replace `y-bot.fbx` with the player's actual chosen character, reusing the
   existing character chooser and roster.
4. Handle the character not being loaded yet without popping or blocking.

**Done when:** you can see your own body as a ghost, and other players appear as
the character they picked.

**Risk:** the avatar may clip the first-person camera. Siege Worlds already
solves this by hiding the body in first person; that approach carries over.

---

## Phase 1 — One state machine, two clip sets

Port the proven Siege Worlds state machine into a shared module both games use,
rather than writing a second one. It already handles armed vs unarmed,
cross-fading, and the detail where jump clips start past the crouch wind-up so
the leap reads immediately.

1. Lift the selector out of `SiegeSelfAvatar.tsx` into a shared module.
2. Express it against the **abstract movement slots** that
   `locomotionClips.ts` already defines, never raw clip names.
3. Provide two clip sets behind that one interface: Mixamo and Root.
4. A missing slot in a set falls back to the nearest sensible clip and is
   logged once, never silently.
5. Drive both the local avatar and remote players from it.

**States delivered:** idle, walk, run, backward, strafe L/R, run-strafe L/R,
jump, fall, glide, land.

**Done when:** all nine characters move correctly in DreadRoot, and the root-rig
three degrade visibly but sensibly rather than breaking.

---

## Phase 2 — Combat states

These are one-shot actions layered over locomotion, not replacements for it —
you keep running while you fire. That needs an action layer above the movement
layer, which is the first genuinely new piece of architecture.

**Research spike first (small):** upper/lower body masking vs full-body one-shot
with a quick return. Recommendation written down before building.

States: shoot, reload, throw grenade, hit reaction, death, hard landing.

Both rigs can do all of these — the root rig has shoot, reload, throw and dead
baked in, and the Mixamo library has richer versions plus firing-while-running.

**Done when:** combat reads correctly at a distance without watching the HUD.

---

## Phase 3 — Networking the animation state

Remote players currently infer "moving" from position changes, which can never
express running, jumping, firing or dying.

This is netcode work and must land against the wire format in
`docs/MULTIPLAYER_CDO_PLAN_V3.md`, not bolted on beside it. Animation state is a
few bits per player per tick: movement state, armed, airborne, plus one-shot
event flags for fire/reload/hit/death. One-shots are events, not states — a
death that arrives once must not be missed, and a fire flag that persists must
not loop.

**Done when:** two browser windows show each other running, jumping, shooting
and dying correctly.

### Built 2026-Aug-24 — on the LIVE path, shaped for the binary one

Implemented against the Supabase broadcast channel that actually carries
players today, because the Durable Object is not serving them yet. The shape is
deliberately the one the binary format wants, so moving it later is a
re-encoding rather than a redesign:

- **Continuous state** rides the transform message, which is already sent:
  `mf`, `mr`, `run`, `grounded`, `vy`, `gun`, `gliding`. In the binary format
  these are 3 bits of direction, plus 4 flags, plus a quantised vertical speed
  — call it two bytes on a packet already being sent per player per tick.
- **One-shot actions get their own message.** Two reasons, and both survive the
  move to binary: transforms are rate-limited and skipped entirely when nothing
  moved, so firing while standing still could go unsent for a whole keepalive
  interval; and an action is an EVENT, so a flag riding a repeated transform
  would re-fire the animation on every resend.
- **A sequence number makes the receiver idempotent.** A duplicate delivery
  carries a seq already seen and is ignored; a genuinely new action always
  differs. This is the piece that matters most on an unreliable transport and
  is why the plan called out "a death that arrives once must not be missed, and
  a fire flag that persists must not loop".
- **'revive' travels the same path.** It is not an animation — it releases the
  held death pose. Without it a remote player who respawned would stay a corpse
  on everyone else's screen, because death holds its final frame on purpose.

Not sent, deliberately: jet-boost. It is a local visual (boot flames) and only
selects the neutral airborne pose, which the receiver already picks from
`grounded` and `vy`.

---

## Phase 4 — RESEARCH SPIKE: traversal and parkour

**No implementation in this phase. The deliverable is a written recommendation.**

The established pipeline for "vault the log in front of you" is three parts, and
we should adopt it rather than rediscover it:

1. **Probe** — cast rays ahead of the character to find the obstacle and measure
   its height, depth, whether there is a landing surface on top, and whether
   there is clearance overhead.
2. **Classify** — map those measurements to a move: step over, vault a ~1m
   obstacle, dive over a ~2m one, slide under a low overhead, mantle onto a
   ledge, wall-run a wall too tall to clear. Our clip names already encode these
   thresholds (`..._Over_1m_Object`, `..._Under_1m...`), which is a strong hint
   the library was authored for exactly this scheme.
3. **Warp** — the clip was authored for one specific obstacle size; **motion
   warping** stretches its root motion to match the real one, and **IK** plants
   the hands and feet on the actual surface. Without this step a vault looks
   correct only on an obstacle that happens to match the animator's box, and
   floats or clips on everything else. This is the part most home-grown systems
   get wrong, and it is the part worth taking from prior art.

The spike must answer:

- Is there an MIT/permissive JS or three.js implementation worth adopting?
  `pmndrs/ecctrl` is the closest thing in our own ecosystem (same authors as
  react-three-fiber and drei) and ships a lightweight animation state resolver —
  evaluate its resolver pattern specifically, separately from its controller.
- **Do NOT adopt anyone's character controller wholesale.** DreadRoot's movement
  is tuned to Siege Worlds parity (walk 2.0, run 3.0, times the character
  multiplier) and is shared with SWW. Replacing the controller would regress
  something that works. Borrow the pattern, keep our physics.
- Which parts must be written by us because they touch our voxel world: the
  probe reads voxel columns, not arbitrary colliders, and that is genuinely
  ours.
- Do we need motion warping on day one, or is a fixed-size vault acceptable for
  a first pass on a blocky world where obstacles are whole numbers of blocks?
  A voxel world may make this materially easier than the general case — worth
  checking before taking on the hardest part.

**Done when:** there is a recommendation naming what we adopt, what we write,
and what we defer, with the licence and provenance of anything proposed.

---

## Phase 5 — Traversal implementation

Built to whatever Phase 4 concluded. Expected order, easiest and most valuable
first:

1. Mantle / climb onto a ledge — the most useful in a world made of stacked
   blocks, and `Climbing Up Wall` already exists and is already mapped.
2. Vault a low obstacle.
3. Drop and roll from a height.
4. Slide under.
5. Wall run and the flourish flips — last, because they are flavour.

Mixamo rig only. The root rig has no parkour clips; those three characters keep
ordinary jumping, which is the accepted trade.

---

## Phase 6 — Melee, crawl, climb, emotes

Everything else that already exists and is merely unwired: punches, kicks, sword
slash, roll, low crawl, running crawl, wave, pick up, dance.

Melee is gated behind gameplay design — a punch that does no damage is a puppet
show — so this phase pairs with whatever combat rules exist by then.

---

## Phase 7 — The root-rig decision

With everything above working, the gap between the two families will be plain
and measurable rather than theoretical. Then decide, with real numbers:

- **Retarget** Flamma, Jeanette and Shi Yang onto the Mixamo skeleton so they
  can use the full library; or
- **Retire** them from DreadRoot and keep them where their own 15 clips suffice.

Deliberately last. It is the only irreversible decision in this plan, and it
should be made from evidence rather than from a guess made at the start.

---

## What is genuinely missing and would need sourcing

Not in the library at all: swimming, a crouch/squat idle (there is crawl but no
crouch), ladder climbing as distinct from wall climbing, and aiming while
walking beyond the four directions already added.

## Sequencing summary

| Phase | Nature | Depends on |
|---|---|---|
| 0 Visible characters | wiring | — |
| 1 One state machine, two sets | port | 0 |
| 2 Combat states | small spike + build | 1 |
| 3 Network the state | netcode | 1, CDO wire format |
| 4 Traversal research | **research only** | 1 |
| 5 Traversal build | build | 4 |
| 6 Melee, crawl, emotes | wiring + design | 2 |
| 7 Root-rig decision | decision | 5 |

Phases 0-2 are the ones that change how the game looks and feels. 4 is the one
that saves the most wasted effort.
