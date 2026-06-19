# Weapon Feel Replication Plan (SWW Unity → Dreadroot three.js)

Goal: bring Dreadroot gun feel up to parity with the Siege Worlds Unity build —
**automatic hold-to-fire, per-shot recoil, and aim-down-sights (ADS) zoom with a
per-weapon scope graphic** — all data-driven from `weapon_stats` so creators tune
each gun without code.

Shared engine note: same firing code serves DreadRoot + SWW. Keep everything
gated by `weapon_stats` fields so a weapon with the field unset behaves exactly
as today (no regressions).

---

## 1. Current state (Dreadroot audit)

Firing lives in `src/components/fortress/FortressControls.tsx`:
- `handleClick` (~959–1151) is the **only** fire entry point — `click`-event driven,
  one shot per click. Cooldown gate at ~1117–1122 (`shootCooldown`).
- Camera orientation = `yaw`/`pitch` refs (210–211), applied as Euler each frame
  (~847–850). **Clean hook point for recoil.**
- `leftMouseDownRef` exists but is wired only to tree-chopping (~2082), not firing.

`src/components/FirstPersonArms.tsx` already has the ADS scaffold:
- FOV zoom works: damps camera.fov to `base − 25` when `isAimingRef` is true (91–98).
- Weapon-model ADS position offset exists via `aimProgress` (88–112).
- **Nothing ever sets `isAiming = true`** — no trigger wired. No per-weapon zoom amount.

`src/config/activeWeapon.ts` weapon object — fields already flowing from
`weapon_stats` but **unused** by firing code today:
`isAutomatic`, `bulletsPerTap`, `horizontalSpread`, `verticalSpread`,
`recoilDuration`, `projectile`.

---

## 2. SWW Unity reference model (what we're matching)

**Automatic fire** (`Player.Shoot`): input is `isAutomatic ? FireKeyPressed (held) :
FireKeyPressedThisFrame`. Gated by `Time.time − lastShotTime > shootCooldown`.
Burst variant (`isBurstFire`) = coroutine firing `bulletsPerTap` rounds spaced by
`timeBetweenShots`.

**Recoil = TWO layers** (`WeaponController`):
- *Weapon transform kick* (`ApplyKickback`): `zKickback` (back), `xTwist`/`yTwist`
  (rotation), each `Random.Range(min,max)` per shot; returns via `SmoothDamp` over
  `recoveryTime`.
- *Camera kick* (`LerpCameraRecoil` → `Player.ApplyRecoil`): adds to desired yaw/pitch
  over `recoilDuration`; `cameraRecoil` Vector2 (x=yaw, y=pitch), pitch randomized.
- Context-aware: separate `aimedRecoil` vs `hipFireRecoil` configs (aiming kicks less).

**ADS / zoom** (`WeaponController.AimWeapon`): right-mouse (hold or toggle via setting).
`camera.fieldOfView` SmoothDamps to `scopedFOV` at `zoomSpeed`; back to `normalFOV` on
release. Snipers: UI scope sprite fades in (`crosshairChangeTime`), **lens distortion
0.7 + depth-of-field**, arms/weapon model hidden at full zoom.

**Spread** (`UpdateBulletSpreadState`): base × 2 while moving, × 0.5 just after firing
(non-aimed), × 0 when aiming (shotguns exempt). Applied as screen-space offset on the
aim ray; aiming fires from exact screen center.

**Other feel**: muzzle flash VFX, shell-casing particles, EZCameraShake
(magnitude/roughness/fadeIn/Out), weapon sway following mouse look, dynamic crosshair
(expands on move/fire, contracts back).

**Full per-weapon schema** (Unity `Weapon.cs`): see Appendix A.

---

## 3. Schema gap — `weapon_stats` columns to add

`weapon_stats` is dashboard-created (not in repo migrations). Columns we already have:
`shoot_cooldown, max_damage, fire_sound, empty_sound, reload_sound, is_automatic,
ammo_clip_amount, reload_time, projectile, bullets_per_tap, horizontal_spread,
vertical_spread, recoil_duration`.

