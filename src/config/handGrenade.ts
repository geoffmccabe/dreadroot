// Hand-grenade state for dual-wielding. Grenades stay physically in Quick-Access
// (reusing the existing storage / throw / consume machinery), but when assigned to a
// hand they are DISPLAYED in that hand's equip box (an overlay in EquipSlots, like the
// rifle icon) and thrown with G. Two grenades = one per hand.
//
// `armed` = pin pulled, ready to throw. Filling a hand auto-arms; right-click
// deactivates (pin back in, stays in the hand, armed=false); G re-arms it.
import { useSyncExternalStore } from 'react';

export type Hand = 'L' | 'R';
export interface HandGrenade {
  qsSlot: number;            // the quick_select slot the grenade item lives in (consume target)
  tier: number;              // throw scales with tier
  spriteUrl: string | null;  // shown in the hand box
  armed: boolean;            // pin pulled → next G throws it
}

interface HandGrenadeState { L: HandGrenade | null; R: HandGrenade | null; }
let state: HandGrenadeState = { L: null, R: null };
const subs = new Set<() => void>();

export function getHandGrenades(): HandGrenadeState { return state; }

export function setHandGrenade(hand: Hand, v: HandGrenade | null): void {
  if (state[hand] === v) return;
  state = { ...state, [hand]: v };
  subs.forEach((f) => f());
}

export function clearHandGrenades(): void {
  if (!state.L && !state.R) return;
  state = { L: null, R: null };
  subs.forEach((f) => f());
}

/** True if either hand holds a grenade (armed or not). */
export function anyHandGrenade(): boolean { return !!(state.L || state.R); }

/** True if either hand holds an ARMED grenade (gates firing / right-click). */
export function anyArmedHandGrenade(): boolean { return !!((state.L && state.L.armed) || (state.R && state.R.armed)); }

/** Hands holding an ARMED grenade, RIGHT first (throw order). */
export function armedHandsRightFirst(): Hand[] {
  const out: Hand[] = [];
  if (state.R && state.R.armed) out.push('R');
  if (state.L && state.L.armed) out.push('L');
  return out;
}

export function useHandGrenades(): HandGrenadeState {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getHandGrenades,
    getHandGrenades,
  );
}
