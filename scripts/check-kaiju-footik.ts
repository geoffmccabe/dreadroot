/**
 * check-kaiju-footik — a foot must not hang in the air, and a leg must not stretch to avoid it.
 *
 * Geoff: "right now they stand on the ground and one foot may be floating in the air, because the
 * ground isn't even."
 *
 * Every claim the solver makes is checked here against a synthetic skeleton on synthetic slopes,
 * because "is that foot on the ground" is a question with an exact numeric answer and there is no
 * reason to be squinting at a screen for it.
 *
 * Run: npm run check:kaiju-footik
 */

import * as THREE from 'three';
import {
  findLegRig, plantFeet, footOffsetToGround, clearFootIK,
} from '../src/components/siege/globe/kaijuFootIK';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

const R = 1000;          // a small "planet", so the maths is the same shape as the real one
const LEG = 100;         // thigh + calf
const DT = 1 / 60;
/** The way the creature faces, which is the hinge a knee bends about. */
const FWD = new THREE.Vector3(0, 0, 1);

/**
 * A pair of legs hanging from a hip bone, standing on a sphere of radius R.
 *
 * Built with real THREE.Bone objects and a real parent chain, because the solver walks that chain
 * and a mock would prove nothing about whether it walks it correctly.
 */
function buildLegs(feetApart = 30) {
  // A GROUP holding the skeleton, exactly as the renderers do — the body drop is applied there, and
  // the renderer rewrites its position every frame, which is what makes the correction idempotent.
  const group = new THREE.Group();
  const root = new THREE.Object3D();
  group.add(root);
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  // Hips at R + LEG, feet at R. Straight down the +Y axis, so "up" is +Y at this spot.
  const hips = bone('Hips', root, 0, R + LEG, 0);
  const mk = (side: 'L' | 'R', sx: number) => {
    const thigh = bone(`Thigh_${side}`, hips, sx * feetApart * 0.5, 0, 0);
    const calf = bone(`calf_${side.toLowerCase()}`, thigh, 0, -LEG * 0.5, 0);
    const foot = bone(`Foot_${side}`, calf, 0, -LEG * 0.5, 0);
    return { thigh, calf, foot };
  };
  mk('L', -1);
  mk('R', 1);
  group.updateMatrixWorld(true);
  return { root, hips, group };
}

/** Where each foot is, as a distance from the planet centre. */
/**
 * One frame, exactly as a renderer runs it: reset the group where the body says, then correct.
 *
 * The reset is not a convenience — it is the contract. plantFeet ADDS its drop to the group, which is
 * only safe because the renderer rewrites that position every single frame from the simulated body.
 * A test that skips the reset accumulates the drop forever and then reports that the limits do not
 * work, which is exactly what happened.
 */
function frame(id: string, rig: ReturnType<typeof findLegRig>, group: THREE.Object3D,
               ground: (d: THREE.Vector3) => number | null,
               rest?: Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>) {
  // THE MIXER, emulated. Every frame the animation rewrites every bone from the clip, and the solver
  // is called immediately after — so the foot it measures is always the CLIP's foot, never one it
  // already corrected. Skip this and the correction compounds: measured, the foot climbed 25 units
  // per frame until the leg ran out of reach, which is not a bug in the solver but a bug in asking
  // it to run without the thing it sits on top of.
  if (rest) {
    for (const [bone, r] of rest) { bone.position.copy(r.p); bone.quaternion.copy(r.q); }
  }
  group.position.set(0, 0, 0);
  group.updateMatrixWorld(true);
  const r = plantFeet(id, rig, group, R, ground, null, DT, 1, FWD);
  group.updateMatrixWorld(true);
  return r;
}

/** Snapshot every bone's local transform, to play back as the animation would. */
function restPose(root: THREE.Object3D) {
  const m = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) m.set(o, { p: o.position.clone(), q: o.quaternion.clone() });
  });
  return m;
}

