// siegeThirdPerson — the third-person camera DISTANCE (Siege only). Alt+wheel grows/shrinks it; the
// FortressControls loop pulls the RENDER camera back from the player eye by this much (smoothly
// lerped), while all movement/collision/aim keep using the true eye. 0 = first person (nothing
// changes). Below a small threshold it snaps to 0 so you always settle cleanly into first person.
import { useSyncExternalStore } from 'react';

const MAX = 6;      // furthest the camera pulls back (metres)
const STEP = 0.6;   // per wheel notch
let dist = 0;
let version = 0;
const subs = new Set<() => void>();
const emit = () => { version++; subs.forEach((f) => f()); };

export const getTPDist = (): number => dist;

/** Alt+wheel: dir > 0 = zoom OUT (farther), dir < 0 = zoom IN (closer → first person). */
export function nudgeTPDist(dir: number): void {
  let next = Math.max(0, Math.min(MAX, dist + Math.sign(dir) * STEP));
  if (next < STEP * 0.75) next = 0;   // snap into clean first person
  if (next !== dist) { dist = next; emit(); console.log('[third-person] distance', dist.toFixed(1), dist === 0 ? '(first person)' : ''); }
}

export function setTPDist(d: number): void {
  const n = Math.max(0, Math.min(MAX, d));
  if (n !== dist) { dist = n; emit(); }
}

/** Reactive distance — for the self-avatar's show/hide in first vs third person (Phase 2). */
export function useTPDist(): number {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => dist, () => dist);
}
