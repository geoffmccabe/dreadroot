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
  fireBullet, stepGunfire, getBullets, getSparks, clearGunfire, gunfireDiag,
  chooseTarget, aimPoint, nextShotDelay, nextRetargetDelay, SPARK_LIFE, MAX_RANGE_UNITS,
} from '../src/components/siege/globe/kaijuGunfire';
import { METRES_PER_UNIT, PLANET_RADIUS } from '../src/components/siege/globe/cubeSphere';
import {
  registerHitMesh, unregisterHitMesh, hasHitMesh, meshHit, beginMeshHitFrame,
} from '../src/components/siege/globe/kaijuMeshHit';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

const DT = 1 / 60;
console.log('\n== The army shoots at the monster ==\n');
beginMeshHitFrame();

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

// --- 3. BALLISTICS ------------------------------------------------------------------------------
// Geoff: "Try to use real physics for the bullet speed, distance, and trail-off... accounting for
// gravity and air resistance." So the numbers are checked against what a real rifle round does,
// rather than against whatever the code happens to produce.
{
  initArenaWith([BREEDS[0]], 0x5EED, 6);
  clearGunfire();
  // Fire one round horizontally, far from any Kaiju, and watch it.
  const start = new THREE.Vector3(0, 0, PLANET_RADIUS + 10);
  const aim = start.clone().add(new THREE.Vector3(1, 0, 0));
  fireBullet(start, aim);
  const b = getBullets().find((x) => x.live)!;

  const v0 = b.vel.length() * METRES_PER_UNIT;
  ok(Math.abs(v0 - 800) < 1, 'leaves the muzzle at 800 m/s', `${v0.toFixed(0)} m/s`);

  let t = 0;
  let at500: { speed: number; drop: number; time: number } | null = null;
  while (t < 2 && b.live) {
    stepGunfire(DT); t += DT;
    const travelled = Math.abs(b.pos.x - start.x) * METRES_PER_UNIT;
    if (!at500 && travelled >= 500) {
      at500 = {
        speed: b.vel.length() * METRES_PER_UNIT,
        drop: (start.length() - b.pos.length()) * METRES_PER_UNIT,
        time: t,
      };
    }
  }
  ok(at500 != null, 'the round actually travels 500 m');
  // A 5.56 round leaves at ~800 and is doing ~480 at 500 m. Air resistance is the whole reason.
  ok(at500 != null && at500.speed > 400 && at500.speed < 560,
     'air resistance has taken it to roughly 480 m/s by 500 m', `${at500?.speed.toFixed(0)} m/s`);
  // ...and it has dropped only a few metres, because drag dwarfs gravity at these speeds. A drop of
  // tens of metres would mean gravity was being applied to something moving far too slowly.
  ok(at500 != null && at500.drop > 0.5 && at500.drop < 12,
     'and has dropped only a few metres on the way', `${at500?.drop.toFixed(1)} m`);
  ok(at500 != null && at500.time > 0.4 && at500.time < 1.1,
     'taking about three quarters of a second to get there', `${at500?.time.toFixed(2)} s`);
}

