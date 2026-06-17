// Per-weapon ammo for the equipped weapon, simulating the original Siege Worlds
// (Unity) ammo system in Dreadroot: a CLIP that drains as you fire and reloads (with
// the weapon's reload_time) from a RESERVE POOL.
//
// The reserve is UNLIMITED for now (Infinity) — endless supply — but it's a real pool
// so that ammo packs (bought with points / dropped by monsters) can fill a finite
// reserve later with no further wiring.
//
// max === null → no clip / no weapon → never gates firing.
import { useSyncExternalStore } from 'react';

export interface AmmoState {
  current: number;     // rounds in the clip
  max: number | null;  // clip size (null = no clip / no weapon)
  reserve: number;     // reserve pool feeding reloads; Infinity = unlimited (today)
  reloading: boolean;
}

let state: AmmoState = { current: 0, max: null, reserve: Infinity, reloading: false };
const subs = new Set<() => void>();

function emit(next: AmmoState) {
  state = next;
  subs.forEach((f) => f());
}

export function getAmmo(): AmmoState {
  return state;
}

/** Reset the clip for a newly-equipped weapon (full clip; cancels any reload).
 *  Reserve stays unlimited until the ammo-pack economy lands. */
export function resetAmmoForWeapon(clip: number | null): void {
  emit({ current: clip ?? 0, max: clip, reserve: Infinity, reloading: false });
}

/** Can the equipped weapon fire right now? */
export function canFire(): boolean {
  if (state.reloading) return false;
  return state.max == null || state.current > 0;
}

/** Spend one round from the clip (no-op for unlimited weapons). */
export function consumeAmmo(): void {
  if (state.max == null) return;
  emit({ ...state, current: Math.max(0, state.current - 1) });
}

/** True if a reload is possible (has a clip, not full, not reloading, reserve left). */
export function canReload(): boolean {
  return state.max != null && !state.reloading && state.current < state.max && state.reserve > 0;
}

export function beginReload(): void {
  if (!canReload()) return;
  emit({ ...state, reloading: true });
}

/** Finish a reload: pull rounds from the reserve pool into the clip. */
export function finishReload(): void {
  if (!state.reloading || state.max == null) { emit({ ...state, reloading: false }); return; }
  const need = state.max - state.current;
  const loaded = Math.min(need, state.reserve);
  emit({
    current: state.current + loaded,
    max: state.max,
    reserve: state.reserve - loaded, // Infinity - n = Infinity → stays unlimited
    reloading: false,
  });
}

export function useAmmo(): AmmoState {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getAmmo,
    getAmmo,
  );
}
