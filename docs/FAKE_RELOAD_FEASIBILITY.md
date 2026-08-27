# Faking a pistol reload — feasibility

Question: with no pistol reload clip for the Mixamo rig, can we fake one by
swinging the NON-FIRING hand down to the belt and back, ~1s each way?

**Verdict: yes, and it is cheaper and more robust than sourcing a clip.**
Recommended.

## Why it works here specifically

**It can be a generated animation clip, not special-case code.** Three.js clips
are just named tracks of keyframes. A clip can be built in code — a handful of
rotation keys on the left arm — and handed to the existing action layer, which
already knows how to play a reload: upper-body only, additive, one-shot,
outranking a shot but not a death. Nothing new has to understand it.

**Rotation-only means it fits every character.** This is the important part.
The nine characters have very different proportions — Fluffer is 2.22m,
Jeanette 1.75m — so any faked motion expressed as hand POSITIONS would need
per-character tuning, and would break the moment a character was rescaled.
Angles do not care about limb length: the same shoulder and elbow rotation puts
any of them at their own hip. This is the same reason rotation-only retargeting
fixed Flamma.

**The bones exist and are identically named on all six pilots** — verified:
LeftShoulder, LeftArm, LeftForeArm, LeftHand on every one. No per-model
mapping.

**Additive means it composes.** It layers over whatever the legs are doing, so
a reload while walking or running keeps the walk. That already works for shoot.

## What it will and will not look like

It will read as: the support hand leaves the weapon, drops toward the hip,
comes back. At a glance, during combat, that is a reload.

It will NOT have: a magazine model, the weapon tilting to receive it, the slide
being racked, or fingers closing on anything. Nobody watching a firefight will
notice. Anyone standing still and staring will.

Given the alternative is NO reload animation at all, that trade is clearly
worth making.

## Timing

Geoff suggested ~2s, 1s each way. Two notes from the data rather than taste:

- The **weapons carry real reload times** in `properties->'sw'->'reloadTime'` —
  a Basic Pistol is 1.15s, not 2. The fake should be SCALED to the actual
  weapon's reload, or the animation will still be moving after the gun is
  loaded, or finish early and stand idle. Playback rate is one number.
- Weight the motion so the hand goes down slightly faster than it returns.
  Grabbing is a snatch; seating a magazine is deliberate. Equal halves read as
  a robot.

## Cost

Small. One function that builds the clip, a table of four or five rotation
keys, and one line to register it alongside the other action clips. The action
layer, the additive path and the trigger all already exist — reload is already
wired, it just resolves to a rifle clip today.

## Risks, honestly

- **The pose has to be authored by eye.** I cannot see the result, so the first
  numbers will be a guess and will need a look. That is the whole cost, and it
  is why the keys belong in one small table rather than scattered.
- **The left hand may be holding something** — a flame glove, a grenade. Moving
  that hand to the belt while it holds a glove looks wrong. Worth gating to
  "the off hand is empty or holds nothing that renders".
- **Two-handed weapons.** A rifle reload with only the support hand moving is
  less convincing than for a pistol, and the Mixamo rig already HAS proper
  rifle reload clips. This should apply to the PISTOL stance only.

## Recommendation

Build it for the pistol stance, scale it from the weapon's own reloadTime, skip
it when the off hand is visibly holding something, and keep the keyframes in
one table so tuning is a number change rather than a rewrite.
