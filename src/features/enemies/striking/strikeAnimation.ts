/**
 * Modular melee "strike" animation — shared by every humanoid enemy.
 *
 * A strike is a 3-phase punch/thrust whose DAMAGE is applied at the APEX (the
 * end of the thrust), so the victim is knocked back in perfect sync with the
 * limbs punching forward — instead of the old "instant damage the moment the AI
 * returns 'attack'" behaviour.
 *
 *   windup  → limbs pull BACK (slingshot), body leans slightly BACK
 *   thrust  → limbs punch FORWARD along the strike vector, body leans toward
 *             the target; APEX = end of thrust → damage/knockback fire here
 *   recover → everything eases back to the neutral pose
 *
 * Everything here is allocation-free: advanceStrike / strikeBodyPose /
 * strikePartExtend / strikePartTransform all write into passed-in (or
 * module-level scratch) result objects and never allocate in the hot path.
 *
 * Adding the strike to a future humanoid enemy:
 *   1. add the StrikeState fields (below) to its instance type
 *   2. add the same ~3 call sites (startStrike on trigger, advanceStrike every
 *      frame + apply-hit-on-crossedApex in the adapter, and the pose calls in
 *      its renderer).
 *
 * @module enemies/striking/strikeAnimation
 */

// ── Timing constants (the easy knobs to tune for the "feel") ────────────────
/** Wind-up: limbs cock back. */
export const STRIKE_WINDUP_MS = 380;
/** Thrust: limbs punch forward. APEX = the end of this phase. */
export const STRIKE_THRUST_MS = 200;
/** Recover: ease back to neutral. */
export const STRIKE_RECOVER_MS = 360;

// ── Pose magnitude knobs (easy to tune for the look) ────────────────────────
/** How far (fraction of body length) the limbs pull BACK at the deepest part
 *  of the wind-up. Negative reach. */
const STRIKE_PULLBACK_FRAC = 0.28;
/** How far (fraction of body length) the limbs REACH forward at the apex. ~1
 *  body length out. */
const STRIKE_REACH_FRAC = 1.0;
/** Peak whole-body lean toward the target during the thrust (radians-ish — it's
 *  used as a small displacement amount by the renderer, not a hard rotation). */
const STRIKE_LEAN_AMT = 0.35;
/** Slight BACK lean during wind-up, as a fraction of STRIKE_LEAN_AMT. */
const STRIKE_WINDUP_LEAN_FRAC = 0.4;

export type StrikePhase = 'idle' | 'windup' | 'thrust' | 'recover';

/**
 * Strike state — add these fields to any humanoid enemy instance type that
 * wants the strike animation. All optional so existing call sites/spawners
 * don't need to initialise them (treated as 'idle' until startStrike runs).
 */
export interface StrikeState {
  /** Current phase of the strike state machine. */
  strikePhase?: StrikePhase;
  /** ms timestamp the current phase started (performance.now()). */
  strikeStartTime?: number;
  /** Unit horizontal strike vector (toward the captured target at trigger). */
  strikeDirX?: number;
  strikeDirZ?: number;
  /** True once the apex hit has been applied for this strike. */
  strikeApexDone?: boolean;
  /** Body height in world units, captured at trigger (drives reach distance). */
  strikeBodyLen?: number;
  /** Victim captured at trigger (rival enemy ref, or null = the player). */
  strikeVictim?: unknown | null;
  /** Captured victim's combat-registry type (null = player). */
  strikeVictimType?: string | null;
  /** Damage to apply at apex. */
  strikeDamage?: number;
  /** Knockback to apply at apex. */
  strikeKnockback?: number;
}

/** Phase advance result — module-level scratch, reused (no allocation). */
export interface StrikeAdvance {
  phase: StrikePhase;
  /** Progress 0..1 within the current phase. */
  t: number;
  /** True for exactly one frame: the moment the thrust reaches its apex. */
  crossedApex: boolean;
}
const _advance: StrikeAdvance = { phase: 'idle', t: 0, crossedApex: false };

/** Body-lean result — module-level scratch, reused. */
export interface StrikeBodyPose {
  /** Lean displacement along X (world). */
  leanX: number;
  /** Lean displacement along Z (world). */
  leanZ: number;
  /** Signed lean magnitude (negative during wind-up = lean back). */
  leanAmt: number;
}
const _bodyPose: StrikeBodyPose = { leanX: 0, leanZ: 0, leanAmt: 0 };

/** Per-part transform result — module-level scratch, reused. */
export interface StrikePartTransform {
  dx: number;
  dy: number;
  dz: number;
  /** Extra yaw (radians) so a limb's distal/sharp end points at the target. */
  yawToTarget: number;
}
const _partXf: StrikePartTransform = { dx: 0, dy: 0, dz: 0, yawToTarget: 0 };

