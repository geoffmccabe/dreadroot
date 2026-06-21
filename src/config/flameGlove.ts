// Which hand holds the ACTIVE flame glove (dual-wield). A flame glove is ONE-HANDED:
// it can sit in either hand with a pistol/grenade in the other. If a glove is in BOTH
// hands, only the RIGHT one is used (we don't support firing two yet). null = no glove.
// EquipSlots publishes this from E1/E2 (preferring R); FortressControls binds the flame to
// that hand's mouse button (L glove → left button, R glove → right button); FortressScene
// reads the tier for the flame visuals.
import { useSyncExternalStore } from 'react';

export interface FlameGloveState { hand: 'L' | 'R'; tier: number; }

let glove: FlameGloveState | null = null;
const subs = new Set<() => void>();

export function getFlameGlove(): FlameGloveState | null { return glove; }

export function setFlameGlove(g: FlameGloveState | null): void {
  if (g === glove) return;
  if (g && glove && g.hand === glove.hand && g.tier === glove.tier) return;
  glove = g;
  subs.forEach((f) => f());
}

export function useFlameGlove(): FlameGloveState | null {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getFlameGlove,
    getFlameGlove,
  );
}
