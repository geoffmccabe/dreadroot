/**
 * check-meshhit-prefilter — the pre-filter must be FAST and must never lose a hit.
 *
 * Geoff: "audit that and make sure it's fixed."
 *
 * The five-frames-a-second fix was to put a cheap capsule test in front of the mesh raycast, so most
 * rounds never pay for a full walk of every triangle. That is only sound if the cheap test is
 * CONSERVATIVE: it may say yes when the answer is no (costing a wasted ray), but it must never say
 * no when the mesh would have said yes, because that is a bullet silently passing through a Kaiju —
 * which is the exact bug this whole system has already been through twice.
 *
 * So this builds a real THREE.SkinnedMesh with a real skeleton, fires thousands of rays at it from
 * every angle, and compares the pre-filter against a raycast done independently with three.js's own
 * Raycaster. Two numbers come out: how many rays the filter saves, and how many hits it loses. The
 * second must be zero.
 *
 * Run: npm run check:meshhit-prefilter
 */

import * as THREE from 'three';
import {
  registerRig, updateRigCapsules, unregisterRig, rigLimbCount,
} from '../src/components/siege/globe/kaijuColliders';
import {
  registerHitMesh, unregisterHitMesh, testNearGeometry as nearGeometry,
} from '../src/components/siege/globe/kaijuMeshHit';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== The mesh pre-filter is conservative, and worth having ==\n');

/**
 * A crude humanoid: a box per body part, every vertex bound to that part's bone.
 *
 * Deliberately built from separate limbs rather than one blob, because the whole question is whether
 * a shot through the GAP between an arm and the body — which the mesh misses and a fat capsule
 * catches — is handled the right way round.
 */
const ROOT = new THREE.Object3D();
const bones: THREE.Bone[] = [];
const parts: { name: string; pos: [number, number, number]; size: [number, number, number] }[] = [
  { name: 'Neck_01',    pos: [0, 1.5, 0],     size: [0.18, 0.18, 0.18] },
  { name: 'Head',       pos: [0, 1.75, 0],    size: [0.28, 0.3, 0.28] },
  { name: 'Spine_01',   pos: [0, 1.05, 0],    size: [0.6, 0.9, 0.34] },
  { name: 'upperarm_l', pos: [-0.42, 1.35, 0], size: [0.18, 0.18, 0.18] },
  { name: 'hand_l',     pos: [-0.95, 1.35, 0], size: [0.16, 0.16, 0.16] },
  { name: 'upperarm_r', pos: [0.42, 1.35, 0],  size: [0.18, 0.18, 0.18] },
  { name: 'hand_r',     pos: [0.95, 1.35, 0],  size: [0.16, 0.16, 0.16] },
  { name: 'thigh_l',    pos: [-0.17, 0.75, 0], size: [0.22, 0.22, 0.22] },
  { name: 'foot_l',     pos: [-0.17, 0.06, 0], size: [0.2, 0.12, 0.34] },
  { name: 'thigh_r',    pos: [0.17, 0.75, 0],  size: [0.22, 0.22, 0.22] },
  { name: 'foot_r',     pos: [0.17, 0.06, 0],  size: [0.2, 0.12, 0.34] },
];

const geos: THREE.BufferGeometry[] = [];
parts.forEach((p, i) => {
  const b = new THREE.Bone();
  b.name = p.name;
  b.position.set(...p.pos);
  ROOT.add(b);
  bones.push(b);
  const g = new THREE.BoxGeometry(...p.size);
  g.translate(...p.pos);
  const n = g.attributes.position.count;
  const si: number[] = [], sw: number[] = [];
  for (let v = 0; v < n; v++) { si.push(i, 0, 0, 0); sw.push(1, 0, 0, 0); }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geos.push(g);
});

