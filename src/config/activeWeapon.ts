// The player's currently-equipped weapon, expressed as the Siege Worlds weapon_stats
// that Dreadroot SIMULATES (sound, fire rate, damage, etc.). SW is the source of truth;
// Dreadroot reads these to make the gun behave like that SW weapon, with no model shown.
//
// Module-level store (like activeGame.ts) so the firing code (FortressControls,
// useFortressFrameLoop) can read it imperatively at fire/hit time without prop-threading.
import { useSyncExternalStore } from 'react';

export interface ActiveWeaponStats {
  itemNumber: number;
  name: string;
  shootCooldown: number;     // seconds between shots
  maxDamage: number;
  fireSound: string | null;  // game_sounds sound_key
  emptySound: string | null;
  reloadSound: string | null;
  isAutomatic: boolean;
  // One-handed pistol → can fire while a grenade is armed (dual-wield). A rifle
  // (default) can't: with a grenade armed, clicking does nothing (throw with G).
  isPistol?: boolean | null;
  ammoClipAmount: number | null;
  reloadTime: number | null;
  projectile: string | null; // type string (Normal_Bullet, shotgun, rocket_shell…)
  bulletsPerTap: number | null;
  horizontalSpread: number | null;
  verticalSpread: number | null;
  recoilDuration: number | null;
  // Phase 2 recoil (optional — fall back to defaults in the fire code if the
  // weapon_stats columns aren't set yet).
  recoilPitch?: number | null;     // degrees the view kicks UP per shot
  recoilYaw?: number | null;       // degrees of random horizontal kick per shot
  adsRecoilScale?: number | null;  // 0–1 recoil multiplier while aiming (default 0.4)
  // Phase 3 ADS / zoom (optional).
  scopedFov?: number | null;       // FOV when aiming (null → base − 25 default)
  zoomSpeed?: number | null;       // FOV lerp rate (null → default)
  isSniper?: boolean | null;       // hides arms at full zoom; uses scope overlay
  scopeGraphicUrl?: string | null; // per-weapon full-screen scope overlay image
}

let active: ActiveWeaponStats | null = null;
const subs = new Set<() => void>();

export function getActiveWeapon(): ActiveWeaponStats | null {
  return active;
}

export function setActiveWeapon(w: ActiveWeaponStats | null): void {
  if (w === active) return;
  // Skip churn if the same weapon is set again.
  if (w && active && w.itemNumber === active.itemNumber) return;
  active = w;
  subs.forEach((f) => f());
}

export function useActiveWeapon(): ActiveWeaponStats | null {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getActiveWeapon,
    getActiveWeapon,
  );
}
