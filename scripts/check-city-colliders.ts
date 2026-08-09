/**
 * check-city-colliders — the buildings are solid, and the colliders are the buildings.
 *
 * Geoff: "The colliders on the buildings need to match perfectly to their shapes."
 *
 * Run against the REAL Dubai bake, not a synthetic city, because the thing most likely to be wrong
 * is a sign or a frame convention and a made-up building would agree with whatever this file
 * believes. The renderer's own placement maths is reproduced here from KaijuCity and the collider is
 * required to land on the same six planes.
 *
 * Run: npm run check:city-colliders
 */

import fs from 'node:fs';
import * as THREE from 'three';
import { parseCity, adoptCity, cityFrame, type City } from '../src/components/siege/globe/cityData';
import { cityGroundMetres } from '../src/components/siege/globe/cityGround';
import {
  ensureCityColliders, cityColliderDiag, worldToCity, cityToWorld,
  pushOutOfBuildings, resolveBuildings, steerAroundBuildings, raycastCity,
  isInsideBuilding, findFreeSpot, buildingAt, clampToRoof,
} from '../src/components/siege/globe/cityColliders';
import { METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== The city is solid ==\n');

const buf = fs.readFileSync('public/siege/city/dubai.bin');
const { lat, lon, buildings } = parseCity(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
);
const frame = cityFrame(lat, lon, cityGroundMetres('Dubai'));
const city: City = { lat, lon, buildings, ...frame };
adoptCity(city);

ok(buildings.length > 1000, 'the real city loads', `${buildings.length.toLocaleString()} buildings`);
ok(ensureCityColliders(), 'colliders build from it');
ok(cityColliderDiag.boxes === buildings.length, 'one collider per building',
   `${cityColliderDiag.boxes} vs ${buildings.length}`);

// --- 1. THE FRAME ROUND-TRIPS -------------------------------------------------------------------
// Everything else is meaningless if city-local and world disagree.
{
  const local = new THREE.Vector3(1234.5, 87.25, -908.75);
  const world = new THREE.Vector3();
  const back = new THREE.Vector3();
  cityToWorld(local, world);
  worldToCity(world, back);
  const err = back.distanceTo(local);
  ok(err < 0.01, 'city-local to world and back is exact', `${(err * 1000).toFixed(3)} mm`);
}

// --- 2. THE COLLIDER IS THE RENDERED BOX --------------------------------------------------------
// The renderer's own placement maths, reproduced from KaijuCity, and the collider asked about the
// eight corners it draws. Containment rather than a ray: fired across a city where towers stand
// metres apart, even a six-metre ray hits a neighbour, which is correct behaviour and a useless
// test. This compares the two shapes directly, which is the actual claim being made.
{
  const U = 1 / METRES_PER_UNIT;
  const dummy = new THREE.Object3D();
  const corner = new THREE.Vector3();
  let tested = 0, cornersOutside = 0, outsideMissed = 0;

  // A spread across the file rather than the first few: the bake is ordered, and the first hundred
  // buildings are all in one district.
  for (let i = 0; i < buildings.length; i += Math.max(1, Math.floor(buildings.length / 400))) {
    const b = buildings[i];
    if (b.w < 4 || b.d < 4 || b.h < 4) continue;
    // EXACTLY what the renderer does — including the negative rotation and the base-origin cube.
    dummy.position.set(b.x * U, 0, b.z * U);
    dummy.rotation.set(0, -b.rot, 0);
    dummy.scale.set(b.w * U, b.h * U, b.d * U);
    dummy.updateMatrix();
    tested++;

    // The eight corners of the unit cube the renderer draws, brought into city metres. Pulled a
    // hair inward so a corner exactly on a face is not a coin flip.
    for (let c = 0; c < 8; c++) {
      corner.set(
        (c & 1 ? 0.49 : -0.49),
        (c & 2 ? 0.98 : 0.02),
        (c & 4 ? 0.49 : -0.49),
      ).applyMatrix4(dummy.matrix).multiplyScalar(METRES_PER_UNIT);
      if (!isInsideBuilding(corner.x, corner.y, corner.z)) cornersOutside++;
    }
    // ...and a point clearly beyond one face must NOT be inside this building. It may be inside a
    // NEIGHBOUR, so the test is only meaningful where there is open ground, which is why it allows
    // failures and only asserts they are rare.
    corner.set(0.5, 0.5, 0.5).applyMatrix4(dummy.matrix).multiplyScalar(METRES_PER_UNIT);
    const outward = corner.clone().sub(new THREE.Vector3(b.x, b.h * 0.5, b.z)).normalize();
    corner.addScaledVector(outward, 25);
    if (isInsideBuilding(corner.x, corner.y, corner.z)) outsideMissed++;
  }
  ok(tested > 100, 'a spread of real buildings was tested', `${tested}`);
  ok(cornersOutside === 0, 'every corner the renderer draws is inside the collider',
     `${cornersOutside} of ${tested * 8} corners outside`);
  // 25 m beyond a corner lands in a neighbouring tower often enough in Dubai that a handful is
  // expected; a large number would mean the colliders are far too big.
  ok(outsideMissed < tested * 0.25, 'and points well outside are mostly outside',
     `${outsideMissed} of ${tested} landed in something`);
}

// --- 3. NOBODY SPAWNS INSIDE A BUILDING ----------------------------------------------------------
{
  const big = buildings.filter((b) => b.w > 30 && b.d > 30 && b.h > 60);
  ok(big.length > 0, 'the city has towers to test against', `${big.length}`);

  // Dropped at the dead centre of a tower, a soldier must END UP somewhere open. Pushing alone
  // cannot do it — the way out of a 300 m tower is 90 m of wall and then the next tower — so
  // spawning searches instead. This is the assertion that findFreeSpot exists for.
  const out = { x: 0, z: 0 };
  let homeless = 0, stillIn = 0;
  for (const b of big.slice(0, 300)) {
    if (!findFreeSpot(b.x, b.z, 0.5, out)) { homeless++; continue; }
    if (isInsideBuilding(out.x, 1, out.z, 0.5)) stillIn++;
  }
  ok(homeless === 0, 'every spawn finds open ground within a couple of blocks', `${homeless} failed`);
  ok(stillIn === 0, 'and none of them is left standing in a wall', `${stillIn} inside`);

  // Push-out still has to work for the ordinary case: a walker who has drifted a metre into a wall.
  let stuck = 0, tried = 0, rescued = 0;
  for (const b of big.slice(0, 200)) {
    // Just inside the width-facing wall, which is where a walker actually ends up.
    //
    // The width axis is (cos rot, sin rot) in city metres — the FORWARD rotation, matching toBox.
    // Written with -rot first (copying the renderer's instance rotation, which is a different
    // thing) this put the probe somewhere off the building entirely and the check failed on 55 of
    // 200 for a reason that had nothing to do with the push.
    const px = b.x + Math.cos(b.rot) * (b.w * 0.5 - 1);
    const pz = b.z + Math.sin(b.rot) * (b.w * 0.5 - 1);
    if (!isInsideBuilding(px, 1, pz, 0.5)) continue;   // a neighbour already owns this spot
    tried++;
    // THE TWO-STAGE POLICY, which is what the crowd actually runs.
    //
    // Push first: cheap, per frame, and enough for a walker who has drifted into a wall in open
    // ground. In Dubai roughly half of these cannot be solved that way at all, because the
    // footprints ABUT — pushed out of one face you are immediately inside the terrace next door,
    // and no amount of pushing finds daylight. Those get the spiral search instead, which is the
    // whole reason it exists.
    resolveBuildings(px, pz, 0.5, out);
    if (isInsideBuilding(out.x, 1, out.z, 0.5)) {
      rescued++;
      if (!findFreeSpot(out.x, out.z, 0.5, out)) { stuck++; continue; }
    }
    if (isInsideBuilding(out.x, 1, out.z, 0.5)) stuck++;
  }
  // A handful can still fail honestly: pushed out of one face and straight into the tower next
  // door, which in Dubai is often two metres away. The spawn search above is the answer to those.
  ok(stuck === 0, 'a walker inside a wall always ends up out of it',
     `${stuck} of ${tried} still inside; ${rescued} needed the spiral search`);
}

// --- 4. THEY WALK AROUND, NOT THROUGH ------------------------------------------------------------
// The real test of the steering: march a walker straight at a tower and see whether he ends up
// inside it. Greedy avoidance may take him the long way; it must never take him through.
{
  const tower = buildings.filter((b) => b.w > 40 && b.d > 40 && b.h > 80)[0];
  ok(tower != null, 'found a tower to walk into');
  if (tower) {
    const R = 0.5;
    const STEP = 1.4;                      // metres per tick, about a person walking
    const dir = { x: 0, z: 0, side: 0 };
    const push = { x: 0, z: 0 };
    // Start clear of everything, not at a fixed distance: this tower is 300 m across and its
    // neighbours are 20 m away, so a hard-coded start put the walker inside a different building
    // before the first tick.
    const away = Math.hypot(tower.w, tower.d) * 0.5 + 120;
    let x = tower.x - away, z = tower.z;
    resolveBuildings(x, z, R, push); x = push.x; z = push.z;

    let insideEver = 0;
    let closest = Infinity;
    let travelled = 0;
    for (let step = 0; step < 900; step++) {
      const tx = tower.x - x, tz = tower.z - z;
      const len = Math.hypot(tx, tz) || 1;
      const deflected = steerAroundBuildings(x, z, tx / len, tz / len, R, 14, dir);
      // The soldier owns the side he chose; it is cleared the moment he is in open ground again.
      if (!deflected) dir.side = 0;
      const nx = x + dir.x * STEP, nz = z + dir.z * STEP;
      travelled += Math.hypot(nx - x, nz - z);
      x = nx; z = nz;
      closest = Math.min(closest, Math.hypot(tower.x - x, tower.z - z));
      // Did he end a tick inside anything?
      if (resolveBuildings(x, z, R, push)) insideEver++;
      x = push.x; z = push.z;
    }
    ok(insideEver === 0, 'walking straight at a tower never puts him inside one',
       `${insideEver} ticks inside`);
    // AND HE MUST KEEP MOVING. The failure this replaced was not tunnelling but pinning: pressed
    // against the wall, flipping which way round to go every tick, travelling 0.7 m in 814 ticks.
    ok(travelled > 900 * STEP * 0.8, 'and he flows along it rather than pinning against it',
       `travelled ${travelled.toFixed(0)} m of a possible ${(900 * STEP).toFixed(0)}`);
    ok(closest < away, 'and he really did close on it', `closest ${closest.toFixed(0)} m`);
  }
}

// --- 5. BULLETS STOP AT WALLS --------------------------------------------------------------------
{
  const tower = buildings.filter((b) => b.w > 40 && b.d > 40 && b.h > 80)[0];
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  cityToWorld(new THREE.Vector3(tower.x - 400, tower.h * 0.4, tower.z), from);
  cityToWorld(new THREE.Vector3(tower.x + 400, tower.h * 0.4, tower.z), to);
  const t = raycastCity(from, to, p, n);
  ok(t != null && t > 0 && t < 1, 'a shot across a tower is stopped by it', `t = ${t?.toFixed(3)}`);
  // The normal must face back toward the shooter, or a spark would be drawn inside the wall.
  const toward = from.clone().sub(p).normalize();
  ok(n.dot(toward) > 0.5, 'the wall normal faces the shooter', `dot ${n.dot(toward).toFixed(2)}`);

  // ...and a shot passing OVER the city hits nothing. Same ray, above every roof.
  const tallest = buildings.reduce((m, b) => Math.max(m, b.h), 0);
  cityToWorld(new THREE.Vector3(tower.x - 400, tallest + 200, tower.z), from);
  cityToWorld(new THREE.Vector3(tower.x + 400, tallest + 200, tower.z), to);
  ok(raycastCity(from, to, p, n) == null, 'a shot over the rooftops hits nothing',
     `above ${tallest.toFixed(0)} m`);
}

// --- 6. IT IS FAST ENOUGH TO RUN EVERY FRAME ------------------------------------------------------
{
  const dir = { x: 0, z: 0 };
  const b0 = buildings[Math.floor(buildings.length / 2)];
  const t0 = process.hrtime.bigint();
  const N = 200 * 60;                       // 200 soldiers, one second
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    steerAroundBuildings(b0.x + Math.cos(a) * 300, b0.z + Math.sin(a) * 300,
                         -Math.cos(a), -Math.sin(a), 0.5, 14, dir);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms < 400, '200 soldiers steering for a second costs under 400 ms of CPU',
     `${ms.toFixed(0)} ms for ${N} queries = ${(ms / 60).toFixed(2)} ms per frame`);
}

