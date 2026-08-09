/**
 * check-kaiju-burn — fire that lands on a Kaiju must STAY on that part of it, and travel with it.
 *
 * Geoff: "the flame should burn for some time on the kaiju's mesh if it hits... The particular body
 * part needs to burn and on the mesh... and if that kaiju is moving or walking or animating, the
 * fire needs to move with them."
 *
 * The middle clause is the whole difficulty and the one thing worth asserting: a burn recorded as a
 * world position is fire hanging in the air a second later, with the creature walking out from under
 * it. So the test moves the skeleton and demands the fire moved with it.
 *
 * Run: npm run check:kaiju-burn
 */

import * as THREE from 'three';
import { registerHitMesh, unregisterHitMesh } from '../src/components/siege/globe/kaijuMeshHit';
import {
  igniteMesh, stepBurns, getBurns, clearBurns, burnIntensity, burnDiag,
} from '../src/components/siege/globe/kaijuBurn';
import { PLANET_RADIUS } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** A creature with a shoulder and a hip far apart, so "which bone" is a question with an answer. */
function buildRig(id: string) {
  const root = new THREE.Group();
  root.position.set(0, PLANET_RADIUS, 0);
  const hips = new THREE.Bone(); hips.name = 'Hips'; hips.position.set(0, 1.5, 0);
  const shoulder = new THREE.Bone(); shoulder.name = 'Shoulder'; shoulder.position.set(0, 1.2, 0);
  const hand = new THREE.Bone(); hand.name = 'Hand'; hand.position.set(1.2, 0, 0);
  shoulder.add(hand);
  hips.add(shoulder);
  root.add(hips);
  // A mesh has to exist for the registry to accept it; the burn only ever uses the bones.
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), new THREE.MeshBasicMaterial());
  root.add(m);
  root.updateMatrixWorld(true);
  registerHitMesh(id, root);
  return { root, hips, shoulder, hand };
}

const DT = 1 / 60;
console.log('\n== Fire burns on the body part it landed on ==\n');

// --- 1. IT LIGHTS, AND IT GOES OUT ----------------------------------------------------------------
{
  clearBurns();
  const rig = buildRig('k');
  const at = new THREE.Vector3().setFromMatrixPosition(rig.hand.matrixWorld);

  ok(igniteMesh('k', at, 0.2), 'a flame that connects sets the creature alight');
  stepBurns(DT);
  const b = getBurns().find((x) => x.live)!;
  ok(b != null, 'and there is a fire burning');
  ok(b.life >= 10 && b.life <= 15, 'for ten to fifteen seconds, as asked', `${b.life.toFixed(1)} s`);
  ok(burnIntensity(b) < 0.3, 'it catches rather than starting at full blaze',
     burnIntensity(b).toFixed(2));

  // Run it out.
  for (let i = 0; i < 60 * 16; i++) stepBurns(DT);
  ok(!getBurns().some((x) => x.live), 'and it burns itself out');
}

// --- 2. IT MOVES WITH THE BODY PART -----------------------------------------------------------------
// THE CLAUSE THAT MATTERS. A burn stored as a world position fails this and looks fine until the
// creature takes one step.
{
  clearBurns();
  const rig = buildRig('k2');
  const handAt = new THREE.Vector3().setFromMatrixPosition(rig.hand.matrixWorld);
  igniteMesh('k2', handAt, 0.2);
  stepBurns(DT);
  const b = getBurns().find((x) => x.live)!;
  const before = b.world.clone();
  ok(before.distanceTo(handAt) < 0.05, 'the fire starts where the flame struck',
     `${before.distanceTo(handAt).toFixed(3)} away`);

  // SWING THE ARM. This is a walk, an attack, anything at all.
  rig.shoulder.rotation.z = -1.1;
  rig.root.updateMatrixWorld(true);
  stepBurns(DT);
  const handNow = new THREE.Vector3().setFromMatrixPosition(rig.hand.matrixWorld);
  ok(handNow.distanceTo(handAt) > 0.5, 'the arm really moved', `${handNow.distanceTo(handAt).toFixed(2)}`);
  ok(b.world.distanceTo(handNow) < 0.05,
     'and the fire went with the HAND, not left behind in the air',
     `${b.world.distanceTo(handNow).toFixed(4)} from the hand`);
  ok(b.world.distanceTo(before) > 0.5, 'so it is no longer where it started',
     `moved ${b.world.distanceTo(before).toFixed(2)}`);

  // WALK THE WHOLE CREATURE. Same requirement, different transform.
  rig.root.position.x += 3;
  rig.root.updateMatrixWorld(true);
  stepBurns(DT);
  const walked = new THREE.Vector3().setFromMatrixPosition(rig.hand.matrixWorld);
  ok(b.world.distanceTo(walked) < 0.05, 'and it travels when the creature walks',
     `${b.world.distanceTo(walked).toFixed(4)} from the hand`);
}

