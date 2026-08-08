/**
 * check-kaiju-gunfire — the army shoots, the bullets land where a limb actually is, and nothing
 * about the fight changes.
 *
 * Geoff: "each one will fire a bullet every 1-10 seconds... They do no damage... but I want to be
 * able to see the muzzle flashes."
 *
 * "They do no damage" is the load-bearing requirement and the easiest one to break by accident, so
 * it is asserted directly: a full battle is run twice, once with two hundred riflemen emptying into
 * it and once in silence, and the two must end in the same state to the last decimal. If firing ever
 * starts nudging health, aggro or position, this fails immediately rather than in six weeks when the
 * balance numbers stop making sense.
 *
 * It also builds a SYNTHETIC RIG — real THREE.Bone objects in the shape of a skeleton — because the
 * limb capsules are the reason this feature works at all and there is no model loader headless. The
 * bone NAMES are checked against the real .glb files separately by scripts/check-limb-bones.mjs.
 *
 * Run: npm run check:kaiju-gunfire
 */

import * as THREE from 'three';
import {
  initArenaWith, stepArena, getAgents, ARENA_HEIGHT,
} from '../src/components/siege/globe/kaijuArena';
import { BREEDS } from '../src/components/siege/globe/kaijuStats';
import {
  registerRig, unregisterRig, updateRigCapsules, limbCapsules, rigLimbCount,
  torsoCapsule, shotHitsCapsule, segmentDistance,
} from '../src/components/siege/globe/kaijuColliders';
import {
  fireBullet, stepGunfire, getShots, clearGunfire, gunfireDiag,
  chooseTarget, aimPoint, nextShotDelay, SPARK_LIFE, TRACER_LIFE,
} from '../src/components/siege/globe/kaijuGunfire';
import { METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

const DT = 1 / 60;
console.log('\n== The army shoots at the monster ==\n');

// --- 1. THE GEOMETRY -----------------------------------------------------------------------------
// Everything downstream is a lie if a bullet cannot tell a hit from a miss.
{
  const cap = {
    a: new THREE.Vector3(0, 0, 0), b: new THREE.Vector3(0, 10, 0),
    radius: 2, part: 'torso' as const,
  };
  const hit = new THREE.Vector3();

  const t1 = shotHitsCapsule(new THREE.Vector3(-20, 5, 0), new THREE.Vector3(20, 5, 0), cap, hit);
  ok(t1 != null, 'a bullet through the middle of a capsule hits it');
  // The spark must sit on the NEAR surface. Through the centre of a radius-2 capsule from x=-20,
  // that is x = -2, and anything else means the impact is drawn inside the creature.
  ok(t1 != null && Math.abs(hit.x + 2) < 0.15,
     'the impact point is on the near surface, not at closest approach', `x = ${hit.x.toFixed(2)}`);

  ok(shotHitsCapsule(new THREE.Vector3(-20, 5, 8), new THREE.Vector3(20, 5, 8), cap, hit) == null,
     'a bullet passing well to one side misses');
  ok(shotHitsCapsule(new THREE.Vector3(-20, 40, 0), new THREE.Vector3(20, 40, 0), cap, hit) == null,
     'a bullet passing well overhead misses');
  // A shot that STOPS short must not register. Without this, an aim point in front of the target
  // would still "hit" whatever lay beyond it.
  ok(shotHitsCapsule(new THREE.Vector3(-20, 5, 0), new THREE.Vector3(-10, 5, 0), cap, hit) == null,
     'a bullet that stops short of the target does not hit it');

  const tp = new Float64Array(1);
  const d = segmentDistance(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0),
    new THREE.Vector3(5, 3, 0), new THREE.Vector3(5, 9, 0), tp,
  );
  ok(Math.abs(d - 3) < 1e-6 && Math.abs(tp[0] - 0.5) < 1e-6,
     'segment distance and parameter are exact on a known case', `d=${d.toFixed(4)} t=${tp[0].toFixed(3)}`);
}

