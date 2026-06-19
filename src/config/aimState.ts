// Aim-down-sights (ADS) state — a tiny module-level store, same pattern as
// activeWeapon.ts. FortressScene writes it from the right-mouse handler; the
// camera/FOV frame loop (FortressControls) and the scope overlay read it
// without prop-threading across the scene graph.
import { useSyncExternalStore } from 'react';

let aiming = false;
const subs = new Set<() => void>();

export function getAiming(): boolean {
  return aiming;
}

export function setAiming(v: boolean): void {
  if (v === aiming) return;
  aiming = v;
  subs.forEach((f) => f());
}

export function useAiming(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getAiming,
    getAiming,
  );
}