// --- 3. THE RIGHT BODY PART -----------------------------------------------------------------------
{
  clearBurns();
  const rig = buildRig('k3');
  const hipAt = new THREE.Vector3().setFromMatrixPosition(rig.hips.matrixWorld);
  igniteMesh('k3', hipAt, 0.2);
  stepBurns(DT);
  const b = getBurns().find((x) => x.live)!;
  // Move ONLY the arm. A fire lit on the hips must not care.
  const wasAt = b.world.clone();
  rig.shoulder.rotation.z = 1.3;
  rig.root.updateMatrixWorld(true);
  stepBurns(DT);
  ok(b.world.distanceTo(wasAt) < 0.05,
     'a fire on the hips ignores the arm swinging — it is attached to the part it hit',
     `${b.world.distanceTo(wasAt).toFixed(4)} of drift`);
}

// --- 4. A JET DOES NOT DROWN IT --------------------------------------------------------------------
// A flamethrower lands well over a thousand hits a second. Without merging, a jet held on one spot
// fills the pool in a frame and the creature is a solid disc of sprites.
{
  clearBurns();
  const rig = buildRig('k4');
  const at = new THREE.Vector3().setFromMatrixPosition(rig.hips.matrixWorld);
  for (let i = 0; i < 500; i++) igniteMesh('k4', at, 0.2);
  stepBurns(DT);
  const lit = getBurns().filter((x) => x.live).length;
  ok(lit <= 3, 'five hundred hits on one spot make ONE fire, not five hundred', `${lit} alight`);
  ok(burnDiag.merged > 400, 'because they feed the existing one', `${burnDiag.merged} merged`);
  const b = getBurns().find((x) => x.live)!;
  ok(b.size > 0.2 * 1.8, 'and being fed makes it bigger', `size ${b.size.toFixed(2)}`);

  // ...and hits spread over the body DO make separate fires.
  clearBurns();
  igniteMesh('k4', at, 0.2);
  igniteMesh('k4', new THREE.Vector3().setFromMatrixPosition(rig.hand.matrixWorld), 0.2);
  stepBurns(DT);
  ok(getBurns().filter((x) => x.live).length === 2,
     'but two hits on different limbs are two fires');
}

// --- 5. NO MODEL, NO FIRE --------------------------------------------------------------------------
{
  clearBurns();
  ok(!igniteMesh('ghost', new THREE.Vector3(0, PLANET_RADIUS, 0), 0.2),
     'a Kaiju with no rig cannot be set alight — better than fire that cannot follow it');
  unregisterHitMesh('k4');
  clearBurns();
  const rig = buildRig('k5');
  igniteMesh('k5', new THREE.Vector3().setFromMatrixPosition(rig.hips.matrixWorld), 0.2);
  stepBurns(DT);
  ok(getBurns().some((x) => x.live), 'a lit fire exists');
  unregisterHitMesh('k5');
  stepBurns(DT);
  ok(!getBurns().some((x) => x.live), 'and it goes out when the model unmounts');
}

console.log(`\n${failures === 0 ? 'BURN CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