// --- 2. THE LIMB RIG -----------------------------------------------------------------------------
// The system this feature depends on had NO CALLERS AT ALL until now, so it is proved from scratch.
{
  const root = new THREE.Object3D();
  const bone = (name: string, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    root.add(b);
    return b;
  };
  // Roughly a person: spread arms, legs down, head up. Absolute positions, parented flat, which is
  // all updateRigCapsules needs since it reads WORLD positions.
  bone('Neck_01', 0, 1.5, 0); bone('Head', 0, 1.75, 0);
  bone('upperarm_l', -0.25, 1.4, 0); bone('hand_l', -0.9, 1.4, 0);
  bone('upperarm_r', 0.25, 1.4, 0); bone('hand_r', 0.9, 1.4, 0);
  bone('thigh_l', -0.15, 0.9, 0); bone('foot_l', -0.15, 0.05, 0);
  bone('thigh_r', 0.15, 0.9, 0); bone('foot_r', 0.15, 0.05, 0);
  root.updateMatrixWorld(true);

  registerRig('test', root);
  ok(rigLimbCount('test') === 5, 'all five limbs are found on a well-named rig',
     `${rigLimbCount('test')} of 5`);

  ok(limbCapsules('test').length === 0,
     'capsules are EMPTY until the pose is read — a rig alone is not a collider');

  updateRigCapsules('test', ARENA_HEIGHT);
  const caps = limbCapsules('test');
  ok(caps.length === 5, 'reading the pose produces five capsules', `${caps.length}`);
  const parts = caps.map((c) => c.part).sort().join(',');
  ok(parts === 'armL,armR,head,legL,legR', 'and they are the right five', parts);

  // A shot aimed at the LEFT HAND must come back as the left arm, not as whatever is nearest the
  // middle. This is the entire point of per-limb colliders.
  const hit = new THREE.Vector3();
  const armL = caps.find((c) => c.part === 'armL')!;
  const t = shotHitsCapsule(new THREE.Vector3(-0.9, 1.4, -5), new THREE.Vector3(-0.9, 1.4, 5), armL, hit);
  ok(t != null, 'a shot at the outstretched left hand hits the left arm capsule');

  // ...and the same shot must MISS the legs, or "per limb" means nothing.
  const legR = caps.find((c) => c.part === 'legR')!;
  ok(shotHitsCapsule(new THREE.Vector3(-0.9, 1.4, -5), new THREE.Vector3(-0.9, 1.4, 5), legR, hit) == null,
     'and misses the far leg entirely');

  // MOVING THE SKELETON MOVES THE COLLIDER. A capsule that does not follow the animation is a
  // capsule that will be in the wrong place every time the creature does anything interesting.
  const before = caps.find((c) => c.part === 'armL')!.b.clone();
  root.getObjectByName('hand_l')!.position.set(-0.9, 2.6, 0);
  root.updateMatrixWorld(true);
  updateRigCapsules('test', ARENA_HEIGHT);
  const after = limbCapsules('test').find((c) => c.part === 'armL')!.b;
  ok(after.distanceTo(before) > 1, 'raising the arm moves its collider with it',
     `moved ${after.distanceTo(before).toFixed(2)}`);

  unregisterRig('test');
  ok(limbCapsules('test').length === 0, 'unregistering removes the rig');
}

// --- 3. SHOOTING AT A REAL FIGHT -----------------------------------------------------------------
{
  initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6);
  clearGunfire();
  const agents = getAgents();
  const from = new THREE.Vector3();
  const aim = new THREE.Vector3();

  // Fire two hundred rounds at a Kaiju from 400 m away, the way the crowd does.
  const target = agents[1];
  let hits = 0;
  for (let i = 0; i < 200; i++) {
    from.copy(target.body.dir).multiplyScalar(target.body.radius)
      .addScaledVector(target.body.forward, -(400 / METRES_PER_UNIT));
    fireBullet(from, aimPoint(target, aim));
    // Read it back off the pool the renderer uses, not off a return value the renderer never sees.
    const shots = getShots().filter((s) => s.live);
    if (shots[shots.length - 1]?.part) hits++;
    stepGunfire(SPARK_LIFE + 0.01);
  }
  // With scatter at 0.38 of a body height most rounds should connect, but plenty must miss or it
  // reads as a laser show rather than as gunfire.
  ok(hits > 40 && hits < 190, 'most rounds connect, and a good number miss', `${hits}/200 hit`);

  // Every recorded impact must be ON the creature — within the collider, not floating beside it.
  clearGunfire();
  const cap = torsoCapsule(target.body.dir, target.body.radius, ARENA_HEIGHT);
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    from.copy(target.body.dir).multiplyScalar(target.body.radius)
      .addScaledVector(target.body.forward, -(400 / METRES_PER_UNIT));
    fireBullet(from, aimPoint(target, aim));
  }
  for (const s of getShots()) {
    if (!s.live || !s.part) continue;
    const centre = target.body.dir.clone().multiplyScalar(target.body.radius + ARENA_HEIGHT * 0.5);
    worst = Math.max(worst, s.hit.distanceTo(centre));
  }
  ok(worst < cap.radius + ARENA_HEIGHT, 'every spark lands on the creature, not beside it',
     `furthest ${(worst * METRES_PER_UNIT).toFixed(0)} m from centre`);

  // The pool must never grow. A leak here is a leak that runs for the whole session.
  clearGunfire();
  for (let i = 0; i < 5000; i++) fireBullet(from, aimPoint(target, aim));
  ok(getShots().length === 256, 'the shot pool is fixed size however many rounds are fired',
     `${getShots().length}`);
  stepGunfire(SPARK_LIFE + 0.01);
  ok(getShots().every((s) => !s.live), 'and everything retires once it has burnt out');
  ok(TRACER_LIFE < SPARK_LIFE, 'the tracer fades before the spark it caused does');
}

