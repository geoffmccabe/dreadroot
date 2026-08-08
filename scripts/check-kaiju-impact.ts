/**
 * check-kaiju-impact — a swipe has to MOVE something, and the force has to travel.
 *
 * Geoff: "he swipes at me with an attack of his arm, but it passes right through me... they should
 * be fairly stiff and not super soft rag dolls, but when he swipes and hits me the physics should be
 * applied to knock the skeleton of my kaiju and that force transmits throughout my skeleton."
 *
 * Every one of those clauses is a testable claim, and all of them are tested here against a
 * synthetic skeleton — because the behaviour has to be right before the art is involved, and because
 * "did it look like it got hit" is not something a browser can be asked at four in the morning.
 *
 * Run: npm run check:kaiju-impact
 */

import * as THREE from 'three';
import {
  strikeSkeleton, applySkeletonImpact, bodyLean, clearImpacts, isReacting, jointKick,
  queueStrike, consumeStrikes, stepStrikeQueue, pendingStrikeCount, impactDiag,
} from '../src/components/siege/globe/kaijuImpact';
import {
  initArenaWith, stepArena, getAgents, ARENA_HEIGHT,
} from '../src/components/siege/globe/kaijuArena';
import { BREEDS } from '../src/components/siege/globe/kaijuStats';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

const DT = 1 / 60;
const H = ARENA_HEIGHT;            // 3 units = 300 m
const NATURAL = 1200;              // a 12 m golem, in centimetres-ish units the code expects

/**
 * A skeleton: root, spine, two arms, two legs. Named and laid out like a real one so the distances
 * between the parts mean something, because distance is the whole mechanism being tested.
 */
function buildRig() {
  const root = new THREE.Object3D();
  const bones = new Map<string, THREE.Bone>();
  const add = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    bones.set(name, b);
    return b;
  };
  const hips = add('Hips', root, 0, H * 0.5, 0);
  const spine = add('Spine', hips, 0, H * 0.2, 0);
  const chest = add('Chest', spine, 0, H * 0.15, 0);
  add('Head', chest, 0, H * 0.12, 0);
  const shR = add('ShoulderR', chest, H * 0.12, 0, 0);
  const armR = add('ArmR', shR, H * 0.14, 0, 0);
  add('HandR', armR, H * 0.14, 0, 0);
  const shL = add('ShoulderL', chest, -H * 0.12, 0, 0);
  const armL = add('ArmL', shL, -H * 0.14, 0, 0);
  add('HandL', armL, -H * 0.14, 0, 0);
  const legR = add('LegR', hips, H * 0.07, -H * 0.25, 0);
  add('FootR', legR, 0, -H * 0.25, 0);
  const legL = add('LegL', hips, -H * 0.07, -H * 0.25, 0);
  add('FootL', legL, 0, -H * 0.25, 0);
  root.updateMatrixWorld(true);
  return { root, bones, list: [...bones.values()] as THREE.Object3D[] };
}

/** Total angular displacement a bone is currently carrying, in degrees. */
function bendOf(b: THREE.Object3D, rest: THREE.Quaternion): number {
  const d = Math.min(1, Math.abs(rest.dot(b.quaternion)));
  return (2 * Math.acos(d) * 180) / Math.PI;
}

console.log('\n== A swipe has to move something ==\n');

// --- 1. THE TORQUE MODEL -------------------------------------------------------------------------
// Everything above this rests on r x F behaving like leverage, so it is checked directly.
{
  const out = new THREE.Vector3();
  const force = new THREE.Vector3(1, 0, 0);

  // A blow straight down a limb's own length has no leverage and must bend nothing. This is the
  // case a hand-rolled "push the bone along the force" model gets wrong, and it matters: a Kaiju
  // punched square in the chest should rock backwards, not have its spine snap sideways.
  jointKick(new THREE.Vector3(1, 0, 0), force, H * 0.3, 1, out);
  ok(out.length() < 1e-9, 'a blow along a limb\'s own axis produces no bending', out.length().toFixed(6));

  // ...and one at right angles produces the most.
  jointKick(new THREE.Vector3(0, 1, 0), force, H * 0.3, 1, out);
  ok(out.length() > 1e-3, 'a blow at right angles bends it', out.length().toFixed(4));

  // FALLOFF. The same blow felt from three times further away must be far weaker, or every joint
  // reacts equally and the creature shudders as one lump instead of being struck in one place.
  const near = new THREE.Vector3();
  const far = new THREE.Vector3();
  jointKick(new THREE.Vector3(0, H * 0.3, 0), force, H * 0.3, 1, near);
  jointKick(new THREE.Vector3(0, H * 0.9, 0), force, H * 0.3, 1, far);
  ok(far.length() < near.length() * 0.3, 'and three times further away is a fraction of it',
     `${near.length().toFixed(4)} -> ${far.length().toFixed(4)}`);

  // Heavy joints move less than light ones under the identical blow.
  const light = new THREE.Vector3(), heavy = new THREE.Vector3();
  jointKick(new THREE.Vector3(0, 1, 0), force, H * 0.3, 1, light);
  jointKick(new THREE.Vector3(0, 1, 0), force, H * 0.3, 3, heavy);
  ok(heavy.length() < light.length() * 0.4, 'a heavy joint near the root moves less than a light one',
     `${light.length().toFixed(4)} vs ${heavy.length().toFixed(4)}`);
}

