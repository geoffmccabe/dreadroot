# Buildable Kaiju: stats, point-buy, and the always-on server

Research answer to Geoff's question (2026-Jul-27): is there an off-the-shelf point-buy system for
buildable monsters, how do players earn and spend points on breeds or custom designs, and how do
we run thousands of autonomous Kaiju on a server around the clock.

---

## Short answers first

1. **There is no drop-in software library for this.** I looked. What exists is tabletop RPG
   *rulesets* — rules as text, not code — and a handful of video games that solved pieces of it.
   Anyone claiming otherwise is selling a generic "stat system" asset, which is a container for
   numbers and not a balance framework.

2. **Take structure from three tabletop systems, take numbers from our own simulator.** The
   structural ideas below are decades-proven and worth copying almost exactly. The actual point
   costs must come from running fights, because no tabletop system has ever been balanced for
   thousands of autonomous agents fighting continuously with no human referee.

3. **Do not license a tabletop system.** Details below, but the short version is that the one
   famous attempt went badly and the mechanics we want are not the part that is protected anyway.

4. **Never simulate all Kaiju at full rate.** The always-on requirement is real; running everything
   at frame rate 24/7 is not. The answer is three tiers of simulation, where the bottom tier does
   not tick at all and is resolved arithmetically when someone finally looks.

---

## Part 1: What to steal, and from where

### GURPS — disadvantages that refund points

The oldest and cleanest point-buy system. Every trait costs points; **limitations pay points
back**. You fund your strengths by accepting real weaknesses.

This is exactly the mechanism Geoff described for obedience. "More obedient means more suicidal and
obeys more directly" is, in GURPS terms, a disadvantage: it makes the creature strictly worse at
surviving, so it should **refund** points that get spent on strength or armour. A player who wants
a Kaiju that does what it is told pays for that by fielding something more fragile in every other
respect, and a player who wants a survivor accepts a creature that argues.

That is a genuinely good trade because both sides are attractive, which is the test of a good
point-buy axis.

GURPS also caps how many points you may take from disadvantages, which we will need — otherwise the
optimum is a creature made entirely of flaws.

**Caution.** GURPS is proprietary. Interplay licensed it for what became Fallout, fell out with
Steve Jackson Games late in development, and had to strip it out and write SPECIAL instead. That is
the standard cautionary tale for tying a video game to someone else's licensed system, and it
applies with more force here because our system has to carry an economy.

### Mutants & Masterminds — power level caps, and why they matter most

M&M's central rule is not point-buy at all. It is that **each statistic has a hard cap set by the
campaign's power level, independent of how many points you have.** You cannot dump everything into
damage even if you can afford to; you can only reach the cap, and then you must spend elsewhere.
Its designers treat power level caps and trade-offs as the two most important rules in the game.

This is the single most valuable idea here, because the failure mode of any player-designed unit
system is **one degenerate build that everyone copies**. Total-point budgets alone do not prevent
that. Per-stat caps do, and they also mean a newly unlocked tier changes what is *possible* rather
than just adding more of the same.

Concretely for us: a Kaiju tier defines both a point budget and a cap on each of strength, armour,
damage, healing and speed. Trading below the cap in one stat can buy above-average in another, but
nothing exceeds the tier ceiling.

### Pathfinder 2e — benchmark tiers and explicit push-and-pull

Paizo's creature-building rules are the most directly applicable of the three, because they are
built for *making monsters*, not player characters. The approach is **top-down**: rather than
adding up modifiers, you pick a level and then choose a tier for each statistic from a table —
extreme, high, moderate, low, terrible — and read off the final number.

At level 5 the strike-damage benchmarks run roughly 2d12+7 for extreme down to 2d4+6 for low; AC at
level 10 runs 33 extreme down to 27 low. The doctrine attached is explicit and is the part worth
copying: **"if you're giving a creature an extreme statistic, it should have some low or terrible
statistics to compensate"**, and a creature only gets more than one extreme statistic at high
levels.