// ── Easing helpers ──────────────────────────────────────────────────────────
function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}
function easeInQuad(t: number): number {
  return t * t;
}

/**
 * Begin a strike. Sets the wind-up phase and captures the victim + strike
 * vector so the apex hit lands on exactly the right target regardless of how
 * the per-tick AI target changes mid-strike.
 *
 * @param dirX/dirZ horizontal direction toward the target (will be normalized)
 * @param bodyLen   the enemy's body height in world units
 */
export function startStrike(
  inst: StrikeState,
  dirX: number,
  dirZ: number,
  bodyLen: number,
  victim: unknown | null,
  victimType: string | null,
  damage: number,
  knockback: number,
  now: number,
): void {
  const len = Math.hypot(dirX, dirZ);
  const nx = len > 1e-4 ? dirX / len : 0;
  const nz = len > 1e-4 ? dirZ / len : 1;
  inst.strikePhase = 'windup';
  inst.strikeStartTime = now;
  inst.strikeDirX = nx;
  inst.strikeDirZ = nz;
  inst.strikeApexDone = false;
  inst.strikeBodyLen = bodyLen;
  inst.strikeVictim = victim;
  inst.strikeVictimType = victimType;
  inst.strikeDamage = damage;
  inst.strikeKnockback = knockback;
}

/** True when a strike is currently animating (not idle). */
export function isStriking(inst: StrikeState): boolean {
  return !!inst.strikePhase && inst.strikePhase !== 'idle';
}

/**
 * Advance the strike state machine by wall-clock time. Call EVERY frame (like
 * gravity), regardless of the AI result kind. Transitions windup → thrust →
 * recover → idle. Sets `crossedApex` true for exactly one frame, on the frame
 * the thrust phase completes (its apex) — the caller applies the hit then.
 *
 * Returns a reused scratch object (do not retain).
 */
export function advanceStrike(inst: StrikeState, now: number): StrikeAdvance {
  const phase = inst.strikePhase ?? 'idle';
  _advance.crossedApex = false;

  if (phase === 'idle') {
    _advance.phase = 'idle';
    _advance.t = 0;
    return _advance;
  }

  const start = inst.strikeStartTime ?? now;
  let elapsed = now - start;
  if (elapsed < 0) elapsed = 0;

  if (phase === 'windup') {
    if (elapsed >= STRIKE_WINDUP_MS) {
      inst.strikePhase = 'thrust';
      inst.strikeStartTime = start + STRIKE_WINDUP_MS;
      _advance.phase = 'thrust';
      _advance.t = 0;
    } else {
      _advance.phase = 'windup';
      _advance.t = elapsed / STRIKE_WINDUP_MS;
    }
    return _advance;
  }

  if (phase === 'thrust') {
    if (elapsed >= STRIKE_THRUST_MS) {
      // Reached the apex (end of thrust). Fire the hit ONCE.
      inst.strikePhase = 'recover';
      inst.strikeStartTime = start + STRIKE_THRUST_MS;
      if (!inst.strikeApexDone) {
        inst.strikeApexDone = true;
        _advance.crossedApex = true;
      }
      _advance.phase = 'recover';
      _advance.t = 0;
    } else {
      _advance.phase = 'thrust';
      _advance.t = elapsed / STRIKE_THRUST_MS;
    }
    return _advance;
  }

  // recover
  if (elapsed >= STRIKE_RECOVER_MS) {
    inst.strikePhase = 'idle';
    inst.strikeStartTime = start + STRIKE_RECOVER_MS;
    _advance.phase = 'idle';
    _advance.t = 1;
  } else {
    _advance.phase = 'recover';
    _advance.t = elapsed / STRIKE_RECOVER_MS;
  }
  return _advance;
}

/**
 * A single signed scalar (fraction of body length) describing how far the limb
 * parts are displaced along the strike vector this frame:
 *   • windup → NEGATIVE (parts pull back, opposite the strike vector)
 *   • thrust → rising to +STRIKE_REACH_FRAC at apex (reach ~one body length)
 *   • recover → eases from apex reach back to 0
 *   • idle   → 0
 */
export function strikePartExtend(inst: StrikeState, now: number): number {
  const a = advanceStrikePeek(inst, now);
  switch (a.phase) {
    case 'windup':
      // Ease from 0 to the full pull-back depth.
      return -STRIKE_PULLBACK_FRAC * easeOutCubic(a.t);
    case 'thrust':
      // Snap from the pull-back depth up to full reach.
      return -STRIKE_PULLBACK_FRAC + (STRIKE_REACH_FRAC + STRIKE_PULLBACK_FRAC) * easeInQuad(a.t);
    case 'recover':
      // Ease from full reach back to neutral.
      return STRIKE_REACH_FRAC * (1 - easeOutCubic(a.t));
    default:
      return 0;
  }
}