Need to ADD (nullable, so unset = current behavior):
- Recoil: `camera_recoil_pitch` (deg up/shot), `camera_recoil_yaw` (deg, randomized ±),
  `recoil_recovery_time` (s), `weapon_kick_z` (m back), `weapon_kick_twist` (deg).
- Aim: `scoped_fov` (deg; null → use base−25 default), `zoom_speed` (lerp rate),
  `is_sniper` (bool), `scope_graphic_url` (per-weapon scope overlay image),
  `ads_recoil_scale` (0–1 multiplier when aiming).
- Fire modes: `is_burst_fire` (bool), `time_between_shots` (s), `effective_range` (m).
- Optional polish: `shake_magnitude`, `shake_roughness`, `reticle_type`.

SQL delivered per-phase (copy/paste) when that phase is implemented — not all at once.

---

## 4. Phased plan

### Phase 1 — Automatic hold-to-fire  *(the active bug; highest value, smallest change)*
- Refactor firing from `click` to **pointerdown + frame-loop repeat**:
  - On left pointerdown over crosshairs with a gun equipped: fire once, set a
    `firingHeldRef`.
  - In the frame loop: if `firingHeldRef && isAutomatic && now − lastFireTime ≥
    shootCooldown` → fire again. Semi-auto = one shot per press (no repeat).
  - Pointerup / crosshair-hidden / reload clears `firingHeldRef`.
- Fold in `bulletsPerTap` here (spawn N pellets/shot) since it shares the fire call.
- Keep single-tap path identical for semi-auto so nothing regresses.
- Files: `FortressControls.tsx` (fire handler + frame loop), reuse existing
  `calculateSpreadDirection`.