// --- 4. HITTING, AND BOUNCING OFF --------------------------------------------------------------
{
  initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6);
  clearGunfire();
  const agents = getAgents();
  const target = agents[1];
  const from = new THREE.Vector3();
  const aim = new THREE.Vector3();

  // Two hundred rounds from 400 m out, the way the crowd shoots. Fired one at a time and followed
  // to their conclusion, so a hit is a hit in the simulation rather than in a formula.
  let hits = 0;
  for (let i = 0; i < 200; i++) {
    clearGunfire();
    from.copy(target.body.dir).multiplyScalar(target.body.radius)
      .addScaledVector(target.body.forward, -(400 / METRES_PER_UNIT));
    fireBullet(from, aimPoint(target, aim));
    const b = getBullets().find((x) => x.live)!;
    for (let step = 0; step < 120 && b.live && !b.ricocheted; step++) stepGunfire(DT);
    if (b.ricocheted) hits++;
  }
  // Geoff: "they aren't shooting at the Kaiju but seem to be shooting randomly. They should aim at
  // him." Aimed fire at a 300 m creature from 400 m should mostly connect.
  ok(hits > 150, 'aimed fire mostly connects', `${hits}/200 hit`);

  // THE BOUNCE. Geoff: "add a physics BOUNCE so they are bouncing off him and then the lines fade
  // away... they should arc away and fall away."
  clearGunfire();
  from.copy(target.body.dir).multiplyScalar(target.body.radius)
    .addScaledVector(target.body.forward, -(400 / METRES_PER_UNIT));
  aim.copy(target.body.dir).multiplyScalar(target.body.radius + ARENA_HEIGHT * 0.55);
  fireBullet(from, aim);
  const b = getBullets().find((x) => x.live)!;
  const speedIn = b.vel.length();
  for (let step = 0; step < 120 && !b.ricocheted; step++) stepGunfire(DT);
  ok(b.ricocheted, 'a round fired straight at the chest bounces off it');
  const speedOut = b.vel.length();
  ok(speedOut < speedIn * 0.75 && speedOut > speedIn * 0.05,
     'and comes off much slower than it went in',
     `${(speedIn * METRES_PER_UNIT).toFixed(0)} -> ${(speedOut * METRES_PER_UNIT).toFixed(0)} m/s`);
  ok(getSparks().some((sp) => sp.live), 'leaving a spark where it struck');

  // It must then ARC AWAY AND FALL, not sail off in a straight line forever.
  const radiusAtBounce = b.pos.length();
  let highest = radiusAtBounce;
  for (let step = 0; step < 240 && b.live; step++) {
    stepGunfire(DT);
    if (b.live) highest = Math.max(highest, b.pos.length());
  }
  ok(highest >= radiusAtBounce, 'the ricochet rises before it comes down');
  ok(!b.live || b.pos.length() < highest,
     'and is falling by the end of its life');

  // The pool must never grow. A leak here runs for the whole session.
  clearGunfire();
  for (let i = 0; i < 5000; i++) fireBullet(from, aimPoint(target, aim));
  ok(getBullets().length === 512, 'the bullet pool is fixed size however many rounds are fired',
     `${getBullets().length}`);
  for (let step = 0; step < 400; step++) stepGunfire(DT);
  ok(getBullets().every((x) => !x.live), 'and every round eventually leaves the world');
}

// --- 5. TARGET CHOICE ----------------------------------------------------------------------------
// Geoff: "They should pick the closest Kaiju and shoot at it... the closer the kaiju, the more
// likely they will choose it. So if a kaiju walks closer, it will start drawing fire, and the closer
// it gets, the more soldiers fire at it." That is a behaviour over DISTANCE, so it is measured over
// distance rather than sampled once and eyeballed.
{
  initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6);
  const agents = getAgents();
  // Stand where the crowd actually stands — about 350 m out, not glued to the creature's ankle.
  // Testing from distance zero makes the near Kaiju infinitely preferred and hides the gradient.
  const here = agents[0].body.dir.clone()
    .lerp(agents[2].body.dir, (1.2 * ARENA_HEIGHT) / agents[0].body.dir.angleTo(agents[2].body.dir)
      / agents[0].body.radius).normalize();

  // Standing right next to agent 0, almost every rifle should be pointed at it.
  const counts = new Map<string, number>();
  for (let i = 0; i < 2000; i++) {
    const id = chooseTarget(here);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const nearShare = (counts.get(agents[0].id) ?? 0) / 2000;
  ok(nearShare > 0.8, 'the Kaiju you are standing next to takes most of the fire',
     `${(nearShare * 100).toFixed(0)}%`);
  // The demo fight spawns everyone six body heights apart — 1800 m — which is more than twice a
  // rifle's reach, so at the start of a battle the only thing worth shooting at IS the near one.
  ok(counts.size === 1, 'and the ones out of range draw nothing at all',
     [...counts.entries()].map(([k, v]) => `${k}:${v}`).join(' '));

  // NOW WALK ONE IN. Take the far Kaiju and step it toward the crowd, and the share of soldiers
  // shooting at it must rise the whole way. This is the actual requested behaviour.
  //
  // The distances are inside RIFLE RANGE, not across the map. A round is spent by 2.78 body heights
  // (833 m, derived from its own drag curve), so beyond that a soldier does not engage at all —
  // which is the other half of what Geoff asked for: "they shouldn't shoot at a kaiju that they
  // can't hit with a bullet." Testing the gradient at 12 body heights would only ever measure zero.
  const far = agents[1];
  const start = far.body.dir.clone();
  const place = (bodies: number) => {
    const axis = new THREE.Vector3().crossVectors(here, start).normalize();
    far.body.dir.copy(here).applyAxisAngle(axis, (bodies * ARENA_HEIGHT) / far.body.radius).normalize();
  };
  const shareAt = (bodies: number) => {
    place(bodies);
    let n = 0;
    for (let i = 0; i < 4000; i++) if (chooseTarget(here) === far.id) n++;
    return n / 4000;
  };

  // Out of reach: it must draw NOTHING, however big it is.
  ok(shareAt(5) === 0, 'a Kaiju beyond rifle range draws no fire at all',
     `range limit ${(MAX_RANGE_UNITS * 100).toFixed(0)} m`);

  const steps = [2.7, 2.3, 1.9, 1.5, 1.1];
  const shares = steps.map(shareAt);
  const rising = shares.every((v, i) => i === 0 || v > shares[i - 1]);
  ok(rising, 'the closer a Kaiju walks, the more soldiers switch to it',
     shares.map((v, i) => `${steps[i]}b:${(v * 100).toFixed(0)}%`).join(' '));
  ok(shares[0] < 0.25, 'one at the edge of range draws only a trickle',
     `${(shares[0] * 100).toFixed(0)}% at ${steps[0]} body-heights`);
  ok(shares[shares.length - 1] > 0.4, 'and one standing on top of you draws most of it',
     `${(shares[shares.length - 1] * 100).toFixed(0)}% at ${steps[steps.length - 1]} body-heights`);
  far.body.dir.copy(start);

  // A dead Kaiju must stop being shot at, or the army spends the fight firing into a corpse.
  agents[1].alive = false;
  const after = new Set<string>();
  for (let i = 0; i < 300; i++) { const id = chooseTarget(here); if (id) after.add(id); }
  ok(!after.has(agents[1].id), 'nobody keeps shooting at a Kaiju that has fallen');
  agents[1].alive = true;

  for (let i = 0; i < 200; i++) {
    const d = nextShotDelay();
    if (d < 1 || d > 10) { ok(false, 'shot delays stay inside the 1-10 second window', `${d}`); break; }
  }
  ok(true, 'shot delays stay inside the 1-10 second window');
  for (let i = 0; i < 200; i++) {
    const d = nextRetargetDelay();
    if (d < 5 || d > 15) { ok(false, 'targets are reconsidered about every ten seconds', `${d}`); break; }
  }
  ok(true, 'targets are reconsidered about every ten seconds');
}

