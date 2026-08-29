/**
 * Measurement in, move out. This table IS the parkour system.
 *
 * ONE TABLE, deliberately. Until now there were TWO: `traversalMoves.ts` drove
 * the real game and `charlineup/obstacleDetector.ts` drove the dev preview, and
 * they disagreed on every threshold (step-up 0.6 vs 0.4, vault-low 1.4 vs 1.3,
 * and the preview had a wall-run ceiling the game did not). Fixes landed in one
 * and not the other. Both are folded in here and there is no second copy.
 *
 * Where the two disagreed, the GAME's numbers won — those are the ones that
 * have been felt in play. The preview's EXTRA moves (dropRoll, the flourish
 * flips) are kept, because they cost nothing until something can trigger them.
 *
 * WHY THERE IS NO MOTION WARPING. In a normal game a mantle clip authored for a
 * 1.2m ledge looks broken on a 0.9m one, so its root motion has to be stretched
 * at runtime. That is the hardest part of a traversal system and the part
 * home-grown attempts get wrong.
 *
 * A voxel world has no such problem. Obstacles are whole blocks, so heights are
 * 1, 2 or 3 — not a continuum — and the clips we own were authored at exactly
 * that granularity: the names literally say _Over_1m_Object and _Over_2m_Object.
 * The animator's assumptions and the world's geometry already agree.
 *
 * That reasoning is VOXEL-SPECIFIC. A mesh world (Siege Worlds) has arbitrary
 * ledge heights and will need warping or IK — which is why the scanner is an
 * interface and why this table takes a measurement rather than reading blocks.
 */
import type { Surroundings } from './surroundings';

export type ParkourMove =
  | 'none'        // nothing in the way — keep moving
  | 'stepUp'      // low enough to walk over — no animation, physics handles it
  | 'vaultLow'    // ~1 block, thin: hop over without landing on top
  | 'vaultHigh'   // ~2 blocks, thin: dive over
  | 'mantle'      // climb onto and stand on top
  | 'slideUnder'  // a gap below something, low headroom
  | 'dropRoll'    // ground falls away — drop off and roll out
  | 'wallRun'     // too tall to climb, keep moving along it
  | 'blocked';    // nothing to do but stop

export interface ParkourChoice {
  move: ParkourMove;
  /** Where the player ends up standing, when the move puts them somewhere. */
  landY: number | null;
}

export interface ParkourThresholds {
  /** Below this the player just walks up — animating it would look worse. */
  stepUpMax: number;
  /** An obstacle thinner than this can be cleared instead of climbed. */
  thinDepth: number;
  /** Tallest obstacle a running player can hop clean over. */
  vaultLowMax: number;
  /** Tallest obstacle a running player can dive over. */
  vaultHighMax: number;
  /** Tallest surface a character can pull themselves onto. */
  mantleMax: number;
  /** Taller than this and even a wall-run is pointless. */
  wallRunMax: number;
  /** Less headroom than this and it is a gap, not a ledge. */
  crawlHeadroom: number;
  /** Ground drop of at least this is a real ledge to drop off. */
  ledgeMinDrop: number;
}

export const THRESHOLDS: ParkourThresholds = {
  stepUpMax: 0.6,
  thinDepth: 1.2,
  vaultLowMax: 1.4,
  vaultHighMax: 2.4,
  mantleMax: 2.2,
  wallRunMax: 3.5,
  crawlHeadroom: 1.2,
  ledgeMinDrop: 1.0,
};

export function chooseMove(
  r: Surroundings,
  running: boolean,
  t: ParkourThresholds = THRESHOLDS,
): ParkourChoice {
  // An overhead obstacle with floor space underneath — go under, not over.
  // Checked FIRST, because a low ceiling makes even a short obstacle
  // unclimbable. `clearanceBelow` is null until the scanner measures it, so
  // today this only fires on the headroom test below.
  if (r.clearanceBelow !== null && r.clearanceBelow >= 0.5 && r.clearanceBelow <= t.crawlHeadroom) {
    return running
      ? { move: 'slideUnder', landY: null }
      : { move: 'blocked', landY: null };
  }

  // The floor falls away and nothing tall blocks the way — drop off and roll.
  if (r.dropAhead >= t.ledgeMinDrop && r.height <= t.stepUpMax) {
    return { move: 'dropRoll', landY: null };
  }

  // Level ground.
  if (r.height <= 0.01) return { move: 'none', landY: null };

  // Low enough to walk over. Left to the physics deliberately: a climb
  // animation on a single kerb reads as the character tripping.
  if (r.height <= t.stepUpMax) {
    return { move: 'stepUp', landY: r.topY };
  }

  // Something solid overhead — same reasoning as clearanceBelow above, reached
  // by the measurement the voxel scanner actually produces today.
  if (r.headroom < t.crawlHeadroom) {
    return running
      ? { move: 'slideUnder', landY: null }
      : { move: 'blocked', landY: null };
  }

  // Thin enough to clear outright, and moving fast enough to justify it. A
  // vault from standing looks absurd, so walking pace mantles instead.
  if (running && r.depth <= t.thinDepth) {
    if (r.height <= t.vaultLowMax) return { move: 'vaultLow', landY: null };
    if (r.height <= t.vaultHighMax) return { move: 'vaultHigh', landY: null };
  }

  // Deep enough that you end up on top of it.
  if (r.height <= t.mantleMax && r.standable) {
    return { move: 'mantle', landY: r.topY };
  }

  // Too tall to climb. Running at it can carry you along the face; standing
  // still it is simply a wall.
  if (running && r.height <= t.wallRunMax) {
    return { move: 'wallRun', landY: null };
  }
  return { move: 'blocked', landY: null };
}
