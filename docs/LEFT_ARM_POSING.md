# Posing a held weapon and the left arm

## The two things the arrow keys can drive

Press `'` to swap between them. The HUD at the bottom of the screen always says
which one is live, and on which character.

| | arrows | `.` | `,` |
|---|---|---|---|
| **GUN** | move the gun left / right / up / down | toward the character | away |
| **LEFT HAND** | move the grip point left / right / up / down | toward | away |

In LEFT HAND mode there are two extras: `<` `>` swing the elbow round without
moving the hand, and `7` `8` twist the wrist.

That is the whole control set. There is no mode cycling and nothing is doubled up.

## Directions are what you see, not what the skeleton says

The gun's offset is stored along the HAND BONE's own axes, and a hand bone points
wherever the skeleton says — nowhere near screen left/right/up/down. So the left
arrow moved the gun up, the up arrow moved it sideways, and differently per
character. Reported as "the arrow keys are all reversed"; they were worse than
reversed, they were scrambled.

Arrow keys now take a direction the VIEWER means — the camera's right, world up,
the camera's forward flattened — and convert it into each hand's own frame.

Measured, ten taps per key: right `x −0.105`, left `x +0.100`, up `y +0.101`,
down `y −0.108`, `.` `z +0.102`, `,` `z −0.101`. One axis each, no cross-talk. The
camera looks along +Z there, so −X is screen right, which is what the right arrow
gives.

## Why the arm bent the wrong way

Not a broken rig. A two-bone IK solve sets the shoulder and elbow ANGLES from the
distance to the target, but not which way the elbow POINTS — the limb can rotate
freely about the shoulder-to-hand axis with the hand staying exactly where it is.
Something has to choose that rotation, and `solveArmIK` was inheriting it from the
animation clip's own pose. Fine while the grip is near where the clip put the hand;
sends the elbow through the ribcage when it is not, which is why the Rocket
Launcher was the worst case.

Every mainstream rig exposes this control — Blender's IK Pole Target and Pole
Angle, Unity's `SetIKHintPosition(AvatarIKHint.LeftElbow)`, Unreal's TwoBoneIK
Joint Target. It was the missing piece, and it is now on `<` `>`.

Options considered before writing it:

1. **Install `three-ik`.** Rejected. CCD-based, so it replaces a working
   closed-form solver with an iterative one; no clean pole story; unmaintained. A
   permanent dependency for what is fifteen lines of vector maths.
2. **Rewrite as FABRIK with constraints.** Rejected. Far bigger change, and
   closed-form two-bone is what Unreal and Blender use for a two-bone chain. The
   solver was not the problem.
3. **Add the pole angle to the existing solver.** Chosen — the standard method,
   purely additive, no dependency.

Implementation: after the solve, rotate the SHOULDER about the shoulder-to-hand
axis. The hand lies on that axis so it does not move; the elbow swings around it.
Applied last so it cannot disturb the solve. Stored per weapon rather than per
character — the grip is the same spot on the same model for everyone, so the elbow
wants to go the same way for everyone.

Measured on the Rocket Launcher: 20° of swivel moves the elbow **5.07 cm** and the
hand **0.1 cm**. That near-zero hand movement is the proof the axis is right.

## Why there is no shoulder / elbow / wrist ROTATION mode

There was one, and it is still in the code because baked data uses it, but it is
off the front-line controls. Posing an arm by rotating three joints in sequence
means every joint you touch moves everything below it, so the hand drifts off the
gun and you chase it. The IK set — put the hand where you want it, swing the elbow,
twist the wrist — is five numbers, it is complete, and each control does one thing
without disturbing the others.

`!` clears any leftover manual joint offsets for the selected character and weapon.
That matters because those offsets switch the IK off entirely, so one stray nudge
would otherwise disable the hand target permanently with no way back. Switching to
LEFT HAND mode warns when they are present.

## Weapons with no support hand

Pistols use a one-handed animation set, so there is no support hand to place and
LEFT HAND mode does nothing on them. Rifles, shotguns, the launchers and the melee
weapons all use it.

## Out-of-reach grip points

`checkReach()` warns once per character and weapon when a grip point sits further
from the shoulder than the arm can stretch. The solver clamps rather than failing,
so that case quietly produces a straight arm aimed off into space — which reads as
a broken rig rather than as bad data.

Worth a look: the Plasma Sniper's baked grip point is `[5.254, -0.952, -1.271]`
where every other weapon's is inside 43 cm. Those are model-local units and differ
per model, so it is not provably wrong, but it is the outlier by a wide margin and
is the first thing to re-capture with `K` if that weapon looks off.