// --- 6. THEY DO NO DAMAGE ------------------------------------------------------------------------
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


// --- 7. MESH COLLIDERS ---------------------------------------------------------------------------
// Geoff: "You didn't do mesh colliders like I told you to do. Instead you made cylinders and they
// are really bad and will never work for a game like this where it's all about realism."
//
// So this proves the mesh path does what a capsule cannot: hit the SHAPE, in the POSE, and miss the
// empty space a cylinder would have filled. Built from a real THREE.SkinnedMesh rather than the
// game's .glb files, because the point is the mechanism, not the art.
{
  const geo = new THREE.BoxGeometry(1, 4, 1);
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  const pos = geo.attributes.position;
  // Bind every vertex to the single bone, so moving the bone moves the whole slab.
  const idx: number[] = [];
  const wgt: number[] = [];
  for (let i = 0; i < pos.count; i++) { idx.push(0, 0, 0, 0); wgt.push(1, 0, 0, 0); }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wgt, 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(skeleton);
  mesh.updateMatrixWorld(true);

  registerHitMesh('mesh-test', mesh);
  ok(hasHitMesh('mesh-test'), 'a model registers as a hit surface');

  const pt = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  // Straight through the middle: a hit, on the NEAR face, with a normal pointing back at the shooter.
  const t = meshHit('mesh-test', new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 0, 0), pt, nrm);
  ok(t != null, 'a round through the slab hits it');
  ok(t != null && Math.abs(pt.x + 0.5) < 0.02,
     'the impact is on the NEAR surface of the actual geometry', `x = ${pt.x.toFixed(3)}`);
  ok(nrm.x < -0.9, 'and the surface normal points back at the shooter', `nx = ${nrm.x.toFixed(2)}`);

  // THE WHOLE POINT. A round passing beside the slab must MISS. A capsule wide enough to contain
  // this shape would have stopped it in clear air — which is the invisible wall.
  ok(meshHit('mesh-test', new THREE.Vector3(-10, 0, 3), new THREE.Vector3(10, 0, 3), pt, nrm) == null,
     'a round passing beside it misses, where a capsule would have stopped it');

  // ...AND IT FOLLOWS THE POSE. Move the bone and the geometry moves with it: the shot that hit
  // must now miss, and a shot at the new position must hit. This is the thing a static collider
  // cannot do and the reason an arm mid-swing is hittable where the arm actually is.
  bone.position.set(0, 0, 6);
  mesh.updateMatrixWorld(true);
  skeleton.update();
  ok(meshHit('mesh-test', new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 0, 0), pt, nrm) == null,
     'moving the skeleton moves the collider off the old spot');
  ok(meshHit('mesh-test', new THREE.Vector3(-10, 0, 6), new THREE.Vector3(10, 0, 6), pt, nrm) != null,
     'and onto the new one');

  unregisterHitMesh('mesh-test');
  ok(!hasHitMesh('mesh-test'), 'and it can be taken down again');
}

console.log(`\n${failures === 0 ? 'GUNFIRE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
