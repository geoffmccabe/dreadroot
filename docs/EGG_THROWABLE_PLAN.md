# Shpider Eggs → hand-throwable (like grenades) — plan

Goal (Geoff): eggs behave like grenades — drag into a hand, arm, throw, hatch — and the
half-migration gaps (cooldown lost in QA, refund-on-death broken, can't arm an egg already in
a quick-slot) are fixed. REUSE the grenade hand machinery; don't duplicate it.

## Current state

- Grenades: dual-wield HAND system — dragged into a hand (real equip item) → G adopts into the
  `handGrenade` store (kind grenade, armed) + moves the item to a backing QA slot → G throws via
  `grenadeThrowRef` → `consumeGrenade` (consumes QA row) → explode. Right-click disarms.
- Eggs: LEGACY flow — `eggReadySlot` (single armed QS slot), Y to arm, click to throw via
  `eggThrowRef`/`consumeEgg` → `useShpiderEggSystem` hatches a tier-matched pet. NOT on the hand
  system. Cooldown lived on user_inventory rows and is lost once the egg is in a quick-slot.

## Design: one hand-throwable store, two kinds

The `handGrenade` store becomes a generic hand-throwable store via a `kind: 'grenade' | 'egg'`
field (default grenade). The render (EquipSlots overlay + armed red-flash) is already generic.
G acts only on grenade-kind hands; Y acts only on egg-kind hands; right-click disarms either.

## Slices (build + commit each)

1. **Store kind** — add `kind?: 'grenade' | 'egg'` to HandGrenade; add kind-filtered helpers
   (`armedHandsOfKind`, `anyArmedHandOfKind`, `anyHandOfKind`). Keep `armedHandsRightFirst` /
   `anyArmedHandGrenade` kind-AGNOSTIC (used by right-click disarm + fire gates = any throwable).
   Point the GRENADE handler's throw/arm checks at the grenade-kind helpers so a hand egg never
   triggers grenade logic. [additive + grenade-handler retarget]

2. **Eggs into hands** — `resolveDrop` accepts an egg (items.key starts 'shpider_egg') into a
   hand slot so the drag works (egg becomes a real equip item there, shown via its sprite).
   EquipSlots tooltip becomes kind-aware ("Egg T…" vs "Grenade T…").

3. **Y = egg hand flow** — rewrite `handleEggTogglePress` to MIRROR the grenade hand flow:
   adopt a real-equip-slot egg into the hand store (kind egg, armed) + move it to a backing QA
   slot; throw an armed hand egg via `eggThrowRef`; `consumeEgg` reads the armed hand egg.
   Right-click disarm already shared. Drop the legacy `eggReadySlot`-only path.

4. **Cooldown + refund (data)** — add `cooldown_until` to the quick-slot row so the egg's
   recharge timer survives into QA/hand; make refund-on-death QS-aware. (Schema touch on the
   SHARED DB → do last, gated; it's already broken today so not a regression if deferred.)

## Risk

Slice 1 retargets the grenade handler's armed-hand checks — build + smoke the grenade flow after.
Slices 2–3 are egg-only. Slice 4 is a shared-DB schema change (user runs SQL).
