// The Rocket Belt currently equipped in the Special slot (E5 in the UI / equip slot 4).
// A Rocket Belt grants a FORWARD jet boost (the admin Shift+E super-sprint effect, but
// fuel-metered for normal players). EquipSlots publishes the equipped tier here; the
// movement code in FortressControls reads it imperatively at frame time to decide whether
// Shift+E boosts the player and to meter the per-minute fuel budget. null = no belt worn.
//
// Mirrors the flameGlove.ts store pattern (module-level + useSyncExternalStore).
import { useSyncExternalStore } from 'react';

export interface RocketBeltState { tier: number; } // 1–10

let belt: RocketBeltState | null = null;
const subs = new Set<() => void>();

export function getRocketBelt(): RocketBeltState | null { return belt; }

export function setRocketBelt(b: RocketBeltState | null): void {
  if (b === belt) return;
  if (b && belt && b.tier === belt.tier) return;
  belt = b;
  subs.forEach((f) => f());
}

export function useRocketBelt(): RocketBeltState | null {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getRocketBelt,
    getRocketBelt,
  );
}
