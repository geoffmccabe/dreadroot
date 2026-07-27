# The Kaiju semi-controller: commanding a creature that can say no

Ideation for Geoff's request (2026-Jul-27): don't puppet the Kaiju. Tell it what to do by voice or
text, point at where to go, name what to attack — and let it decide whether that is a good idea,
because it does not want to die.

This is a real genre with a real name: **indirect control**. It is not a compromise or a simplified
control scheme; it is its own thing, and the games that have done it are remembered specifically
for it. Worth knowing the shape before designing ours.

| Game | What it did | What to steal |
|---|---|---|
| Black & White (2001) | A creature that learns from praise and punishment, and develops opinions | Obedience as a *stat that changes*, and the creature having preferences you did not choose |
| Pikmin | Throw and whistle, nothing else | A tiny order vocabulary that is completely legible |
| Overlord | "Go there, take that, come back" via one pointer | Click-to-direct as the entire spatial language |
| Brütal Legend | Shouted orders to units mid-combat | Orders that are strategic, not twitch |
| The Sims | Queued wishes, and a free-will slider | Orders as a *queue* the agent works through, and the option to turn autonomy up or down |

The thing that makes all of these work: **the agent is doing something sensible when you are not
talking to it.** We already have that — the utility brain in `src/components/siege/globe/
kaijuBrain.ts` fights, retreats, takes cover and explores on its own. The semi-controller is a
layer that leans on those decisions, not a layer that replaces them.

---

## The central idea: an order is a thumb on the scale, not a command

This is the one design decision everything else follows from.

The obvious implementation is "order arrives, force the action". That gives puppeteering with extra
latency, and it makes the Kaiju's refusal impossible — refusal has to be a special case bolted on,
and it will feel arbitrary.

The right implementation, and the one our architecture already wants: **an order adds a large bonus
to the score of the matching action, and then the normal decision runs.** So:

- "Attack the big one" adds, say, +0.6 to engaging that specific target.
- The Kaiju's own survival considerations are still multiplied in.
- If it is at 15% health against something that outguns it, flee still scores 1.0 and wins.
- It refuses. Not because a rule said "refuse if health low", but because it genuinely evaluated
  the order and something mattered more.

That gives Geoff exactly what he described — "it can decide to or not based on its own idea of
whether it's likely to succeed" — for almost no new machinery. It also means the *degree* of
obedience is a single tunable number, which is where the character lives.

And critically: **we can already explain the refusal**, because every consideration's score is
recorded. The Kaiju can say *"no — I'd lose"* and the tracker panel shows the arithmetic.

## Obedience as the relationship

Make the order bonus a per-Kaiju stat rather than a constant, and the game gets a relationship.

- Starts middling. Your Kaiju is a wild thing that tolerates you.
- Orders that work out (it wins, it survives, it gains territory) raise it.
- Orders that get it badly hurt lower it. It remembers that you told it to charge a losing fight.
- High obedience: it does what you say almost immediately, even when it disagrees.
- Low obedience: it ignores you unless the order happens to match what it already wanted.

This is the Black & White lesson. The creature being *slightly unreliable* is the entire reason
people remember it. A Kaiju that always obeys is a vehicle; a Kaiju that usually obeys is a
character.

There is a second stat worth having: **temperament**, fixed per Kaiju. A reckless one weights its
own survival lower, so it takes orders a cautious one refuses. Portals spawn Kaiju with different
temperaments, which makes *which* Kaiju you got matter.

## The order vocabulary — keep it small and closed

Roughly a dozen order types covers everything in Geoff's description and everything a Kaiju
sensibly does. Small and closed matters for three separate reasons: it can be parsed locally
without an LLM most of the time, it can be shown in a UI, and it can be validated before it runs.

**Spatial**
- *Go there* — click a spot on the globe, it walks there
- *Follow me* / *stay close*
- *Hold position*
- *Look at that* — turn the head, no commitment

**Combat**
- *Attack that* — a named target
- *Leave that alone* — a target it should stop pursuing
- *Back off* — break contact, do not flee outright
- *Retreat* — leave the fight
- *Use the flamethrower* / *use the cannon* — weapon preference

**Standing**
- *Guard that* — a miner, a portal, a spot. Persistent.
- *Take that territory* — persistent goal
- *Do what you want* — clear all orders

Two lifetimes matter. **Immediate** orders expire after a few seconds if not acted on, so a stale
"attack that" doesn't fire thirty seconds later when the situation has changed. **Standing** orders
persist as a permanent bias until replaced. "Always protect the miners" is standing; "hit that one
now" is immediate.

## Pointing at the world

Clicking a spot is the highest value-per-effort piece and needs no AI at all. Raycast from the
camera onto the terrain, get a direction from the planet centre, and that becomes the destination
of a *Go there* order. The ground sampler in `globeGround.ts` already answers "how high is the
terrain in this direction", which is everything a walk-to needs.