// One merged geometry, the way a real character is one skinned mesh.
const merged = new THREE.BufferGeometry();
{
  const pos: number[] = [], si: number[] = [], sw: number[] = [];
  for (const g of geos) {
    const gp = g.attributes.position, gi = g.index!;
    const gsi = g.attributes.skinIndex, gsw = g.attributes.skinWeight;
    for (let k = 0; k < gi.count; k++) {
      const v = gi.getX(k);
      pos.push(gp.getX(v), gp.getY(v), gp.getZ(v));
      si.push(gsi.getX(v), 0, 0, 0);
      sw.push(gsw.getX(v), 0, 0, 0);
    }
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  merged.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}
const mesh = new THREE.SkinnedMesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
ROOT.add(mesh);
// MATRICES BEFORE THE SKELETON. Skeleton's constructor computes each bone's inverse bind matrix from
// its matrixWorld, so building it first records every bone as sitting at the origin — which is
// exactly the artefact that made the first run of this audit report a useless filter. The real game
// is not exposed to it (a glTF arrives with its inverses baked in) but the test has to be honest.
ROOT.updateMatrixWorld(true);
const skeleton = new THREE.Skeleton(bones);
mesh.bind(skeleton);
ROOT.updateMatrixWorld(true);

registerRig('audit', ROOT);
ok(rigLimbCount('audit') === 5, 'the audit rig has all five limbs', `${rigLimbCount('audit')}`);
updateRigCapsules('audit', 2);
registerHitMesh('audit', ROOT);

// Ground truth: three.js's own raycaster, with nothing of ours in the way.
const raycaster = new THREE.Raycaster();
const hits: THREE.Intersection[] = [];
function trueHit(from: THREE.Vector3, to: THREE.Vector3): boolean {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-9) return false;
  dir.divideScalar(len);
  raycaster.set(from, dir);
  raycaster.near = 0;
  raycaster.far = len;
  hits.length = 0;
  raycaster.intersectObject(mesh, false, hits);
  return hits.length > 0;
}

// A deterministic spread of shots from every direction, at every height, near and far.
let s = 12345;
const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

let tested = 0, accepted = 0, realHits = 0, lostHits = 0, wasted = 0;
const from = new THREE.Vector3(), to = new THREE.Vector3();
for (let i = 0; i < 20000; i++) {
  // Start somewhere on a shell around the figure, aim at a point in its bounding box.
  const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), R = 3 + rnd() * 4;
  from.set(Math.sin(ph) * Math.cos(th) * R, 1 + Math.cos(ph) * R * 0.5, Math.sin(ph) * Math.sin(th) * R);
  to.set((rnd() - 0.5) * 2.6, rnd() * 2.1, (rnd() - 0.5) * 1.2);
  // Short segments, the way a bullet moves in one frame: extend a little past the aim point.
  to.sub(from).normalize().multiplyScalar(R + 1).add(from);

  tested++;
  const near = nearGeometry('audit', from, to);
  const real = trueHit(from, to);
  if (near) accepted++;
  if (real) realHits++;
  if (real && !near) lostHits++;
  if (near && !real) wasted++;
}

console.log(`\n  ${tested} shots fired at the figure from every angle`);
console.log(`  ${realHits} genuinely hit the mesh`);
console.log(`  ${accepted} passed the pre-filter (${((accepted / tested) * 100).toFixed(1)}%)`);
console.log(`  ${wasted} passed it and then missed — wasted rays, the price of being safe`);
console.log(`  ${lostHits} REAL HITS LOST\n`);

// THE ONE THAT MATTERS.
ok(lostHits === 0, 'the pre-filter never rejects a shot the mesh would have hit',
   `${lostHits} lost of ${realHits}`);
// ...and it has to actually save something, or it is pure cost.
ok(accepted < tested * 0.6, 'and it rejects most shots outright, which is the point',
   `${((1 - accepted / tested) * 100).toFixed(0)}% of rays never reach the mesh`);

// AND IT MUST FOLLOW THE POSE. Raise an arm; a shot at where the arm now is must be accepted.
{
  const hand = ROOT.getObjectByName('hand_l') as THREE.Bone;
  hand.position.set(-0.95, 2.6, 0);
  ROOT.updateMatrixWorld(true);
  updateRigCapsules('audit', 2);
  ok(nearGeometry('audit', new THREE.Vector3(-0.95, 2.6, -4), new THREE.Vector3(-0.95, 2.6, 4)),
     'raising an arm moves the pre-filter with it');
}

// FAIL OPEN. With no capsules at all it must let everything through rather than block everything.
{
  unregisterRig('audit');
  ok(nearGeometry('audit', new THREE.Vector3(0, 1, -4), new THREE.Vector3(0, 1, 4)),
     'with no capsules it fails OPEN, never closed');
}
unregisterHitMesh('audit');

console.log(`\n${failures === 0 ? 'PRE-FILTER AUDIT PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
