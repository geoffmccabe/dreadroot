# Posing the left arm on a held weapon

## The bug this was written for

On the Rocket Launcher (and others) every character's left arm bent the wrong way
— elbow through the ribcage, forearm folded backwards.

That is not a broken rig or a bad model. It is the classic missing piece in a
two-bone IK setup: **there was no pole target.**

A two-bone solve fixes the shoulder and elbow ANGLES from the distance to the
target. It does not fix which way the elbow POINTS — the whole arm can rotate
freely about the shoulder-to-hand axis with the hand staying exactly where it is.
Something has to choose that rotation. `solveArmIK` was taking it from the
animation clip's own pose:

    // bend axis = normal of the shoulder-elbow-hand plane (keeps the current elbow direction)
    _axis.copy(_dAB).cross(_dAC);

That works while the grip point is near where the clip already put the hand. Move
the target somewhere the clip never anticipated — a rocket launcher's foregrip,
way forward and low — and the inherited plane sends the elbow somewhere anatomy
does not go.

## What was chosen, and why not a library

This is a solved problem and every mainstream rig exposes the same control:

| system | what it is called |
|---|---|
| Blender | IK constraint → Pole Target + Pole Angle |
| Unity | `SetIKHintPosition(AvatarIKHint.LeftElbow, …)` |
| Unreal | TwoBoneIK node → Joint Target |
| three-ik / ikjs | pole / hinge constraint |

Options considered:

1. **Install `three-ik`.** Rejected. It is CCD/FABRIK-based, so it would replace a
   working closed-form solver with an iterative one, it has no clean pole story,
   and it is an unmaintained package — a dependency to verify and carry forever
   for a control that is about fifteen lines of vector maths.
2. **Rewrite as FABRIK with constraints.** Rejected. Much bigger change, and
   closed-form two-bone is exactly what Unreal's TwoBoneIK and Blender's solver
   use for a two-bone chain. The existing solver is not the problem.
3. **Add the pole angle to the existing solver.** Chosen. It is the standard
   method, it is additive, and it needs no dependency.

## How the swivel works

After the two-bone solve, rotate the SHOULDER about the shoulder-to-hand axis. The
hand lies on that axis, so it does not move; the elbow swings around it. Applied
last, so it cannot disturb the solve.

Measured: 20° of swivel moves the elbow **5.1 cm** and the hand **0.2 mm**. That
near-zero hand movement is the check that the axis is right — if the hand moves,
the axis is wrong.

Stored per weapon, not per character: the grip point is the same spot on the same
model for everyone, so the elbow wants to go the same way for everyone.

## The controls

`<` and `>` cycle the edit mode. The mode and its keys are shown in the HUD at the
bottom of the screen, because three posing tools share the arrow keys and a key
acting on the wrong one is indistinguishable from a key that does nothing.

| mode | arrows | `,` `.` |
|---|---|---|
| GUN POSITION | move the gun X / Y | depth |
| LEFT HAND (IK) | move the grip point X / Y | depth |
| ELBOW SWIVEL | left/right swing the elbow | — |
| SHOULDER (FK) | rotate X / Y | rotate Z |
| FOREARM (FK) | rotate X / Y | rotate Z |
| WRIST (FK) | rotate X / Y | rotate Z |

Also: `K` aims at the gun to set the grip point from scratch, `7` / `8` twist the
wrist, `!` clears the manual FK offsets.

## The FK / IK trap

`hasArmFK()` gates the IK off entirely — one manual joint nudge and the hand target
stops driving the arm, permanently, with no way back short of clearing
localStorage. That is why `!` exists, and why switching to LEFT HAND or ELBOW mode
warns when FK offsets are present.

## Out-of-reach grip points

`checkReach()` warns once per character+weapon when a grip point sits further from
the shoulder than the arm can reach. The solver clamps rather than failing, so an
out-of-reach target quietly gives a straight arm aimed off into space — which reads
as a broken rig rather than as bad data.

Worth a look: the Plasma Sniper's baked grip point is `[5.254, -0.952, -1.271]`
where every other weapon's is inside 43 cm. Those are model-local units and differ
per model, so it is not provably wrong — but it is the outlier by a wide margin and
is the first thing to re-capture with `K` if that weapon looks off.