/** Radius of the hips: the creature's actual height above the planet centre. */
function hipRadius(rig: ReturnType<typeof findLegRig>): number {
  const p = new THREE.Vector3();
  rig.hips!.getWorldPosition(p);
  return p.length();
}

function footRadii(rig: ReturnType<typeof findLegRig>) {
  const p = new THREE.Vector3();
  const get = (o: THREE.Object3D | undefined) => { o!.getWorldPosition(p); return p.length(); };
  return { l: get(rig.left?.foot), r: get(rig.right?.foot) };
}

console.log('\n== Feet on uneven ground ==\n');

// --- 1. THE ARITHMETIC ---------------------------------------------------------------------------
{
  const foot = new THREE.Vector3(0, 1000, 0);
  ok(Math.abs(footOffsetToGround(foot, 1000, 0)) < 1e-9,
     'a foot exactly on the ground needs no correction');
  ok(footOffsetToGround(foot, 1010, 0) > 9.9,
     'a foot below the ground is told to come UP', footOffsetToGround(foot, 1010, 0).toFixed(2));
  ok(footOffsetToGround(foot, 990, 0) < -9.9,
     'a foot floating above the ground is told to go DOWN', footOffsetToGround(foot, 990, 0).toFixed(2));
  ok(footOffsetToGround(foot, 1000, 5) > 4.9,
     'and a clearance term shifts it, for callers that want one');
}

// --- 2. THE RIG IS FOUND -------------------------------------------------------------------------
{
  const { root, group } = buildLegs();
  const rig = findLegRig(root);
  const rest = restPose(root);
  ok(rig.left != null && rig.right != null, 'both legs are found on a well-named rig');
  ok(rig.hips?.name === 'Hips', 'and the hips are DERIVED from the hierarchy, not matched by name',
     String(rig.hips?.name));
  // RADIAL, not the hypotenuse: the feet are set apart sideways, so a straight-line hips-to-foot
  // distance comes out longer than the creature actually stands and inflates every limit below it.
  ok(Math.abs(rig.standHeight - LEG) < 1, 'stand height is measured RADIALLY off the rig',
     rig.standHeight.toFixed(2));

  // A rig with no recognisable knee must decline rather than invent one.
  const bare = new THREE.Object3D();
  const b = new THREE.Bone(); b.name = 'Blob'; bare.add(b);
  const none = findLegRig(bare);
  ok(none.left == null && none.right == null, 'an unrecognisable rig is declined, not guessed at');
}

// --- 3. FLAT GROUND MUST CHANGE NOTHING ----------------------------------------------------------
// The most important negative test in the file: a solver that "fixes" flat ground is a solver that
// is fighting every animation in the game for no reason.
{
  clearFootIK();
  const { root, group } = buildLegs();
  const rig = findLegRig(root);
  const rest = restPose(root);
  const before = footRadii(rig);
  for (let i = 0; i < 120; i++) {
    frame('flat', rig, group, () => R);
  }
  const after = footRadii(rig);
  ok(Math.abs(after.l - before.l) < 0.5 && Math.abs(after.r - before.r) < 0.5,
     'on flat ground the feet are left exactly where the animation put them',
     `moved ${Math.abs(after.l - before.l).toFixed(3)} / ${Math.abs(after.r - before.r).toFixed(3)}`);
}

// --- 4. THE ACTUAL COMPLAINT: ONE FOOT ON A STEP -------------------------------------------------
{
  clearFootIK();
  const { root, group } = buildLegs();
  const rig = findLegRig(root);
  const rest = restPose(root);
  // The left foot is over ground 25 units higher than the right — a step, or a boulder.
  const ground = (dir: THREE.Vector3) => (dir.x < 0 ? R + 25 : R);

  for (let i = 0; i < 240; i++) {
    frame('step', rig, group, ground, rest);
  }
  const p = new THREE.Vector3();
  rig.left!.foot.getWorldPosition(p);
  const errL = Math.abs(p.length() - (R + 25));
  rig.right!.foot.getWorldPosition(p);
  const errR = Math.abs(p.length() - R);

  ok(errL < LEG * 0.08, 'the foot on the high ground sits on the high ground',
     `${errL.toFixed(1)} off, out of a ${LEG} leg`);
  ok(errR < LEG * 0.08, 'and the foot on the low ground sits on the low ground',
     `${errR.toFixed(1)} off`);
}

