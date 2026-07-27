# Kaiju AI: what to build on

Research answer to Geoff's question (2026-Jul-27): what is the tried-and-true AI for autonomous
Kaiju, one that takes plain if-then rules, handles combat, ranged versus melee, cover, fleeing and
exploration, and can later be driven by an LLM.

Short answer: **do not pick one architecture.** The thing that has actually shipped in this genre
for twenty years is a stack of three layers, each answering a different question. Picking a single
one is the usual mistake, and it is why bespoke enemy AI tends to collapse into unmaintainable
special cases.

| Layer | Question it answers | What to use |
|---|---|---|
| Utility | WHAT should I be doing right now? | Infinite Axis Utility System (write it, ~250 lines) |
| Behaviour tree | HOW do I carry that out, step by step? | **Mistreevous** (MIT, TypeScript) |
| Spatial query | WHERE should I do it? | EQS-style query system (write it, ~300 lines) |

Underneath sit pathfinding (mostly already built here) and the animation mapping (already built).

---

## Why a hybrid, and not just a behaviour tree

Behaviour trees are the industry default and they are genuinely good at ordered, legible procedure:
"approach, face, wind up, strike, recover". They are bad at *choosing between many competing
options that all partly apply*, which is most of what a Kaiju does. Encoding "attack unless
outmatched, unless miners are threatened, unless badly hurt, unless the objective is close" as tree
structure produces deep nesting where every new rule risks reordering the whole thing.

Utility scoring is the opposite: every candidate action scores itself continuously, highest wins.
That is exactly right for "if the enemy is bigger and stronger, hide", because bigger-and-stronger
is a matter of degree, not a boolean. It is bad at ordered procedure, because it has no memory of
where it is in a sequence.

So: **utility decides, the tree executes.** This is the standard recommendation and matches how it
is done in shipped games; a utility layer sets the priority (defend vs attack) while a behaviour
tree runs the detail.

Two other well-known options, and why not:

- **GOAP** (F.E.A.R.) plans action *chains* backward from a goal. Superb when the interesting part
  is discovering a multi-step plan. A Kaiju's steps are mostly short and the cost is a planner plus
  a world-state model. Worth revisiting only if we later want genuinely surprising multi-step
  tactics.
- **Plain state machines** are what everyone starts with, and they are why enemy AI becomes
  unmaintainable at about a dozen states.

---

## Layer 1: Utility (the decider)

Dave Mark's **Infinite Axis Utility System**, presented at the GDC AI Summit and used in Guild
Wars 2. It is small enough to write, and writing it is better than adopting a framework because it
is where all the tuning lives.

The shape:

- An **action** (Attack, Flee, TakeCover, GuardMiner, Advance, Explore, Regroup) has a list of
  **considerations**.
- A consideration takes one **input**, normalised to 0..1 (my health fraction, distance to target
  over my attack range, their power over mine, how contested this cell is), and runs it through a
  **response curve** (linear, exponential, logistic, inverted).
- The action's score is the product of its considerations, times a per-action weight.
- Highest score wins, with hysteresis so it does not dither between two near-equal options.

Why the product rather than the sum: any single consideration scoring zero should veto the action
outright. "Flee" with a health consideration of zero at full health must not creep up just because
five other factors are mildly favourable.

This gives Geoff's examples directly:
- *"under 10% health, turn and run"* is a Flee action with a health consideration that is flat zero
  above 10% and rises steeply below it.
- *"if the enemy is bigger and stronger, hide behind an obstacle"* is a TakeCover action with a
  power-ratio consideration, multiplied by a "cover is actually available nearby" consideration
  that the spatial layer answers.

Crucially it also supports **hard rules**, which Geoff explicitly wants. A consideration that
returns exactly 0 or 1 is an if-then. Fuzzy and hard rules coexist in one mechanism.

## Layer 2: Behaviour tree (the executor)

**Mistreevous**, https://github.com/nikkorn/mistreevous. MIT, TypeScript, currently 4.3.1, one
tiny dependency, targets browsers, and it is the right pick here for three specific reasons:

1. It has a **text DSL** as well as JSON. Geoff can read and write behaviour in something close to
   the sentences he has been describing, rather than in code.
2. It accepts **trees as JSON**, which is the whole LLM story below.
3. It has an in-browser **visualiser**, which matters given how much of this project has been lost
   to not being able to see what is happening.

Each utility action owns one subtree. The tree handles sequencing, retries, timeouts and interrupt
conditions, which is precisely what utility scoring is bad at.

## Layer 3: Spatial queries (the "where")

This is the layer people forget, and without it "hide behind an obstacle" and "keep at ranged
distance" cannot be expressed at all. The reference design is Unreal's **Environment Query
System**, and the underlying idea is older: Matthew Jack's tactical position selection from
Crysis 2 (Game AI Pro, chapter 26).

It works like a database query over space:
- a **generator** proposes candidate points (a ring around me, a grid around the target, points
  along cover edges),
- a set of **tests** score or filter them (distance band, line of sight to target, line of sight
  blocked by terrain, slope, proximity to allies, exposure to other enemies),