// --- 4. TARGET CHOICE ----------------------------------------------------------------------------
{
  initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6);
  const agents = getAgents();
  const counts = new Map<string, number>();
  for (let i = 0; i < 400; i++) {
    // Everyone standing in the same place, so any spread comes from the CHOICE and not from where
    // they happen to be.
    const id = chooseTarget(agents[0].body.dir, null);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  ok(counts.size >= 3, 'the crowd splits across several Kaiju rather than all picking one',
     [...counts.entries()].map(([k, v]) => `${k}:${v}`).join(' '));

  // A dead Kaiju must stop being shot at, or the army spends the fight firing into a corpse.
  agents[1].alive = false;
  const after = new Set<string>();
  for (let i = 0; i < 300; i++) { const id = chooseTarget(agents[0].body.dir, agents[1].id); if (id) after.add(id); }
  ok(!after.has(agents[1].id), 'nobody keeps shooting at a Kaiju that has fallen');

  for (let i = 0; i < 200; i++) {
    const d = nextShotDelay();
    if (d < 1 || d > 10) { ok(false, 'shot delays stay inside the 1-10 second window', `${d}`); break; }
  }
  ok(true, 'shot delays stay inside the 1-10 second window');
}

// --- 5. THEY DO NO DAMAGE ------------------------------------------------------------------------
// The requirement, asserted rather than assumed.
{
  const runFight = (shoot: boolean): string => {
    initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6);
    clearGunfire();
    const agents = getAgents();
    const aim = new THREE.Vector3();
    const from = new THREE.Vector3();
    for (let step = 0; step < 3600; step++) {
      if (shoot) {
        // Ten shots a frame, far more than two hundred people could manage, at whoever is alive.
        for (let k = 0; k < 10; k++) {
          const alive = agents.filter((a) => a.alive);
          if (!alive.length) break;
          const t = alive[k % alive.length];
          from.copy(t.body.dir).multiplyScalar(t.body.radius)
            .addScaledVector(t.body.forward, -(400 / METRES_PER_UNIT));
          fireBullet(from, aimPoint(t, aim));
        }
        stepGunfire(DT);
      }
      stepArena(DT, false);
    }
    return agents.map((a) =>
      `${a.id}:${a.health.toFixed(6)}:${a.alive ? 1 : 0}:${a.damageTaken.toFixed(6)}:`
      + `${a.body.dir.x.toFixed(9)},${a.body.dir.y.toFixed(9)},${a.body.dir.z.toFixed(9)}`).join('|');
  };

  // THE CONTROL, and it is not a formality. The first version of this compared a quiet fight with a
  // loud one and reported a divergence that had nothing to do with gunfire: the arena was not
  // reproducible AT ALL, because the player's body is a module-level singleton and placeBodyOnSurface
  // reset its position but not its speed, so battle two started with battle one's momentum still in
  // it. Every A/B comparison this project makes — every balance number — was running on that.
  // Without this line the fix would have looked like a gunfire bug and been "fixed" in the wrong file.
  const quiet = runFight(false);
  const quietAgain = runFight(false);
  ok(quiet === quietAgain, 'the same battle run twice gives the same result at all',
     quiet === quietAgain ? 'reproducible' : 'THE SIMULATION ITSELF IS NOT DETERMINISTIC');

  const loud = runFight(true);
  ok(quiet === loud, 'a minute of sustained gunfire changes NOTHING about the fight',
     quiet === loud ? 'identical health, positions and outcome' : 'the fight diverged');
  ok(gunfireDiag.fired > 30000, 'and the test really did fire that whole time',
     `${gunfireDiag.fired} rounds`);
}

console.log(`\n${failures === 0 ? 'GUNFIRE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
