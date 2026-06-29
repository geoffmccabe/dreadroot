# Pistol Animation Plan

Goal: get characters holding and using a **one-handed pistol** the same way the rifle works — but a
pistol differs in two ways: it's held in **one hand** (right), and it can be **dual-wielded / fired
while a grenade is armed** (the engine already distinguishes this via `isPistol` on the active
weapon). Everything else reuses the rifle pipeline.

## What we have (10 clips, in `Anim_Pistol/`)
- `Idle_Aiming` — the aim/ready pose
- `Walk_Forward_Aiming`, `Walk_Backward_Aiming`
- `Run_Forward_Aiming`, `Run_Backward_Aiming`
- `Strafe_Left`, `Strafe_Right`
- `Turn_and_Aim`
- `Jump_Up`, `Jump_Forward`

That's a solid **aiming** locomotion set: stand, walk/run fwd+back, strafe, turn, jump.

## Gaps to fill (download from Mixamo, "without skin", In Place where it loops)
Priority order:
1. **Fire / Shooting** — the actual shot + recoil. *Critical — there's no fire clip yet.* (search "Pistol Fire", "Shooting")
2. **Reload** — (search "Reload", "Reloading" pistol)
3. **Idle (non-aim)** — relaxed stand, pistol lowered (search "Pistol Idle")
4. **Walk/Run (non-aim)** — moving with the pistol lowered, for travel vs combat (search "Pistol Walk", "Pistol Run")
5. **Holster / Draw** — put away + draw (search "Pistol Holster", "Draw Pistol") — optional, nice for weapon-switching

Shared, already covered (don't re-download): **falling idle, landing, hit, death** come from the
locomotion/hit-death library; **crawl** likewise.

## Build steps (mirrors the rifle work, low risk)
1. **Library** — run the same `build_anim_library.py` over `Anim_Pistol/*.fbx` → `siege_pistol_anims.glb`
   (keyframe-reduced, ~same size profile as rifle). Merge into the lineup M/N cycle like rifle/loco.
   Bump `CHAR_ASSET_VERSION`.
2. **Held model** — `Scifi Pistol.glb` (or `Pistol.glb`) is already in the model set. Copy to
   `siege/weapons/`, add a `HELD_WEAPONS` registry entry with `animSet: 'pistol'`. The existing
   `LineupWeapon` auto-sizes it; the only new bit is a **one-handed grip** (still attaches to `Hand_R`,
   just a different rotation/length than a rifle). One grip calibration, shared across characters.
3. **Clip-set** — add `PISTOL_AIM` to `locomotionClips.ts` mapping the slots to the pistol clips, so
   the (future) locomotion controller drives a pistol-armed character with no new movement code.
4. **Combat FSM** — a small graph (like the rifle one will be): `aim → fire → (auto-fire loop) → reload`.
   Pistol's `isPistol` flag already lets it fire while a grenade is armed (dual-wield path exists).

## Open decisions (defer until pistol build starts)
- **Which pistol** is "the first pistol" (like the AK47 was the first rifle), and its tiers — I'll
  query the DB for the pistol weapon items + tiers the same way I did for the AK74.
- **Flame glove** rides this same path (you said treat it as a pistol for now): one-handed, right hand,
  pistol clip-set — just a different held model.

## Status
Plan only — no pistol code yet. Build kicks off after the rifle/locomotion/parkour systems are wired
and you've picked the first pistol weapon.
