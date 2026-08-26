/**
 * Pulling yourself onto a ledge.
 *
 * The first move built on the probe, and the one that proves the whole shape:
 * measure, choose, play, move. Everything after this costs a threshold and a
 * clip name rather than new machinery.
 *
 * HOW IT MOVES. For the duration of the climb the player is carried along a
 * fixed path — up past the ledge, then forward onto it — instead of being left
 * to the normal physics. That is what every game does for a mantle, because
 * physics has no idea the character is supposed to end up on top of something,
 * and a jump tuned to feel right in the open will not reliably clear a ledge.
 *
 * The path is a straight two-part lerp rather than root motion from the clip.
 * In a voxel world the ledge is a whole number of blocks up, and the clip was
 * authored for exactly that height, so the two already agree — this is the
 * same reason the plan concluded motion warping is unnecessary here. A mesh
 * world would need the clip's own root motion, warped.
 */
import { getObstacleProbe } from './obstacleProbe';
import { chooseTraversal } from './traversalMoves';

/** How far ahead a ledge counts as reachable. */
const REACH = 1.1;
/** Tallest thing worth measuring — above this nothing is climbable anyway. */
const MAX_RISE = 3.5;
/** Climb duration. Long enough to read as effort, short enough not to feel
 *  like a loss of control. */
export const MANTLE_MS = 700;
/** Clearance above the ledge before moving forward, so the feet do not scuff
 *  through the top block on the way over. */
const LIFT_CLEARANCE = 0.15;

export interface MantleRun {
  startedAt: number;
  /** Feet position at the start. */
  fromX: number; fromY: number; fromZ: number;
  /** Feet position on top of the ledge. */
  toX: number; toY: number; toZ: number;
}

/**
 * Can the player climb what is in front of them right now?
 * Returns the run to drive, or null.
 *
 * @param footY the player's FEET, not the camera.
 */
export function tryStartMantle(
  x: number, footY: number, z: number,
  fx: number, fz: number,
  running: boolean,
  now: number,
): MantleRun | null {
  const probe = getObstacleProbe();
  if (!probe) return null;                    // world has no probe — do nothing

  const reading = probe.probe(x, footY, z, fx, fz, REACH, MAX_RISE);
  if (!reading) return null;

  const choice = chooseTraversal(reading, running);
  if (choice.move !== 'mantle' || choice.landY === null) return null;

  // Land just past the near face so the player ends up ON the ledge rather than
  // balanced on its edge, where the next collision step would push them off.
  const over = reading.distance + 0.6;
  return {
    startedAt: now,
    fromX: x, fromY: footY, fromZ: z,
    toX: x + fx * over, toY: choice.landY, toZ: z + fz * over,
  };
}

/**
 * Where the feet should be, part-way through a climb.
 * Returns null once it is finished.
 *
 * Rises FIRST, then moves forward. Doing both at once cuts the corner and
 * drags the body through the ledge.
 */
export function mantlePosition(
  run: MantleRun, now: number,
  out: { x: number; y: number; z: number },
): boolean {
  const t = (now - run.startedAt) / MANTLE_MS;
  if (t >= 1) {
    out.x = run.toX; out.y = run.toY; out.z = run.toZ;
    return false;
  }
  const peak = run.toY + LIFT_CLEARANCE;
  if (t < 0.55) {
    // Up the face, still at the starting footprint.
    const k = t / 0.55;
    out.x = run.fromX; out.z = run.fromZ;
    out.y = run.fromY + (peak - run.fromY) * k;
  } else {
    // Over the top.
    const k = (t - 0.55) / 0.45;
    out.x = run.fromX + (run.toX - run.fromX) * k;
    out.z = run.fromZ + (run.toZ - run.fromZ) * k;
    out.y = peak + (run.toY - peak) * k;
  }
  return true;
}