*Look at that* deserves calling out separately: a head/upper-body aim that is independent of which
way the body is walking. It is a small piece of animation work and it does more for the illusion of
autonomy than almost anything else, because you can see the creature paying attention to something
before it decides what to do about it. It is also the cheapest possible acknowledgement that an
order was heard.

## Voice and text: the pipeline

The architecture that matters here is: **speech → text → an Order object → the bias layer.** The
language model, if one is involved at all, produces *data we can inspect and reject*. It never
touches the frame loop. This is the same discipline as the behaviour-tree work in
`docs/KAIJU_AI_RESEARCH.md`, and for the same reason.

Recommended shape, in order of what to build:

1. **Text box first.** Type "attack the big one". Everything downstream is identical to voice, and
   it is testable without a microphone. Do not build voice until the order layer is proven.

2. **A local grammar for the common phrasings.** In a fight, most orders are a dozen shapes: attack
   that, back off, over there, follow me, wait, run. A plain pattern matcher handles these with zero
   latency and zero cost, which matters because these are the ones you say under pressure.

3. **An LLM only for the fallback.** Anything the grammar does not recognise goes to a model that
   returns one of the closed order types with parameters, or "I did not understand". Rare, so the
   cost is negligible, and the latency is acceptable because it only happens on unusual phrasings.

4. **Voice on top.** The browser's built-in speech recognition is free and requires no key, and is
   the right thing to prototype with; it is Chrome-centric and its accuracy on shouted single words
   is mediocre. Whisper via the existing DD69 AI gateway would be better and is worth the swap once
   the order layer earns it. Push-to-talk, not always-listening — both for accuracy and because
   nobody wants a hot mic in a game.

**Design around the latency rather than fighting it.** Voice is one to three seconds end to end.
That is fatal in a twitch game and completely fine here, because Kaiju are 300 metres tall and slow
by construction. A fight where two seconds of thinking does not lose it is a fight that suits
spoken orders. This is a case where the physical scale we already chose and the control scheme we
want happen to agree, and we should lean into it rather than trying to make orders feel instant.

## It has to talk back

An order you cannot tell was received is worse than no order. Three channels, cheap to expensive:

- **It looks at you or at the target.** Instant, free, unmistakable.
- **A one-line subtitle.** "Going." / "Not that one — it'd kill me." / "Can't reach it."
- **A roar or a growl** with a different tone for acknowledge, refuse, and struggling.

The refusal line is the one worth writing well, because it is the moment the whole design either
lands or reads as a bug. It must name the reason, and the reason must be the actual winning
consideration from the utility scores — not a generic line. "It's too strong" when powerRatio drove
the refusal; "I'm hurt" when health did. We already compute which consideration won.

## How this lands on what exists

Nothing here needs the architecture rebuilt. Concretely:

- `Perception` gains an `order` field: type, target, destination, age.
- `scoreActions` adds an order bonus to the matching action, scaled by the obedience stat. Every
  other consideration keeps working, including the ones that veto.
- Refusal is not code. It is what happens when the order bonus loses.
- The tracker panel already shows all of it; it gains a line for the current order and whether the
  Kaiju is complying.
- A new module owns parsing text into an Order. The behaviour trees do not change at all.

The one genuinely new piece of runtime work is the *Go there* order, which wants pathfinding on the
sphere. The planners in `src/features/pathfinding/` are already pure over an abstract grid, so this
is a cube-sphere adapter rather than a rewrite. Until that exists, walking straight at the
destination is a serviceable placeholder — on open terrain it is most of the behaviour anyway.

## Suggested order of work

1. Order objects and the bias in `scoreActions`, driven by hard-coded test orders. Prove refusal
   works and that the tracker explains it.
2. Click-to-move, straight-line. Immediately playable.
3. Text box plus the local grammar. The full loop, no AI service involved.
4. Look-at aiming and the subtitle line, so it visibly acknowledges.
5. Obedience stat and the reasons it moves.
6. Voice.
7. LLM fallback parsing, and standing orders that persist across a session.
8. Sphere pathfinding for real *go there*.

Steps 1 to 3 are the whole idea in playable form, and each one is testable headlessly with the same
harness as the arena (`scripts/check-kaiju-arena.ts`) — an order that should be refused can be
asserted as refused, without loading the game.

## The risk worth naming

The failure mode of indirect control is that it feels like **broken direct control**. Players who
read the Kaiju as a vehicle will experience every refusal as unresponsiveness, and every second of
voice latency as lag.

The fix is not better obedience. It is making the Kaiju obviously a creature from the first
moment — it is doing things before you say anything, it looks around, it reacts to being hurt, it
refuses out loud with a reason. If the first thirty seconds read as "this thing is alive and I am
persuading it", the whole design works. If they read as "why won't it move", no amount of tuning
saves it.
