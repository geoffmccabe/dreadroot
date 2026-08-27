/**
 * A pistol reload, built in code, because no clip exists for this rig.
 *
 * The support hand leaves the weapon, drops to the belt, comes back up but
 * STOPS SHORT of the grip, holds there while the magazine seats, then snaps
 * home. Geoff's shape, and the hold is what sells it — a hand that travels
 * down and straight back reads as a wave.
 *
 * ── WHY A GENERATED CLIP RATHER THAN CODE THAT MOVES BONES ──────────────────
 *
 * A three.js clip is just named keyframe tracks, so one can be built at
 * runtime and handed to the SAME action layer everything else uses: upper body,
 * additive, one-shot, correctly ranked against a death. Bespoke bone-poking
 * code would have to re-solve blending, interruption and priority, and would
 * drift from how every other action behaves.
 *
 * ── WHY ROTATIONS AND NOT HAND POSITIONS ───────────────────────────────────
 *
 * The characters run from 1.75m to 2.22m. A hand POSITION that reaches the belt
 * on Ash misses entirely on Fluffer, and would need retuning every time a model
 * is rescaled. Angles do not care about limb length: the same shoulder rotation
 * puts every character at their own hip. Same reason rotation-only retargeting
 * was what fixed Flamma.
 *
 * ── WHY IT STARTS AND ENDS AT ZERO ─────────────────────────────────────────
 *
 * It is played ADDITIVELY, and makeClipAdditive takes frame 0 as the reference.
 * Authoring frame 0 as no-rotation means the keys ARE the delta, so this layers
 * cleanly over whatever the pistol pose and the legs are already doing — a
 * reload while running keeps the run.
 */
import * as THREE from 'three';

/** The one table to tune. Euler degrees, applied to the SUPPORT (left) arm. */
const POSE = {
  /** Down at the belt: upper arm swings down and slightly across the body. */
  belt:      { arm: [15, 0, 55], foreArm: [0, 0, 70] },
  /** Back up, but short of the grip — the magazine is going in here. */
  nearGrip:  { arm: [5, 0, 14],  foreArm: [0, 0, 18] },
} as const;

/**
 * Timing, in seconds. Geoff's: 0.4 down, 0.5 back, 0.25 hold, then home.
 * The drop is deliberately faster than the return — grabbing is a snatch,
 * seating a magazine is deliberate. Equal halves read as a robot.
 */
const T_DOWN = 0.40;
const T_BACK = 0.50;
const T_HOLD = 0.25;
const T_HOME = 0.15;
export const FAKE_RELOAD_SECONDS = T_DOWN + T_BACK + T_HOLD + T_HOME;

export const FAKE_RELOAD_CLIP = 'proc_pistol_reload';

const D2R = Math.PI / 180;
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

function quat(deg: readonly number[]): number[] {
  _e.set(deg[0] * D2R, deg[1] * D2R, deg[2] * D2R);
  _q.setFromEuler(_e);
  return [_q.x, _q.y, _q.z, _q.w];
}
const REST = [0, 0, 0, 1];

/**
 * Build the clip for a given bone-name prefix.
 *
 * The prefix is a parameter because it is the ONE thing that differs between
 * rigs, and hard-coding "mixamorig:" would silently produce a clip that
 * animates nothing the day this is wanted elsewhere.
 */
export function buildFakeReloadClip(prefix = 'mixamorig:'): THREE.AnimationClip {
  const t0 = 0;
  const t1 = T_DOWN;                     // at the belt
  const t2 = T_DOWN + T_BACK;            // back up, short of the grip
  const t3 = t2 + T_HOLD;                // hold — magazine seating
  const t4 = t3 + T_HOME;                // home

  const times = [t0, t1, t2, t3, t4];
  const arm = [
    ...REST, ...quat(POSE.belt.arm), ...quat(POSE.nearGrip.arm),
    ...quat(POSE.nearGrip.arm),           // held, so the pause is a real stop
    ...REST,
  ];
  const fore = [
    ...REST, ...quat(POSE.belt.foreArm), ...quat(POSE.nearGrip.foreArm),
    ...quat(POSE.nearGrip.foreArm),
    ...REST,
  ];

  return new THREE.AnimationClip(FAKE_RELOAD_CLIP, t4, [
    new THREE.QuaternionKeyframeTrack(`${prefix}LeftArm.quaternion`, times, arm),
    new THREE.QuaternionKeyframeTrack(`${prefix}LeftForeArm.quaternion`, times, fore),
  ]);
}