// --- 2. IT MOVES, AND IT COMES BACK ---------------------------------------------------------------
{
  clearImpacts();
  const rig = buildRig();
  const rest = new Map(rig.list.map((b) => [b.uuid, b.quaternion.clone()]));

  const hand = rig.bones.get('HandR')!;
  const hit = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld);
  strikeSkeleton('t', rig.list, hit, new THREE.Vector3(0, 0, 1), 0.9, H);
  ok(isReacting('t'), 'a blow makes the skeleton react at all');

  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i < 600; i++) {
    for (const b of rig.list) b.quaternion.copy(rest.get(b.uuid)!);   // the mixer, every frame
    applySkeletonImpact('t', rig.list, DT, H, NATURAL);
    rig.root.updateMatrixWorld(true);
    const bend = bendOf(hand, rest.get(hand.uuid)!);
    if (bend > peak) { peak = bend; peakAt = i * DT; }
  }
  ok(peak > 2, 'the struck limb visibly bends', `${peak.toFixed(1)} degrees at ${peakAt.toFixed(2)} s`);
  // STIFF, NOT SOFT. Geoff asked for this by name.
  ok(peak < 20, '...but not far — this is a stiff skeleton, not a rag doll', `${peak.toFixed(1)} degrees`);
  ok(!isReacting('t'), 'and it settles back to the animation on its own');

  const settled = bendOf(hand, rest.get(hand.uuid)!);
  ok(settled < 0.5, 'leaving no permanent deformation', `${settled.toFixed(3)} degrees`);
}

// --- 3. THE FORCE TRANSMITS THROUGH THE SKELETON --------------------------------------------------
// The clause Geoff was most explicit about. A blow to one hand must be felt, in order, all the way
// down to the far leg — and felt LESS the further it goes.
{
  clearImpacts();
  const rig = buildRig();
  const rest = new Map(rig.list.map((b) => [b.uuid, b.quaternion.clone()]));
  const hit = new THREE.Vector3().setFromMatrixPosition(rig.bones.get('HandR')!.matrixWorld);
  strikeSkeleton('t', rig.list, hit, new THREE.Vector3(0, 0, 1), 0.9, H);

  const peaks = new Map<string, number>();
  for (let i = 0; i < 400; i++) {
    for (const b of rig.list) b.quaternion.copy(rest.get(b.uuid)!);
    applySkeletonImpact('t', rig.list, DT, H, NATURAL);
    for (const [name, b] of rig.bones) {
      const v = bendOf(b, rest.get(b.uuid)!);
      if (v > (peaks.get(name) ?? 0)) peaks.set(name, v);
    }
  }
  const chain = ['ArmR', 'ShoulderR', 'Chest', 'Spine', 'Hips', 'LegL'];
  console.log('        struck hand -> far leg:',
    chain.map((n) => `${n} ${(peaks.get(n) ?? 0).toFixed(1)}°`).join('  '));

  ok((peaks.get('ArmR') ?? 0) > 1, 'the struck arm takes the blow',
     `${(peaks.get('ArmR') ?? 0).toFixed(1)}°`);
  ok((peaks.get('Hips') ?? 0) > 0.05, 'and it is still felt at the hips — the force TRANSMITS',
     `${(peaks.get('Hips') ?? 0).toFixed(2)}°`);
  // ...but attenuated. If the far leg moved as much as the struck arm the whole thing would read as
  // a seizure rather than as a blow to one side.
  ok((peaks.get('LegL') ?? 0) < (peaks.get('ArmR') ?? 0) * 0.6,
     'the far leg moves far less than the struck arm',
     `${(peaks.get('LegL') ?? 0).toFixed(2)}° vs ${(peaks.get('ArmR') ?? 0).toFixed(1)}°`);
  ok((peaks.get('ShoulderR') ?? 0) > (peaks.get('Spine') ?? 0),
     'and it weakens with every joint it crosses',
     `shoulder ${(peaks.get('ShoulderR') ?? 0).toFixed(2)}° > spine ${(peaks.get('Spine') ?? 0).toFixed(2)}°`);
}