- weights combine the scores and the best point wins.

No good open-source JavaScript implementation exists, but it is a few hundred lines and it is the
single highest-leverage piece for making combat look intelligent. On this planet the natural
generator samples the sphere's tangent plane around the agent, and the "is it cover" test is a ray
against the terrain height field, which is cheap because the terrain is a deterministic function
(see `globeGround.ts`).

**Multiple enemies** are handled at this layer too, via an **influence map**: each hostile paints a
falling-off threat value over nearby cells, each ally paints support. Then "retreat" is just moving
down the threat gradient, and "flank" is finding a point with line of sight but low threat. This is
also what stops a group of Kaiju all making the same decision and clumping.

---

## What we already have and should not rebuild

- **Pathfinding.** `/Users/geoffreymccabe/dreadroot/src/features/pathfinding/` already has A*,
  weighted A*, Dijkstra, BFS, greedy, JPS and steering behind a registry, and critically the
  planners are **pure over an abstract `PathGrid`**, with the voxel world as just one adapter. It
  needs a cube-sphere adapter, not a rewrite.
- **The existing behaviour tree** in `src/features/enemies/ai/behaviorTree/` is only 282 lines
  total and has no DSL, no visualiser and no decorators. Replacing it with Mistreevous is a clear
  upgrade, and small enough that migrating the five existing enemies is tractable.
- **Animation mapping.** `GlobeKaiju.tsx` already maps a gait to a clip with fallbacks per model,
  and the Froude-scaled playback rate. Behaviour tree leaves should *request a gait*, not touch
  clips, which keeps the AI ignorant of which monster model it is driving.
- **Combat routing.** `EnemyCombatRegistry` already funnels all damage through one adapter.

---

## The LLM path, and how to not paint ourselves into a corner

The useful recent result is **VLM-driven Behavior Tree for Context-aware Task Planning**
(arXiv 2501.03968, Jan 2025). Its method is worth copying almost exactly:

- the model generates a behaviour tree **containing condition nodes whose conditions are free-form
  text**, rather than choosing actions directly;
- a second model pass evaluates those text conditions against the live state during execution.

Why that shape is right for us: the LLM never sits in the per-frame loop, so it cannot cause a
frame-rate or cost problem, and its output is a **data structure we can inspect, version, diff and
reject** rather than an opaque action. The authors are explicit that the field is early and their
validation is a single real-world scenario, so this is a direction, not a solved technique.

Practical consequences for how we build now:
1. Keep every tree as **JSON**, never as hand-written code. Mistreevous does this natively. An LLM
   can then emit or edit a tree, and we can validate it before it runs.
2. Give considerations and conditions **stable string names** with documented ranges, so a prompt
   can refer to "healthFraction" or "powerRatio" without seeing the code.
3. Allow a condition node to be **free-form text** evaluated out-of-band, with the result cached
   for a while. That is the hook from the paper.
4. Keep the LLM on the slow loop: choosing a strategy for the next minute, or writing a species'
   tree offline, never picking this frame's action.

Also relevant, and a fair warning about scope: **Combining Reinforcement Learning and Behavior
Trees** (arXiv 2510.14154, Oct 2025, AMD Schola) argues the BT/RL boundary is where the practical
value is, and documents how hard pure-RL NPCs are to ship. Worth reading before anyone proposes
learning the Kaiju behaviour rather than authoring it.

---

## Suggested build order

1. **Utility core** plus a debug panel showing every action's live score. Without that panel the
   system is unreadable and tuning becomes guesswork.
2. **Mistreevous** in, one subtree per action, the five existing enemies migrated.
3. **Spatial query system**, starting with two queries: a ranged firing position, and a cover point
   from a given threat.
4. **Cube-sphere PathGrid adapter** so the existing planners work on the planet.
5. **Influence map** for multiple enemies and allies.
6. **LLM hooks**: JSON trees in and out, named considerations, text conditions.

Each step is independently testable, which given this project's history matters more than speed.

## Sources

- Mistreevous - https://github.com/nikkorn/mistreevous
- Infinite Axis Utility System (Dave Mark) - https://www.gameai.com/iaus.php
- GDC: Architecture Tricks: Managing Behaviors in Time, Space, and Depth - https://www.gdcvault.com/play/1018040/Architecture-Tricks-Managing-Behaviors-in
- Tactical Position Selection (Matthew Jack, Game AI Pro ch.26) - https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter26_Tactical_Position_Selection.pdf
- Unreal Environment Query System - https://dev.epicgames.com/documentation/unreal-engine/environment-query-system-in-unreal-engine
- VLM-driven Behavior Tree for Context-aware Task Planning - https://arxiv.org/abs/2501.03968
- Combining Reinforcement Learning and Behavior Trees for NPCs (AMD Schola) - https://arxiv.org/pdf/2510.14154
- GOBT: Goal-Oriented and Utility-Based Planning in Behavior Trees - https://www.jmis.org/archive/view_article?pid=jmis-10-4-321