/**
 * Whole-body lean toward the target this frame. 0 at idle. Slightly BACK during
 * wind-up; peaks toward the target during the thrust; eases out in recover.
 * Returns a reused scratch object (do not retain).
 */
export function strikeBodyPose(inst: StrikeState, now: number): StrikeBodyPose {
  const a = advanceStrikePeek(inst, now);
  const dirX = inst.strikeDirX ?? 0;
  const dirZ = inst.strikeDirZ ?? 0;

  let amt = 0;
  switch (a.phase) {
    case 'windup':
      amt = -STRIKE_LEAN_AMT * STRIKE_WINDUP_LEAN_FRAC * easeOutCubic(a.t);
      break;
    case 'thrust':
      amt = STRIKE_LEAN_AMT * easeInQuad(a.t);
      break;
    case 'recover':
      amt = STRIKE_LEAN_AMT * (1 - easeOutCubic(a.t));
      break;
    default:
      amt = 0;
  }

  _bodyPose.leanAmt = amt;
  _bodyPose.leanX = dirX * amt;
  _bodyPose.leanZ = dirZ * amt;
  return _bodyPose;
}

/**
 * Per-part transform for the strike. Limb parts are displaced along the strike
 * vector by extendScalar × bodyLen AND yawed so their long (distal/sharp) axis
 * aims at the target. Non-limb parts (head/torso/cap) get NO point-rotation and
 * NO part displacement here — they only receive the whole-body lean (applied by
 * the renderer via strikeBodyPose).
 *
 * Returns a reused scratch object (do not retain).
 *
 * @param extendScalar signed fraction of bodyLen from strikePartExtend()
 * @param dirX/dirZ    unit strike vector (inst.strikeDirX/Z)
 * @param bodyLen      body height in world units (inst.strikeBodyLen)
 * @param partIsLimb   true for arms/legs (the parts that thrust + point)
 */
export function strikePartTransform(
  extendScalar: number,
  dirX: number,
  dirZ: number,
  bodyLen: number,
  partIsLimb: boolean,
): StrikePartTransform {
  if (!partIsLimb) {
    _partXf.dx = 0;
    _partXf.dy = 0;
    _partXf.dz = 0;
    _partXf.yawToTarget = 0;
    return _partXf;
  }
  const reach = extendScalar * bodyLen;
  _partXf.dx = dirX * reach;
  _partXf.dy = 0;
  _partXf.dz = dirZ * reach;
  // PITCH the limb from vertical (rest) toward horizontal so its sharp/distal
  // end points AT the target during the punch. `yawToTarget` carries the tilt
  // ANGLE (the renderer rotates about the strike-perpendicular axis): 0 at rest,
  // up to ~90° at full thrust, and NEGATIVE during the wind-up (tilts back).
  _partXf.yawToTarget = (Math.PI / 2) * (extendScalar / STRIKE_REACH_FRAC);
  return _partXf;
}

/** Helper for renderers: is this body-part name a thrusting limb? */
export function strikePartIsLimb(partName: string): boolean {
  return partName.includes('Arm') || partName.includes('Leg');
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Body height (world units, scale 1) from a humanoid part layout:
 * max(part top) − min(part bottom). Same formula the shroomer renderer uses
 * for its cap diameter. Multiply by the instance scale for the real reach.
 */
export function computeBodyHeightFromParts(
  parts: readonly { offsetY: number; scaleY: number }[],
): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of parts) {
    const top = p.offsetY + p.scaleY / 2;
    const bottom = p.offsetY - p.scaleY / 2;
    if (top > maxY) maxY = top;
    if (bottom < minY) minY = bottom;
  }
  return maxY - minY;
}

// ── Peek (read-only phase/t) ────────────────────────────────────────────────
// strikePartExtend / strikeBodyPose are called from the RENDERER, which can run
// at a different cadence than the adapter and must NOT mutate the state machine
// (only the adapter's advanceStrike drives transitions + the apex hit). This
// derives the phase/t from the stored start time WITHOUT advancing anything.
const _peek: { phase: StrikePhase; t: number } = { phase: 'idle', t: 0 };
function advanceStrikePeek(inst: StrikeState, now: number): { phase: StrikePhase; t: number } {
  const phase = inst.strikePhase ?? 'idle';
  if (phase === 'idle') {
    _peek.phase = 'idle';
    _peek.t = 0;
    return _peek;
  }
  const start = inst.strikeStartTime ?? now;
  let elapsed = now - start;
  if (elapsed < 0) elapsed = 0;
  const dur =
    phase === 'windup' ? STRIKE_WINDUP_MS :
    phase === 'thrust' ? STRIKE_THRUST_MS :
    STRIKE_RECOVER_MS;
  _peek.phase = phase;
  _peek.t = clamp01(elapsed / dur);
  return _peek;
}
