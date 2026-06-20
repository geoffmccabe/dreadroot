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
