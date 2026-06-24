// Central store for the Rocket Belt (Special slot E5 / equip slot 4).
//   • tier      — the equipped belt's tier (1–10), published by EquipSlots. null = no belt.
//   • max       — max burst charges, computed in Fortress from level + tier + VIP.
//   • available — current burst charges, run at frame time by FortressControls (spend on
//                 Shift+E, regen 1 / 5s). The HUD reads {available, max} to draw the bar.
//
// Mirrors the flameGlove.ts store pattern (module-level + useSyncExternalStore). Using a
// store (not props) keeps level/tier/VIP and the frame-loop runtime decoupled from the HUD.
import { useSyncExternalStore } from 'react';

export interface RocketBeltState { tier: number; } // 1–10

let belt: RocketBeltState | null = null;
let maxBurstsState = 0;
let availableState = 0;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export function getRocketBelt(): RocketBeltState | null { return belt; }

export function setRocketBelt(b: RocketBeltState | null): void {
  if (b === belt) return;
  if (b && belt && b.tier === belt.tier) return;
  belt = b;
  notify();
}

export function getRocketBeltMax(): number { return maxBurstsState; }
export function setRocketBeltMax(n: number): void {
  if (n === maxBurstsState) return;
  maxBurstsState = n;
  notify();
}

export function getRocketBeltAvailable(): number { return availableState; }
export function setRocketBeltAvailable(n: number): void {
  if (n === availableState) return;
  availableState = n;
  notify();
}

export function useRocketBelt(): RocketBeltState | null {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getRocketBelt,
    getRocketBelt,
  );
}

// {available, max} for the HUD bar. Cached object so useSyncExternalStore sees a stable
// reference until a value actually changes (avoids infinite re-render loops).
let chargesCache = { available: 0, max: 0 };
function getChargesSnapshot(): { available: number; max: number } {
  if (chargesCache.available !== availableState || chargesCache.max !== maxBurstsState) {
    chargesCache = { available: availableState, max: maxBurstsState };
  }
  return chargesCache;
}

export function useRocketBeltCharges(): { available: number; max: number } {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getChargesSnapshot,
    getChargesSnapshot,
  );
}
