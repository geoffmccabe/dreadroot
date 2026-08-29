/**
 * Pulling yourself onto a ledge.
 *
 * The first move built on the scanner, and the one that proves the whole shape:
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
import { getScanner } from './surroundings';
import { chooseMove } from './moves';
import { parkourStats } from './stats';

/** How far ahead a ledge counts as reachable. */
const REACH = 1.1;
/** Tallest thing worth measuring — above this nothing is climbable anyway. */
const MAX_RISE = 3.5;
/** Climb duration. Long enough to read as effort, short enough not to feel
 *  like a loss of control. */
export const MANTLE_MS = 700;
/** A vault is a single committed movement — faster than pulling yourself up. */
export const VAULT_MS = 520;
/** Clearance above the ledge before moving forward, so the feet do not scuff
 *  through the top block on the way over. */
const LIFT_CLEARANCE = 0.15;

export interface ParkourRun {
  startedAt: number;
  /** Feet position at the start. */
  fromX: number; fromY: number; fromZ: number;
  /** Feet position where the move ends. */
  toX: number; toY: number; toZ: number;
  /** Which move this is — decides the arc and how long it takes. */
  move: 'mantle' | 'vaultLow' | 'vaultHigh';
  /** How high the body rises above the higher of the two ends, mid-move. A
   *  vault arcs OVER the obstacle; a mantle only needs to clear its own top. */
  peakY: number;
  durationMs: number;
}

/**
 * Can the player climb what is in front of them right now?
 * Returns the run to drive, or null.
 *
 * @param footY the player's FEET, not the camera.
 */
export function tryStartMove(
  x: number, footY: number, z: number,
  fx: number, fz: number,
  running: boolean,
  now: number,
): ParkourRun | null {
  const scanner = getScanner();
  if (!scanner) {
    parkourStats.record({ scannerKind: 'none', reading: null, move: null, started: false,
      refusedBecause: 'this world has no scanner installed' });
    return null;
  }

  const reading = scanner.scan(x, footY, z, fx, fz, REACH, MAX_RISE);
  if (!reading) {
    parkourStats.record({ scannerKind: scanner.kind, reading: null, move: null, started: false,
      refusedBecause: 'nothing within reach' });
    return null;
  }

  const choice = chooseMove(reading, running);

  // ONTO the obstacle.
  if (choice.move === 'mantle' && choice.landY !== null) {
    // Land just past the near face so the player ends up ON the ledge rather
    // than balanced on its edge, where the next collision step would push them
    // off.
    const over = reading.distance + 0.6;
    const run: ParkourRun = {
      startedAt: now,
      fromX: x, fromY: footY, fromZ: z,
      toX: x + fx * over, toY: choice.landY, toZ: z + fz * over,
      move: 'mantle',
      peakY: reading.topY + LIFT_CLEARANCE,
      durationMs: MANTLE_MS,
    };
    parkourStats.record({ scannerKind: scanner.kind, reading, move: 'mantle', started: true, refusedBecause: null });
    return run;
  }

  // OVER it, landing on the far side. Refused outright when the scanner could not
  // find far-side ground: vaulting a wall into an unmeasured drop is how a
  // character ends up inside the world.
  if ((choice.move === 'vaultLow' || choice.move === 'vaultHigh')
      && reading.farSideY !== null && Number.isFinite(reading.depth)) {
    const clear = reading.distance + reading.depth + 0.7;
    const run: ParkourRun = {
      startedAt: now,
      fromX: x, fromY: footY, fromZ: z,
      toX: x + fx * clear, toY: reading.farSideY, toZ: z + fz * clear,
      move: choice.move,
      // Clear the obstacle's top by a margin — the body swings over it, and
      // scuffing through the block it is vaulting is the tell that gives a
      // fake vault away.
      peakY: reading.topY + 0.45,
      durationMs: VAULT_MS,
    };
    parkourStats.record({ scannerKind: scanner.kind, reading, move: choice.move, started: true, refusedBecause: null });
    return run;
  }

  parkourStats.record({
    scannerKind: scanner.kind, reading, move: choice.move, started: false,
    refusedBecause:
      choice.move === 'stepUp' ? 'low enough to just walk over'
      : choice.move === 'blocked' ? 'too tall, or not moving fast enough'
      : (choice.move === 'vaultLow' || choice.move === 'vaultHigh')
        ? 'no measurable ground on the far side — refused rather than vault into a drop'
      : `no path built for "${choice.move}" yet`,
  });
  return null;
}

/**
 * Where the feet should be, part-way through a climb.
 * Returns null once it is finished.
 *
 * Rises FIRST, then moves forward. Doing both at once cuts the corner and
 * drags the body through the ledge.
 */
export function runPosition(
  run: ParkourRun, now: number,
  out: { x: number; y: number; z: number },
): boolean {
  const t = (now - run.startedAt) / run.durationMs;
  if (t >= 1) {
    out.x = run.toX; out.y = run.toY; out.z = run.toZ;
    return false;
  }

  if (run.move === 'mantle') {
    // Up the face FIRST, then over the top. Doing both at once cuts the corner
    // and drags the body through the ledge.
    if (t < 0.55) {
      const k = t / 0.55;
      out.x = run.fromX; out.z = run.fromZ;
      out.y = run.fromY + (run.peakY - run.fromY) * k;
    } else {
      const k = (t - 0.55) / 0.45;
      out.x = run.fromX + (run.toX - run.fromX) * k;
      out.z = run.fromZ + (run.toZ - run.fromZ) * k;
      out.y = run.peakY + (run.toY - run.peakY) * k;
    }
    return true;
  }

  // A VAULT is one continuous arc: forward at a steady rate the whole way,
  // height following a parabola that peaks over the obstacle. Splitting it into
  // up-then-across would read as climbing, which is the move it is meant to be
  // faster and more fluid than.
  out.x = run.fromX + (run.toX - run.fromX) * t;
  out.z = run.fromZ + (run.toZ - run.fromZ) * t;
  const ground = run.fromY + (run.toY - run.fromY) * t;
  const arc = 4 * t * (1 - t);   // 0 at both ends, 1 at the middle
  out.y = ground + (run.peakY - Math.max(run.fromY, run.toY)) * arc;
  return true;
}
