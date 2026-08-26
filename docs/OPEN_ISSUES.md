# Open issues — reported 2026-Aug-26

Parked while the frame rate work continues. Ordered by how cheap the fix looks
against how much it hurts.

## 1. Weapons are not rendered in the character's hands at all

The character holds air in a rifle stance. Nothing is drawn.

**The fitting data already exists and is not being used.** Geoff spent
considerable time positioning every weapon in every character's hands, and it
is sitting in `src/components/siege/charlineup/weaponModels.ts`:

- `sizeByChar` — per-character scale, all 9 characters x 14 weapons
- `rotByChar` / `gripByChar` — per-character rotation and grip point
- `leftHand` — the support-hand grip for two-handed weapons
- `animSet` — 'rifle' or 'pistol', which also gave us the hand counts

`heldWeaponFor(itemNumber)` maps an item to its model. The lineup panel and the
Siege self-avatar both use it. The DreadRoot avatar does not attach anything.

Fix: attach the held weapon to the right-hand bone using that data, exactly as
the Siege avatar already does. This is wiring, not new tuning — the numbers are
already correct and re-deriving them would waste the work.

## 2. Shots come from the camera, not the weapon

In third person, bullets and the flame glove originate at the player's eye and
travel from mid-air rather than from the gun. Tracer lines should start at the
MUZZLE of the weapon being held.

Depends on 1: there is no muzzle to fire from until the weapon is attached.

Note the aim direction should still come from the camera — only the visual
origin moves. Firing along the barrel instead would make third person aim
differently from first person, which is worse than the current problem.

## 3. Gravity is roughly half — floating down after a jump

Geoff's guess of "maybe half" matches the code exactly:

    effectiveGravity = 9.8    normal
    effectiveGravity = 4.9    GLIDING          <- exactly half
    effectiveGravity = 2.45   swimming

So the likely cause is not a wrong constant but a STUCK GLIDE. Gliding is
`gKeyHeldRef.current && !onGround`, and that ref is only cleared by a G keyup.
Losing pointer lock, alt-tabbing or any window blur while G is held means the
keyup never arrives and glide stays engaged for the rest of the session — with
gravity permanently halved and no obvious sign why.

Fix: clear the held-key state on blur and on pointer-lock loss. Worth checking
the other held keys for the same hazard while there.

## 4. Parkour climbs the air, four blocks up

Walking into a TWO-block stack and pressing space rises about four blocks and
then plays the climb animation in mid-air.

The first-standable-surface fix (4.352.36) should have addressed the height:
the probe now stops at the first solid block with clear space above it rather
than keeping the highest block within reach. On a two-block stack that returns
a surface at 2, and anything above 2.2 is refused as too tall.

So either that fix is not doing what I think, or the MOVEMENT is wrong rather
than the measurement. The D-Flow TRAVERSAL section now reports exactly what the
probe measured and which move it chose — one report taken right after a bad
climb will separate those two cases immediately, instead of another round of
guessing.

## 5. Bullet tracers from the muzzle

Covered by 2; listed separately because it is the visible symptom Geoff named.
