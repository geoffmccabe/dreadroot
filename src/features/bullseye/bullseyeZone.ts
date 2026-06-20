// Bullseye zone sizing — cross-game (SWW / DreadRoot / Pinkland). The bullseye box
// is the head box scaled by a percentage that SHRINKS for bigger enemies, so a
// giant with a huge head still has a small, hard-to-hit bullseye (no easy 4×).
//
// Percentage is keyed by the enemy's MAX dimension (the larger of height or
// footprint length, in metres):
//   0–4m → 30% · 4–6m → 20% · 6–8m → 15% · 8–10m → 10% · 10–15m → 6% · 15m+ → 3%

export function bullseyePct(maxDimMeters: number): number {
  if (maxDimMeters < 4) return 0.30;
  if (maxDimMeters < 6) return 0.20;
  if (maxDimMeters < 8) return 0.15;
  if (maxDimMeters < 10) return 0.10;
  if (maxDimMeters < 15) return 0.06;
  return 0.03;
}

/** Which zone a bullet hit landed in. Body = 1×, headshot = 2×, bullseye = 4×. */
export type HitZone = 'body' | 'headshot' | 'bullseye';

export const ZONE_DAMAGE_MULT: Record<HitZone, number> = {
  body: 1,
  headshot: 2,
  bullseye: 4,
};

// ── Bullseye SIZE factor ─────────────────────────────────────────────────────
// A global multiplier on the bullseye box size, built from named contributors
// multiplied together (default 1×). Lets roles + items/devices enlarge the box:
//   setBullseyeFactor('role', 2)        → superadmin: double-size
//   setBullseyeFactor('aim-device', 1.5)→ a "Bullseye device" item: +50%
// Set a contributor to 1 (or null) to remove it. Cross-game.
import { useSyncExternalStore } from 'react';

const _contributors = new Map<string, number>();
let _factor = 1;
const _subs = new Set<() => void>();
function _recompute() { let f = 1; for (const v of _contributors.values()) f *= v; _factor = f; _subs.forEach((s) => s()); }

export function setBullseyeFactor(name: string, mult: number | null): void {
  if (mult == null || mult === 1) _contributors.delete(name); else _contributors.set(name, mult);
  _recompute();
}
export function getBullseyeFactor(): number { return _factor; }
export function useBullseyeFactor(): number {
  return useSyncExternalStore((cb) => { _subs.add(cb); return () => { _subs.delete(cb); }; }, getBullseyeFactor, getBullseyeFactor);
}

/** Effective bullseye pct after the global size factor, clamped so the box can
 *  never exceed the head box (pct 1 = the whole head counts as bullseye). */
export function effectiveBullseyePct(basePct: number): number {
  return Math.min(1, Math.max(0, basePct * _factor));
}
