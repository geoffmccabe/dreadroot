/**
 * The abstract movement vocabulary, shared by every character in every game.
 *
 * The selector answers "what is this body DOING", never "which clip file plays".
 * Naming a clip here would tie the movement logic to one skeleton, and we have
 * two that share no bone names — so the same logic has to drive both. Clip
 * names live in clipSets.ts and nowhere else.
 *
 * Lifted from the Siege Worlds self-avatar, which had this working, rather than
 * written afresh. The airborne handling in particular is hard-won: see below.
 */

export type MoveState =
  | 'idle'
  | 'walkF' | 'walkB'
  | 'strafeL' | 'strafeR'
  | 'runF' | 'runL' | 'runR'
  | 'jump' | 'fall' | 'glide';

export interface MoveInput {
  /** forward input: +1 forward, -1 back, 0 none */
  mf: number;
  /** strafe input: +1 right, -1 left, 0 none */
  mr: number;
  run: boolean;
  grounded: boolean;
  /** vertical speed: positive rising, negative falling */
  vy: number;
  gliding: boolean;
  /** jet-boost / air-jump burn active */
  boosting: boolean;
}

/** Upward speed that counts as a real jump rather than a bump. */
export const JUMP_VY = 3.0;
/** Off the ground for less than this is a stumble, not a fall. */
export const COYOTE_MS = 140;

/**
 * Tracks whether the body is meaningfully airborne.
 *
 * Two problems this exists to solve, both of which read as "the jump animation
 * is broken" when got wrong:
 *
 *  - A jump LATCHES on the upward launch and stays latched until landing.
 *    Without the latch the apex — where vertical speed passes through zero —
 *    flips back to a ground pose for a frame or two mid-leap.
 *  - A FALL only counts after being off the ground continuously past the coyote
 *    window, so walking over a bump or down a slope (where grounded flickers)
 *    never triggers a falling pose.
 */
export class AirborneTracker {
  private leftGroundAt = 0;
  private jumped = false;

  update(i: MoveInput, now: number): boolean {
    if (i.grounded) {
      this.leftGroundAt = 0;
      this.jumped = false;
    } else if (this.leftGroundAt === 0) {
      this.leftGroundAt = now;
    }
    // A jet-boost is not a jump pose — the boot flames carry that read — so it
    // deliberately does not latch.
    if (!i.grounded && i.vy > JUMP_VY && !i.boosting) this.jumped = true;
    const sustained = !i.grounded && this.leftGroundAt > 0 && now - this.leftGroundAt > COYOTE_MS;
    return this.jumped || sustained;
  }
}

/** What the body is doing right now, in priority order. */
export function pickMovementState(i: MoveInput, airborne: boolean): MoveState {
  if (i.gliding) return 'glide';
  // Jet-boost holds a neutral airborne pose rather than a jump: the air-jump
  // has no launch crouch and the flames already say what is happening.
  if (i.boosting) return 'fall';
  if (airborne) return i.vy > 0 ? 'jump' : 'fall';
  if (i.mf > 0) return i.run ? 'runF' : 'walkF';   // forward beats strafe
  if (i.mf < 0) return 'walkB';
  if (i.mr < 0) return i.run ? 'runL' : 'strafeL';
  if (i.mr > 0) return i.run ? 'runR' : 'strafeR';
  return 'idle';
}