Top-down is the right model for us for a practical reason: the simulator needs a *final number* for
each Kaiju, and going straight from a design to final numbers means fewer places for a build to
accumulate unintended multiplicative bonuses.

### Spore — a hard complexity budget

Spore's creature creator caps total complexity at a fixed number of points and simply refuses more
parts once you hit it. Most of its options are cosmetic, which is the criticism levelled at it. Two
lessons: a visible, hard budget is intuitive and self-explaining, and **cosmetic-only customisation
disappoints people** — every choice a player makes should change how the creature performs.

### Impossible Creatures — parts determine stats

Its whole design is combining two animals, with every limb choice affecting field performance. It
is the closest existing game to "design your own monster and send it to fight", and its lesson is
the inverse of Spore's: when parts drive stats, the creature designer *is* the strategy layer.

This matters for us because the EMS monster system already sketched in this project builds
creatures from primitives with joints. If the primitives carry stat contributions, the point-buy
system and the visual designer become the same tool rather than two things to keep in sync.

### Warhammer 40,000 — points as the matchmaking unit

Worth naming because it is the most battle-tested point system in existence and it is used for
something we will need: **agreeing the size of a fight**. Points are not only a design budget, they
are how two forces are declared comparable.

---

## Part 2: The licensing question, briefly

Worth knowing, and worth a lawyer's eye before anything ships, because I am not one.

- **D&D SRD 5.1** was released under **Creative Commons Attribution 4.0**. That is permanent,
  irrevocable, allows commercial use, and asks only for attribution. No share-alike. It is by some
  distance the most permissive option, but the SRD contains monster *stat blocks* and challenge
  ratings rather than the monster-*building* maths, which is the part we actually want.
- **Pathfinder 2e** is under the **ORC License**, which does allow electronic games — but it
  obliges you to contribute back the new game mechanics you develop on top. For a commercial game
  whose economy is its differentiator, that give-back is a real consideration, not a formality.
- **GURPS** and **Hero System** are proprietary. See the Fallout story above.

**The more useful point:** game *mechanics and systems* are generally not copyrightable in the US —
only the specific expression is. A table of numbers copied verbatim is expression. "Pick a tier per
stat, and an extreme must be paid for with a low" is a system. In practice that means we can adopt
the *structures* described above without adopting anyone's licence, provided we write our own
numbers and our own words. Given that our numbers have to come from simulation anyway, this is not
a compromise — it is the same work either way.

---

## Part 3: The stat model

Proposed axes. Deliberately short: every stat must be something the combat simulator already reads
or can be made to read, or it is decoration.

**Physical**
- **Strength** — melee damage, and how hard it shoves other Kaiju
- **Armour** — flat damage reduction, distinct from health
- **Health** — total damage absorbed
- **Healing** — regeneration per minute out of combat; the main determinant of how often a Kaiju
  can fight without going home
- **Speed** — movement, already Froude-scaled from size
- **Size** — feeds strength, health and speed, and is also a target profile: bigger is easier to hit

**Weapons**
- Damage, range, rate, area. Already modelled in `kaijuWeapons.ts`.

**Temperament — the interesting ones**
- **Obedience** — how heavily a player's order biases the utility scores. High obedience is
  *worth points back*, because it makes the Kaiju do things that get it killed.
- **Aggression** — how much it discounts danger when choosing to engage
- **Loyalty / morale** — how much damage it takes before self-preservation overrides everything
- **Cunning** — whether it uses cover and range properly, or just charges

The temperament stats are the ones that make two Kaiju with identical physical stats behave
differently, and they cost nothing extra to implement because **they are all just weights on
considerations that already exist** in `kaijuBrain.ts`. That is the payoff of having built the
brain as a utility system: personality is a set of numbers, not a set of special cases.

### Where the numbers come from

This is the part no tabletop book can give us, and it is the part we are unusually well placed to
do.

`scripts/check-kaiju-arena.ts` already runs a complete three-way Kaiju fight headlessly in about a
second, with no browser and no renderer. That makes the following possible, and it should be the
actual balancing method:

- Run every candidate build against every other, thousands of matchups, overnight.
- Any build with an outsized win rate is either mispriced or degenerate. Raise its cost, or find
  which stat is doing the work and lower the cap on it.
- Re-run after every change. Regressions become visible immediately rather than after a patch ships.

This is how the weapon damage in the current build was set. The first pass had the flamethrower at
roughly five times everyone else's damage per second, which the simulator exposed in one run by
having both opponents flee on sight. No amount of reading the numbers would have caught it.

Once the game is live, the same loop runs against **real match data**, which allows the one thing
tabletop systems cannot do: **prices that move.** If a build is over-performing this week, its
point cost rises next week. That is a live balance lever, it is transparent to players, and it
makes the economy self-correcting.

---

## Part 4: The points economy

This is where the node-gating premise pays off, and it connects to the closed-loop Dread Points
plan already sketched for this project.

**Earning.** Running a Divi node is the entry condition, so node uptime is the base income — it is
the behaviour the whole game exists to encourage. On top of that: territory held over time, kills,
and a Kaiju surviving long campaigns.

**Spending.**
- **Breeds** — pre-designed, fixed-cost, known-good. The safe purchase, and the on-ramp: a new
  player should not have to understand the design system to play.
- **Custom designs** — spend points on the stat budget directly. More expensive than the
  equivalent breed, because you are buying flexibility and the option to find something new.
- **Launching** — putting a Kaiju through a portal should itself cost, or the world fills up.

**The sink is the design problem.** Every points economy dies of inflation unless something
consumes points permanently. The obvious and thematically correct sink here is that **Kaiju die for
good.** A dead Kaiju is spent points, gone. That makes the decision to commit one to a fight
meaningful, it makes the survival stats genuinely valuable, it gives the AI's self-preservation
real weight, and it is the reason a player would ever choose a disobedient Kaiju over an obedient
one.

If permanent death proves too harsh, the softer version is that a defeated Kaiju is *injured* and
costs points to heal, scaled by how badly it lost. Same sink, gentler curve. Worth having both
available as a tuning knob rather than deciding now.

**Anti-degenerate measures**, in the order they matter:
1. Per-stat caps by tier (the M&M rule). Prevents the single dominant build.
2. Capped refunds from disadvantages (the GURPS rule). Prevents the creature made of flaws.
3. Simulation-derived pricing that updates with real data. Catches what the first two miss.

---

## Part 5: The always-on server

Geoff's requirement: the Kaiju roam and fight continuously, whether or not their owner is playing.
This is the largest piece of engineering in the whole project and the one with a genuine ongoing
cost attached, so it deserves the most honest treatment.

### The precedent worth studying

**Screeps** is the closest existing thing: an MMO where every player's units are driven by the
player's own code, running 24/7 in a shared persistent world whether they are logged in or not. It
is open source, so its architecture is readable rather than guessed at. Its server is a set of
parallel processes with tick synchronisation through Redis and per-object documents in MongoDB.

The calibration worth taking from it: **even Screeps does not run at real-time frame rates.** Its
world tick is measured in seconds, and slows further under load. Anyone proposing to run thousands
of autonomous agents at 20 Hz around the clock should look at that first.

### The architecture: three tiers of simulation

The mistake to avoid is treating "always on" as "always at full fidelity". Fidelity should follow
attention.

**Tier 0 — someone is watching.** Full simulation at frame rate: the exact code in `kaijuArena.ts`
today, with physics, projectiles and animation. Expensive, and correctly so, because a player is
looking at it.

**Tier 1 — contested but unwatched.** A coarse tick, perhaps once a second or slower. Positions,
health and combat outcomes are real; there is no animation, no projectile physics, and combat
resolves statistically from the same stats rather than shot by shot. A fight that Tier 0 would play
out over ninety seconds, Tier 1 resolves in a few ticks with the same expected outcome.

