// Siege monster debug toggles — a tiny module-level store (same pattern as
// activeWeapon.ts). Driven by keyboard gestures in SiegeSpawner:
//   • `!hb`        → toggle body + head hitbox wireframes (useSiegeHitboxes)
//   • `PPP` (≤1s)  → freeze all monsters; any `P` while frozen → unfreeze
// Read imperatively in the monster frame loop (getMonstersPaused) and reactively
// in the monster JSX (useSiegeHitboxes).
import { useSyncExternalStore } from 'react';

let hitboxes = false;
let paused = false;
// TESTING aid: when true, ANY headshot counts as a bullseye, so the bullseye
// effects are easy to trigger without hitting the tiny gold box. Default OFF so
// the real (small, head-centered) bullseye box is used in play. Toggle with `!a`.
let bullseyeAnyHead = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getSiegeHitboxes = (): boolean => hitboxes;
export const toggleSiegeHitboxes = (): void => { hitboxes = !hitboxes; emit(); };

export const getBullseyeAnyHead = (): boolean => bullseyeAnyHead;
export const toggleBullseyeAnyHead = (): boolean => { bullseyeAnyHead = !bullseyeAnyHead; emit(); return bullseyeAnyHead; };

export const getMonstersPaused = (): boolean => paused;
export const setMonstersPaused = (v: boolean): void => { if (v === paused) return; paused = v; emit(); };

function subscribe(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }

export function useSiegeHitboxes(): boolean {
  return useSyncExternalStore(subscribe, getSiegeHitboxes, getSiegeHitboxes);
}