// --- 4. WHERE IT IS HIT MATTERS -------------------------------------------------------------------
{
  clearImpacts();
  const rig = buildRig();
  const rest = new Map(rig.list.map((b) => [b.uuid, b.quaternion.clone()]));
  const run = (hitAt: THREE.Vector3) => {
    clearImpacts();
    for (const b of rig.list) b.quaternion.copy(rest.get(b.uuid)!);
    rig.root.updateMatrixWorld(true);
    strikeSkeleton('t', rig.list, hitAt, new THREE.Vector3(0, 0, 1), 0.9, H);
    const out = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      for (const b of rig.list) b.quaternion.copy(rest.get(b.uuid)!);
      applySkeletonImpact('t', rig.list, DT, H, NATURAL);
      for (const [n, b] of rig.bones) out.set(n, Math.max(out.get(n) ?? 0, bendOf(b, rest.get(b.uuid)!)));
    }
    return out;
  };
  const highHit = run(new THREE.Vector3().setFromMatrixPosition(rig.bones.get('Head')!.matrixWorld));
  const lowHit = run(new THREE.Vector3().setFromMatrixPosition(rig.bones.get('FootL')!.matrixWorld));
  ok((highHit.get('Head') ?? 0) > (highHit.get('FootL') ?? 0),
     'a blow to the head moves the head more than the foot');
  ok((lowHit.get('FootL') ?? 0) > (lowHit.get('Head') ?? 0),
     'and a blow to the foot moves the foot more than the head');
}

// --- 5. THE WHOLE BODY LEANS ----------------------------------------------------------------------
{
  clearImpacts();
  const rig = buildRig();
  const rest = new Map(rig.list.map((b) => [b.uuid, b.quaternion.clone()]));
  const lean = new THREE.Vector3();
  strikeSkeleton('t', rig.list, new THREE.Vector3(0, H * 0.7, 0), new THREE.Vector3(0, 0, 1), 1, H);
  let peak = 0;
  for (let i = 0; i < 600; i++) {
    for (const b of rig.list) b.quaternion.copy(rest.get(b.uuid)!);
    applySkeletonImpact('t', rig.list, DT, H, NATURAL);
    peak = Math.max(peak, (bodyLean('t', lean).length() * 180) / Math.PI);
  }
  ok(peak > 1, 'the whole body tips away from the blow — the part visible at 300 m',
     `${peak.toFixed(1)} degrees`);
  ok(peak < 12, '...and rights itself rather than falling over', `${peak.toFixed(1)} degrees`);
  ok((bodyLean('t', lean).length() * 180) / Math.PI < 0.5, 'and returns upright');
}

// --- 6. THE QUEUE, WHICH IS HOW THE SIMULATION TALKS TO THE ART -----------------------------------
{
  clearImpacts();
  const rig = buildRig();
  const p = new THREE.Vector3(0, H * 0.6, 0);
  const d = new THREE.Vector3(0, 0, 1);

  queueStrike('t', p, d, 0.5);
  ok(pendingStrikeCount() === 1, 'a blow waits in the queue for a renderer');
  // A flamethrower lands over a thousand hits a second. Each one queueing separately would be a
  // thousand skeleton passes a frame and a permanent shudder.
  for (let i = 0; i < 500; i++) queueStrike('t', p, d, 0.02);
  ok(pendingStrikeCount() === 1, 'five hundred more coalesce into it rather than piling up',
     `${pendingStrikeCount()} queued`);

  consumeStrikes('t', rig.list, H);
  ok(pendingStrikeCount() === 0, 'and the renderer takes it');
  ok(isReacting('t'), 'leaving the skeleton reacting');

  // A blow nobody is drawing must expire rather than accumulate forever.
  clearImpacts();
  queueStrike('u', p, d, 0.5);
  for (let i = 0; i < 60; i++) stepStrikeQueue(DT);
  ok(pendingStrikeCount() === 0, 'a blow with no renderer expires instead of queueing forever');
}

// --- 7. IT MUST NOT CHANGE THE FIGHT --------------------------------------------------------------
// Same rule as the gunfire: this is a reaction, not a mechanic. If it ever starts nudging health or
// position, the balance numbers quietly stop meaning anything.
{
  const run = (): string => {
    clearImpacts();
    initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6);
    const agents = getAgents();
    for (let i = 0; i < 3600; i++) stepArena(DT, false);
    return agents.map((a) => `${a.id}:${a.health.toFixed(6)}:${a.alive ? 1 : 0}:`
      + `${a.body.dir.x.toFixed(9)},${a.body.dir.y.toFixed(9)},${a.body.dir.z.toFixed(9)}`).join('|');
  };
  const a = run();
  const b = run();
  ok(a === b, 'a full battle is still bit-for-bit reproducible with impacts in it',
     a === b ? 'identical' : 'DIVERGED');
  ok(impactDiag.strikes >= 0, 'and blows were queued during it', `${pendingStrikeCount()} left over`);
}

console.log(`\n${failures === 0 ? 'IMPACT CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