// --- 7. ROOFTOPS ----------------------------------------------------------------------------------
// Geoff: "if they are inside a building then instead put them on top of the building. If they are on
// a building they stay there and don't fall off the edge."
{
  const big = buildings.filter((b) => b.w > 20 && b.d > 20 && b.h > 30).slice(0, 300);
  let found = 0, wrongRoof = 0;
  for (const b of big) {
    const box = buildingAt(b.x, b.z);
    if (!box) continue;
    found++;
    // Where footprints overlap the taller roof must win: that is the one a man dropped there would
    // actually land on, and the only answer that cannot put him inside something.
    if (box.h < b.h - 0.01) wrongRoof++;
  }
  ok(found > 200, 'a spawn inside a building finds the building', `${found} of ${big.length}`);
  ok(wrongRoof === 0, 'and where they overlap it picks the taller roof', `${wrongRoof} wrong`);

  // WALK OFF THE EDGE, repeatedly, from the centre outward in every direction. He must never end up
  // beyond the footprint, and must never be pinned to the middle of it either.
  const out = { x: 0, z: 0 };
  let escaped = 0, reachedEdge = 0;
  for (const b of big.slice(0, 120)) {
    const box = buildingAt(b.x, b.z);
    if (!box) continue;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      let x = box.x, z = box.z;
      for (let step = 0; step < 400; step++) {
        x += Math.cos(a) * 1.4;
        z += Math.sin(a) * 1.4;
        clampToRoof(box, x, z, 1.5, out);
        x = out.x; z = out.z;
      }
      // ON the roof means inside the FOOTPRINT, not within some radius of its centre: a rectangle's
      // corner is further from the middle than its widest half-extent, so a distance test calls a
      // man standing legitimately at the corner a man who has fallen off. Ask the city instead.
      const still = buildingAt(x, z);
      if (!still || still.h < box.h - 0.01) escaped++;
      if (Math.hypot(x - box.x, z - box.z) > Math.min(box.hw, box.hd) * 0.5) reachedEdge++;
    }
  }
  ok(escaped === 0, 'a soldier walking outward never leaves his roof', `${escaped} fell off`);
  ok(reachedEdge > 0, 'and is not pinned to the middle of it either', `${reachedEdge} reached the parapet`);
}

console.log(`\n${failures === 0 ? 'CITY COLLIDER CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
