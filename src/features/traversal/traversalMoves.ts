/**
 * Measurement in, move out. This table IS the parkour system.
 *
 * Everything else already exists: the probe measures, the action layer plays a
 * one-shot clip, the state machine picks locomotion. All that was missing was
 * the decision in the middle — and it is a handful of thresholds, not a
 * subsystem. Adding a move later costs a row here and a clip name.
 *
 * WHY THERE IS NO MOTION WARPING. In a normal game a mantle clip authored for a
 * 1.2m ledge looks broken on a 0.9m one, so its root motion has to be stretched
 * at runtime to fit. That is the hardest part of a traversal system and the
 * part home-grown attempts get wrong.
 *
 * A voxel world has no such problem. Obstacles are whole blocks, so heights are
 * 1, 2 or 3 — not a continuum — and the clips we already own were authored at
 * exactly that granularity: the names literally say _Over_1m_Object and
 * _Over_2m_Object. One block is one metre here, so those clips fit their block
 * counts as authored. The animator's assumptions and the world's geometry
 * already agree.
 *
 * That reasoning is VOXEL-SPECIFIC. A mesh world (Siege Worlds) has arbitrary
 * ledge heights and will need warping or IK to look right — which is why the
 * probe is an interface and why this table takes a measurement rather than
 * reading blocks itself.
 */
import type { ObstacleReading } from './obstacleProbe';

export type TraversalMove =
  | 'stepUp'      // low enough to walk over — no animation, physics handles it
  | 'vaultLow'    // ~1 block, thin: hop over without landing on top
  | 'vaultHigh'   // ~2 blocks, thin: dive over
  | 'mantle'      // climb onto and stand on top
  | 'slideUnder'  // a gap below something, low headroom
  | 'wallRun'     // too tall to climb, keep moving along it
  | 'blocked';    // nothing to do but stop

export interface TraversalChoice {
  move: TraversalMove;
  /** Clip name, or null for moves the physics handles with no animation. */
  clip: string | null;
  /** Where the player ends up standing, when the move puts them somewhere. */
  landY: number | null;
}

/** Clips, all of which already exist in the loaded libraries. */
const CLIPS = {
  vaultLow: 'Anim_Parkour_Run_To_Kick-Jump_Over_1m_Object',
  vaultHigh: 'Anim_Parkour_Run_To_Dive_Over_2m_Object',
  mantle: 'Climbing Up Wall',
  slideUnder: 'Anim_Parkour_Run_To_Backslide_Under_1m_Object',
  wallRun: 'Anim_Parkour_Wall_Run_With_Right_Turn',
} as const;

/** Below this the player just walks up — animating it would look worse. */
export const STEP_UP_MAX = 0.6;
/** Tallest surface a character can pull themselves onto. */
export const MANTLE_MAX = 2.2;
/** An obstacle thinner than this can be cleared instead of climbed. */
export const THIN_DEPTH = 1.2;
/** Less headroom than this and it is a gap, not a ledge. */
export const CRAWL_HEADROOM = 1.2;

export function chooseTraversal(r: ObstacleReading, running: boolean): TraversalChoice {
  // Low enough to walk over. Left to the physics deliberately: a climb
  // animation on a single kerb reads as the character tripping.
  if (r.height <= STEP_UP_MAX) {
    return { move: 'stepUp', clip: null, landY: r.topY };
  }

  // Something overhead with a gap beneath it — go under, not over. Checked
  // BEFORE height, because a low ceiling makes even a short obstacle
  // unclimbable.
  if (r.headroom < CRAWL_HEADROOM) {
    return running
      ? { move: 'slideUnder', clip: CLIPS.slideUnder, landY: null }
      : { move: 'blocked', clip: null, landY: null };
  }

  // Thin enough to clear outright, and moving fast enough to justify it. A
  // vault from standing looks absurd, so walking pace mantles instead.
  if (running && r.depth <= THIN_DEPTH) {
    if (r.height <= 1.4) return { move: 'vaultLow', clip: CLIPS.vaultLow, landY: null };
    if (r.height <= 2.4) return { move: 'vaultHigh', clip: CLIPS.vaultHigh, landY: null };
  }

  // Deep enough that you end up on top of it.
  if (r.height <= MANTLE_MAX && r.standable) {
    return { move: 'mantle', clip: CLIPS.mantle, landY: r.topY };
  }

  // Too tall to climb. Running at it can carry you along the face; standing
  // still it is simply a wall.
  return running
    ? { move: 'wallRun', clip: CLIPS.wallRun, landY: null }
    : { move: 'blocked', clip: null, landY: null };
}
