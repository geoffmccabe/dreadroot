// Per-weapon ammo/clip state for the equipped weapon, simulating the Siege Worlds
// ammo system in Dreadroot. Module store (like activeWeapon.ts) so FortressControls
// reads/decrements it at fire time and the HUD reads it for the ammo counter.
//
// max === null  → unlimited (no weapon, or a weapon with no clip) → never gates firing.
import { useSyncExternalStore } from 'react';

export interface AmmoState {
  current: number;
  max: number | null;
  reloading: boolean;
}

let state: AmmoState = { current: 0, max: null, reloading: false };
const subs = new Set<() => void>();

function emit(next: AmmoState) {
  state = next;
  subs.forEach((f) => f());
}

export function getAmmo(): AmmoState {
  return state;
}

/** Reset the clip for a newly-equipped weapon (full clip; cancels any reload). */
export function resetAmmoForWeapon(clip: number | null): void {
  emit({ current: clip ?? 0, max: clip, reloading: false });
}

/** Can the equipped weapon fire right now? */
export function canFire(): boolean {
  if (state.reloading) return false;
  return state.max == null || state.current > 0;
}

/** Spend one round (no-op for unlimited weapons). */
export function consumeAmmo(): void {
  if (state.max == null) return;
  emit({ ...state, current: Math.max(0, state.current - 1) });
}

/** True if a reload should be possible (has a clip, not full, not already reloading). */
export function canReload(): boolean {
  return state.max != null && !state.reloading && state.current < state.max;
}

export function beginReload(): void {
  if (!canReload()) return;
  emit({ ...state, reloading: true });
}

export function finishReload(): void {
  if (!state.reloading) return;
  emit({ current: state.max ?? 0, max: state.max, reloading: false });
}

export function useAmmo(): AmmoState {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getAmmo,
    getAmmo,
  );
}