### Phase 2 — Per-shot recoil
- **2a Camera kick** (most-felt): on each shot, `pitch.current −= cameraRecoilPitch`
  and `yaw.current += random(±cameraRecoilYaw)`; decay back toward the pre-recoil aim
  over `recoil_recovery_time` in the frame loop (track an accumulated-recoil ref so we
  don't fight player mouse-look). Scale by `ads_recoil_scale` when aiming.
- **2b Weapon-transform kick** (visual): a kickback pivot in `FirstPersonArms.tsx` —
  translate `−z` and twist on fire, `SmoothDamp`-style return. Pure cosmetic.
- Files: `FortressControls.tsx` (2a), `FirstPersonArms.tsx` (2b).

### Phase 3 — ADS / zoom trigger + sequence
- Wire **right-mouse** → `isAiming` (hold by default; respect a toggle setting later).
  Thread the aim state into `FirstPersonArms` (already consumes `isAimingRef`).
- Per-weapon `scoped_fov` / `zoom_speed` instead of the hardcoded `base−25` / `8`.
- Spread reduction when aiming (× 0, shotguns exempt) + the moving/post-fire multipliers.
- Files: `FortressControls.tsx` (right-mouse, aim state, spread), `FirstPersonArms.tsx`
  (per-weapon FOV), `activeWeapon.ts` (+ fields).

### Phase 4 — Per-weapon scope graphic + sniper polish  *(the "zoom graphic per weapon")*
- When aiming a weapon with `scope_graphic_url` (or `is_sniper`): fade in a full-screen
  scope overlay image (styled per game CSS, rendered in DOM outside the Canvas per the
  R3F-overlay rule), hide the first-person arms/weapon at full zoom.
- Optional: vignette / lens-distortion post-process for the tunnel-vision feel.
- Per-weapon zoom amount already from Phase 3 `scoped_fov`.
- Files: new small `ScopeOverlay.tsx` (DOM overlay subscribing to an aim store),
  `FirstPersonArms.tsx` (hide arms when sniper+aimed).

### Phase 5 — Feel polish (optional, after the above land)
- Muzzle flash, shell-casing particles, camera shake, weapon sway, dynamic crosshair,
  burst-fire mode (`is_burst_fire` + `time_between_shots`).

---

## 4b. Status (shipped)
- ✅ **Phase 1** (v4.75.0): automatic hold-to-fire + bullets share path; weapon-equipped disables chop.
- ✅ **Phase 2a** (v4.76.0): camera recoil — view kicks up + random yaw per shot, recovers each frame;
  per-weapon `camera_recoil_pitch/yaw`, reduced while aiming (`ads_recoil_scale`). 2b weapon-model kick = deferred polish.
- ✅ **Phase 3** (v4.76.0): ADS zoom — right-mouse (combat mode) lerps FOV to `scoped_fov`
  (default base−25) at `zoom_speed`; driven in FortressControls since FirstPersonArms is disabled.
  Reuses FortressScene's existing aim state via new `aimState` store.
- ✅ **Phase 4** (v4.76.0): per-weapon scope overlay (`ScopeOverlay.tsx`) — fades in `scope_graphic_url`,
  or a generic tunnel-vision vignette+reticle for `is_sniper`, when aiming.
- ✅ **Audit fix** (v4.76.1): ADS FOV no longer drifts the resting FOV (only managed during an aim
  cycle, returns to the exact pre-aim value); recoil pitch clamped under ±90° (no camera flip).
- ✅ **Spread + multi-pellet** (v4.77.0): `bulletsPerTap` pellets per shot within the weapon's
  horizontal/vertical spread cone; dynamic accuracy — zero when aiming (single-pellet = pinpoint ADS),
  ×2 while moving, base otherwise; shotguns always cone.
- ✅ **Dynamic crosshair** (v4.78.0): reticle contracts when aiming (tracks the accuracy change).
- ⬜ Remaining (blocked or low-value):
  - **Muzzle flash / shell casings / weapon-model kick / sway** — need the first-person weapon model,
    which is intentionally disabled (`FirstPersonArms` behind `{false &&}`). Deferred until/if a gun
    model is shown.
  - **Burst fire** (`is_burst_fire` + `time_between_shots`) — needs two more `weapon_stats` columns; few
    weapons use it. Easy to add on request.
  - **FOV slider → camera** — the in-game FOV setting doesn't move the camera (same disabled-arms cause).
    Now that the controls loop owns FOV, this is a small wire-up if wanted.

New optional `weapon_stats` columns these read (nullable; unset = sensible defaults):
`camera_recoil_pitch, camera_recoil_yaw, ads_recoil_scale, scoped_fov, zoom_speed, is_sniper, scope_graphic_url`.

## 5. Recommended order & rationale
1. **Phase 1** first — fixes the reported AK hold-to-fire bug, self-contained.
2. **Phase 2a** — recoil is the headline "feel" ask; camera kick is the big win.
3. **Phase 3** — ADS trigger (scaffold already exists, low effort, high payoff).
4. **Phase 4** — the per-weapon scope graphic the user explicitly wants.
5. **2b / Phase 5** — polish passes.

Each phase ships behind data fields → no regression when unset, and can be tested
independently before the next.

---

## Appendix A — Full SWW per-weapon fields (for column design)
Gun: `isGun, projectile, projectileFireHit, ammoClipAmount, effectiveRange, reloadTime,
shootCooldown, bulletsPerTap, timeBetweenShots, reticletype`.
Modes: `isAutomatic, isBurstFire, isShotgun, isSniper, isRocketLauncher`.
Recoil cfg (hip & aimed): `zKickback{min,max}, xTwist{min,max}, yTwist{min,max},
recoveryTime, Push`; plus `cameraRecoil(x,y), recoilDuration, horizontalSpread,
verticleSpread`.
Aim: `zoomSpeed, scopedFOV, normalFOV, crosshairChangeTime`.
Sounds: `fireSound, emptySound, reloadSound`.
Shake/VFX: `Magnitude, Roughness, fadeInTime, fadeOutTime`.
Range struct sampled per-shot: `Random.Range(Min,Max)`.
Spread runtime: ×2 moving, ×0.5 post-fire (non-aim), ×0 aiming (shotguns exempt).
</content>
</invoke>
