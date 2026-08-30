/**
 * The ONE thing the game calls. Everything else in this folder is behind it.
 *
 * WHY A HOOK AND NOT A FEW IMPORTS. `FortressControls.tsx` is already 3,500
 * lines, and the previous arrangement spread parkour across it as a ref, a
 * per-frame branch, a start check and finish bookkeeping — about forty lines of
 * parkour reasoning living inside the movement loop. That is how a file becomes
 * unmaintainable, and it is why the two rival parkour systems were able to
 * drift apart without anyone noticing.
 *
 * So the controller owns its own state. The movement loop asks it three
 * questions — are you running, start if you can, where should I be — and holds
 * no parkour state of its own.
 */
import { useRef } from 'react';
import { tryStartMove, runPosition, type ParkourRun } from './runner';
import { publishActiveMove } from './playerFeet';

export interface ParkourStep {
  /** Feet position this frame. */
  x: number; y: number; z: number;
  /** The move finished on this frame. */
  done: boolean;
  /** On the finishing frame: does the player end up standing on solid ground?
   *  A mantle finishes on the ledge; a VAULT finishes wherever the far side
   *  was, which may be a drop — so it hands back to the falling code rather
   *  than claiming to be grounded, or the player hovers after clearing a wall
   *  onto lower terrain. */
  landsOnGround: boolean;
}

export interface ParkourController {
  /** A move owns the player right now — normal movement and gravity are off. */
  isActive(): boolean;
  /**
   * Start a move if the geometry allows one. Feet coordinates, not the camera.
   * @returns the animation to trigger AND how long the move takes, or null if
   *   nothing started. The DURATION matters: the clip has to be scaled to it,
   *   or the body finishes the move and keeps climbing thin air.
   */
  tryStart(
    x: number, footY: number, z: number,
    fx: number, fz: number,
    running: boolean, now: number,
  ): { action: 'climb' | 'vault'; seconds: number } | null;
  /** Advance the running move. Only valid while `isActive()`. */
  advance(now: number): ParkourStep;
}

/**
 * Quiet period after a move ends before another can start.
 *
 * The jump key is read as HELD, not as a press, and a mantle finishes by
 * marking the player grounded — so the very next frame is eligible to start
 * another one. Against a stack that chains climbs together into a single ride
 * up the wall, which is what "it does 2-3 climb animations" was. A press should
 * buy one move.
 */
const COOLDOWN_MS = 300;

export function useParkour(): ParkourController {
  const run = useRef<ParkourRun | null>(null);
  const endedAt = useRef(0);
  const pos = useRef({ x: 0, y: 0, z: 0 });
  const step = useRef<ParkourStep>({ x: 0, y: 0, z: 0, done: false, landsOnGround: false });
  const api = useRef<ParkourController>();

  if (!api.current) {
    api.current = {
      isActive: () => run.current !== null,

      tryStart(x, footY, z, fx, fz, running, now) {
        if (run.current) return null;
        if (now - endedAt.current < COOLDOWN_MS) return null;
        const started = tryStartMove(x, footY, z, fx, fz, running, now);
        if (!started) return null;
        run.current = started;
        publishActiveMove(`${started.move}/${started.style}`);
        // The CLIP follows the style, not the move name. Hauling yourself up a
        // wall and hopping onto a single block are different animations, and
        // playing the wall climb on a one-block ledge is what "it climbs the
        // air" has been all along — there is nothing there to climb.
        return {
          action: started.style === 'climb' ? 'climb' : 'vault',
          seconds: started.durationMs / 1000,
        };
      },

      advance(now) {
        const s = step.current;
        const r = run.current;
        if (!r) { s.done = true; s.landsOnGround = false; return s; }
        const stillRunning = runPosition(r, now, pos.current);
        s.x = pos.current.x; s.y = pos.current.y; s.z = pos.current.z;
        s.done = !stillRunning;
        s.landsOnGround = s.done && r.move === 'mantle';
        if (s.done) { run.current = null; endedAt.current = now; publishActiveMove(null); }
        return s;
      },
    };
  }

  return api.current;
}
