// obstacleDetector — the "what do I do at this object?" brain. Given a PROBE of the thing ahead
// (how tall, how deep, is there a gap underneath, does the ground fall away), it returns the parkour
// ACTION to take. Pure + side-effect-free so it's trivially testable and reusable: the lineup demo
// feeds it synthetic obstacles today; a real moving player feeds it raycast results later — same
// function, same thresholds.
//
// Thresholds line up with the clips we actually have (…_Over_1m / …_Over_2m / …_Under_1m), so the
// classifier never picks a move we can't animate.

export type ParkourAction =
  | 'none'       // nothing in the way → keep moving
  | 'stepUp'     // low lip → step up (no special clip; tiny hop)
  | 'vaultLow'   // ~1m obstacle, thin enough → vault/kick-jump over
  | 'vaultHigh'  // ~2m obstacle → dive over the top
  | 'slideUnder' // overhead bar with a passable gap below → slide under
  | 'dropRoll'   // ground falls away → drop off + roll
  | 'wallRun'    // too tall to vault → run along the wall
  | 'blocked';   // can't pass → stop (caller decides: turn away / idle)

export interface ObstacleProbe {
  height: number;                 // obstacle top above the feet (m); 0 = none
  depth: number;                  // front-to-back thickness (m); Infinity if deep/unknown
  clearanceBelow: number | null;  // open height beneath an OVERHEAD obstacle (m); null = solid to ground
  dropAhead: number;              // how far the ground drops just ahead (m); 0 = flat
}

export interface ParkourThresholds {
  stepMax: number;      // ≤ this tall = just step up
  vaultLowMaxH: number; // ≤ this (and thin) = vault over
  vaultDepthMax: number;// vault only if the obstacle is no deeper than this
  vaultHighMaxH: number;// ≤ this = dive over the top
  wallRunMaxH: number;  // ≤ this = wall-run; taller = blocked
  ledgeMinDrop: number; // ground drop ≥ this = a real ledge to drop off
  crouchClear: number;  // overhead gap in [0.5 .. this] = slide under
}

export const DEFAULT_THRESHOLDS: ParkourThresholds = {
  stepMax: 0.4,
  vaultLowMaxH: 1.3,
  vaultDepthMax: 1.2,
  vaultHighMaxH: 2.3,
  wallRunMaxH: 3.5,
  ledgeMinDrop: 1.0,
  crouchClear: 1.3,
};

export function classifyObstacle(p: ObstacleProbe, t: ParkourThresholds = DEFAULT_THRESHOLDS): ParkourAction {
  // Overhead obstacle you can pass UNDER (a bar/beam with floor space beneath) → slide.
  if (p.clearanceBelow !== null && p.clearanceBelow >= 0.5 && p.clearanceBelow <= t.crouchClear) {
    return 'slideUnder';
  }
  // A ledge: the floor drops away and there's nothing tall blocking → drop off + roll.
  if (p.dropAhead >= t.ledgeMinDrop && p.height <= t.stepMax) return 'dropRoll';
  // Solid obstacle in front, classified by height (and depth for the low vault).
  if (p.height <= 0.05) return 'none';
  if (p.height <= t.stepMax) return 'stepUp';
  if (p.height <= t.vaultLowMaxH && p.depth <= t.vaultDepthMax) return 'vaultLow';
  if (p.height <= t.vaultHighMaxH) return 'vaultHigh';
  if (p.height <= t.wallRunMaxH) return 'wallRun';
  return 'blocked';
}
