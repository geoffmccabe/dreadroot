// Hand-grenade state for dual-wielding. Grenades stay physically in Quick-Access
// (reusing the existing storage / throw / consume machinery), but when assigned to a
// hand they are DISPLAYED in that hand's equip box (an overlay in EquipSlots, like the
// rifle icon) and thrown with G. Two grenades = one per hand.
//
// `armed` = pin pulled, ready to throw. Filling a hand auto-arms; right-click
// deactivates (pin back in, stays in the hand, armed=false); G re-arms it.
import { useSyncExternalStore } from 'react';

export type Hand = 'L' | 'R';
export type ThrowableKind = 'grenade' | 'egg';
export interface HandGrenade {
  qsSlot: number;            // the quick_select slot the item lives in (consume target)
  tier: number;              // throw scales with tier
  spriteUrl: string | null;  // shown in the hand box
  armed: boolean;            // pin pulled → next G (grenade) / Y (egg) throws it
  kind?: ThrowableKind;      // what's in the hand (default 'grenade'). Egg hatches; grenade explodes.
}

/** A hand-throwable's kind (legacy entries without the field are grenades). */
export function handKind(hg: HandGrenade | null): ThrowableKind | null {
  return hg ? (hg.kind ?? 'grenade') : null;
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

/** True if either hand holds a throwable (armed or not) — ANY kind. */
export function anyHandGrenade(): boolean { return !!(state.L || state.R); }

/** True if either hand holds an ARMED throwable — ANY kind (gates firing / right-click). */
export function anyArmedHandGrenade(): boolean { return !!((state.L && state.L.armed) || (state.R && state.R.armed)); }

/** Hands holding an ARMED throwable, RIGHT first — ANY kind (right-click disarm order). */
export function armedHandsRightFirst(): Hand[] {
  const out: Hand[] = [];
  if (state.R && state.R.armed) out.push('R');
  if (state.L && state.L.armed) out.push('L');
  return out;
}

// ── Kind-filtered variants — the G (grenade) and Y (egg) handlers use these so each only acts
//    on its OWN kind (a hand egg never triggers grenade throw logic, and vice-versa). ──
/** Hands holding a throwable of `kind` (armed or not), RIGHT first. */
export function handsOfKindRightFirst(kind: ThrowableKind): Hand[] {
  const out: Hand[] = [];
  if (state.R && handKind(state.R) === kind) out.push('R');
  if (state.L && handKind(state.L) === kind) out.push('L');
  return out;
}
/** Hands holding an ARMED throwable of `kind`, RIGHT first (throw order). */
export function armedHandsOfKindRightFirst(kind: ThrowableKind): Hand[] {
  return handsOfKindRightFirst(kind).filter((h) => state[h]!.armed);
}
/** True if either hand holds an ARMED throwable of `kind`. */
export function anyArmedHandOfKind(kind: ThrowableKind): boolean { return armedHandsOfKindRightFirst(kind).length > 0; }

export function useHandGrenades(): HandGrenadeState {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getHandGrenades,
    getHandGrenades,
  );
}