**Tier 2 — nobody anywhere near.** **Does not tick at all.** Store the Kaiju's current intent and a
timestamp. When someone eventually looks, compute what must have happened in the elapsed time
arithmetically: it was marching to portal 12 at time T, it is now three hours later, so it arrived
after forty minutes and has been fighting the garrison since. This is the same lazy-resolution
trick idle games and offline strategy games have used for years, and it is what makes the cost
sane.

The hard requirement that makes Tier 2 work is **determinism**: resolution must be a pure function
of the stored state, the elapsed time, and a stored seed. No unseeded randomness anywhere. Two
players opening the same region must get the same answer, and the answer must not change depending
on who looked first. This is a constraint on how the combat model is written, and it is much
cheaper to honour from the start than to retrofit.

### Where it runs

This project already has server-authoritative infrastructure: a Cloudflare Durable Object layer
with SQLite behind `server.dreadroot.com`, and a layered architecture plan covering a 20 Hz tick,
binary snapshots, area-of-interest filtering and client prediction. The Kaiju simulation should be
Tier 0 inside that existing plan rather than a parallel system, with Tiers 1 and 2 as a separate,
much cheaper scheduled process — the strategic layer, running on a timer rather than a game loop.

One sequencing note: the master plan for this repo puts NPC runtime and authoring ahead of the
server work. Persistent autonomous Kaiju sit squarely on top of both, so this should be planned as
the thing that comes *after* those, not instead of them.

### The cost warning, stated plainly

Kaiju fighting continuously while nobody watches is a compute bill with no engagement to justify
it. Two things keep it sane, and both are design decisions rather than optimisations:

- **Most Kaiju should be idle most of the time.** Territory that is not contested does not need
  resolving. A world where everything fights constantly is both expensive and, more importantly,
  exhausting to return to.
- **Tier 2 is the default, not the exception.** If the common case ticks, the cost scales with the
  number of Kaiju ever created, which only ever goes up. If the common case is lazy, cost scales
  with the number of players actually looking, which is what we are being paid for.

---

## Suggested build order

1. **The stat model as data**, with the temperament stats wired into `kaijuBrain.ts` as
   consideration weights. Cheap, and it immediately makes two Kaiju feel different.
2. **Obedience as a refunding disadvantage**, tied into the order-bias layer from
   `docs/KAIJU_SEMI_CONTROLLER.md`. This is the axis that makes the whole idea distinctive.
3. **A batch simulator** over the existing headless harness: N builds, round-robin, win rates out.
   This is the balance tool, and everything after it is guesswork without it.
4. **Point costs and per-stat caps**, derived from step 3 rather than chosen.
5. **Breeds** — a dozen hand-designed, simulator-validated presets. Playable before any custom
   designer exists.
6. **The custom designer UI**, which should not be built until 3 to 5 have settled, because it is
   the most expensive thing here and the most painful to rework.
7. **Tier 2 lazy resolution**, deterministic, with the strategic layer on a timer.
8. **Tier 1 coarse simulation**, once there is enough world to need it.

Steps 1 to 5 need no server work at all and produce a complete single-player-facing game loop.
That ordering is deliberate: the economy and the balance are the risky, unproven parts, and they
can be proven entirely offline before committing to the expensive infrastructure.

## Sources

- Pathfinder 2e Building Creatures - https://2e.aonprd.com/Rules.aspx?ID=2874
- Paizo ORC License - https://paizo.com/orclicense
- D&D System Reference Document 5.1 under CC-BY-4.0 - https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf
- Mutants & Masterminds power level caps and trade-offs - https://www.freedomplaybypost.com/start/playguide_35/pl-caps-trade-offs-extra-effort-and-hero-points-r28/
- GURPS overview and the Fallout licensing history - https://en.wikipedia.org/wiki/GURPS
- GURPS disadvantages - https://www.sjgames.com/gurps/roleplayer/Roleplayer1/GURPS-Disads1.html
- Screeps server-side architecture - https://docs.screeps.com/architecture.html
- Screeps open-source server - https://github.com/screeps/screeps
- Spore complexity meter - https://spore.fandom.com/wiki/Complexity_Meter
- Impossible Creatures - https://en.wikipedia.org/wiki/Impossible_Creatures
