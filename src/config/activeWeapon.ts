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
  ammoClipAmount: number | null;
  reloadTime: number | null;
  projectile: string | null; // type string (Normal_Bullet, shotgun, rocket_shell…)
  bulletsPerTap: number | null;
  horizontalSpread: number | null;
  verticalSpread: number | null;
  recoilDuration: number | null;
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