// --- 5. THE HIPS DROP RATHER THAN THE LEG STRETCHING ---------------------------------------------
// The step everyone skips. Without it the low leg simply extends, and a stretched leg looks far
// worse than a crouched one.
{
  clearFootIK();
  const { root, hips, group } = buildLegs();
  const rig = findLegRig(root);
  const rest = restPose(root);
  const hipBefore = hipRadius(rig);

  // Both feet over ground 20 units BELOW where the clip put them: the creature must sink.
  for (let i = 0; i < 240; i++) {
    frame('drop', rig, group, () => R - 20);
  }
  const dropped = hipBefore - hipRadius(rig);
  ok(dropped > 10, 'the hips lower toward the low ground instead of the legs stretching',
     `dropped ${dropped.toFixed(1)}`);

  // ...and the leg is still a leg afterwards.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  rig.left!.thigh.getWorldPosition(a);
  rig.left!.calf.getWorldPosition(b);
  rig.left!.foot.getWorldPosition(c);
  const len = a.distanceTo(b) + b.distanceTo(c);
  ok(Math.abs(len - LEG) < 1, 'and the bones never change length — IK bends, it does not stretch',
     `${len.toFixed(2)} vs ${LEG}`);
}

// --- 6. LIMITS, SO A CLIFF CANNOT FOLD THE CREATURE IN HALF ---------------------------------------
{
  clearFootIK();
  const { root, hips, group } = buildLegs();
  const rig = findLegRig(root);
  const rest = restPose(root);
  const before = hipRadius(rig);
  // Ground a kilometre below: a cliff edge. The creature must not sink into the earth trying.
  for (let i = 0; i < 300; i++) {
    frame('cliff', rig, group, () => R - 1000);
  }
  const dropped = before - hipRadius(rig);
  ok(dropped <= LEG * 0.35 + 1, 'a cliff edge crouches the creature, it does not swallow it',
     `dropped ${dropped.toFixed(1)}, capped at ${(LEG * 0.34).toFixed(1)}`);
}

// --- 7. UNKNOWN GROUND IS LEFT ALONE -------------------------------------------------------------
// Terrain streams in. A foot over a tile that has not arrived must keep the animation's pose rather
// than be moved somewhere invented — which is what a null return means and it has to be honoured.
{
  clearFootIK();
  const { root, group } = buildLegs();
  const rig = findLegRig(root);
  const rest = restPose(root);
  const before = footRadii(rig);
  for (let i = 0; i < 120; i++) {
    frame('void', rig, group, () => null);
  }
  const after = footRadii(rig);
  ok(Math.abs(after.l - before.l) < 0.5 && Math.abs(after.r - before.r) < 0.5,
     'a foot over unstreamed terrain keeps the pose the clip gave it');
}

// --- 8. IT EASES, IT DOES NOT SNAP ---------------------------------------------------------------
// Stepping off a kerb must not teleport the hips. One frame of correction should be a fraction of
// the whole, or every ledge produces a visible pop.
{
  clearFootIK();
  const { root, hips, group } = buildLegs();
  const rig = findLegRig(root);
  const rest = restPose(root);
  const start = hipRadius(rig);
    frame('ease', rig, group, () => R - 30);
  const moved = start - hipRadius(rig);
  ok(moved > 0 && moved < 30 * 0.5, 'one frame moves part of the way, not all of it',
     `${moved.toFixed(2)} of 30`);
}

console.log(`\n${failures === 0 ? 'FOOT IK CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
