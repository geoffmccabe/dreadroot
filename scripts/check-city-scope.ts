/**
 * check-city-scope — the city colliders must only ever answer for the LOCAL city.
 *
 * Geoff: "look heavily at the colliders for the kaiju and the city buildings, and make sure that
 * it's only considering the local buildings and not accidentally considering other cities on the
 * same earth map."
 *
 * There is one city loaded at a time, so there is no second city to confuse it with today. But that
 * was an accident of how the loader happens to work, not a property of the collider — worldToCity
 * would happily return a coordinate for a point twelve thousand kilometres away and hand it to the
 * grid. And the grid's key was only a unique encoding INSIDE its span: outside it, pairs alias onto
 * real cells, so a distant query could come back holding buildings that are not there.
 *
 * Run: npm run check:city-scope
 */

import * as THREE from 'three';
import {
  ensureCityColliders, clearCityColliders, worldToCity, raycastCity, isInsideBuilding,
  cityColliderDiag,
} from '../src/components/siege/globe/cityColliders';
import { setCityForTest } from '../src/components/siege/globe/cityData';
import { PLANET_RADIUS, METRES_PER_UNIT, latLonToDirection } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== The city colliders answer only for the local city ==\n');

// A small synthetic city at Dubai: a few towers within a kilometre of its origin.
const d = new Float64Array(3);
latLonToDirection(25.0805, 55.1403, d);
const dir = new THREE.Vector3(d[0], d[1], d[2]).normalize();
const position = dir.clone().multiplyScalar(PLANET_RADIUS);
const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
const buildings = [];
for (let i = 0; i < 200; i++) {
  buildings.push({ x: (i % 20) * 60 - 600, z: Math.floor(i / 20) * 60 - 300, w: 30, d: 30, rot: 0, h: 120 });
}
setCityForTest({ lat: 25.0805, lon: 55.1403, buildings, dir, quaternion, position });
ok(ensureCityColliders(), 'the test city indexes');
ok(cityColliderDiag.boxes === 200, 'with all its buildings', `${cityColliderDiag.boxes}`);
console.log(`  reach: ${cityColliderDiag.reachKm.toFixed(2)} km`);

const local = new THREE.Vector3();

// INSIDE the city: it answers.
{
  const p = dir.clone().multiplyScalar(PLANET_RADIUS + 0.5);
  ok(worldToCity(p, local) != null, 'a point over the city converts into city space');
}

// FAR AWAY: it must refuse, not compute.
const FAR: [string, number, number][] = [
  ['Grand Canyon', 36.0616, -112.1076],
  ['Mount Everest', 27.9881, 86.9250],
  ['mid-Pacific', 0, -160],
  ['just outside town', 25.0805, 55.4],       // ~25 km east: still the same face, still not the city
];
for (const [name, lat, lon] of FAR) {
  latLonToDirection(lat, lon, d);
  const p = new THREE.Vector3(d[0], d[1], d[2]).normalize().multiplyScalar(PLANET_RADIUS + 0.5);
  ok(worldToCity(p, local) == null, `${name} is NOT in this city`);
  // ...and nothing that reads the grid may claim a hit out there either.
  const hit = new THREE.Vector3(); const nrm = new THREE.Vector3();
  const to = p.clone().addScaledVector(p.clone().normalize(), -1);
  ok(raycastCity(p, to, hit, nrm) == null, `  ...and a shot fired at ${name} hits no building`);
  const cm = p.clone().multiplyScalar(METRES_PER_UNIT);
  ok(!isInsideBuilding(cm.x, cm.y, cm.z), `  ...and nothing is "inside a building" at ${name}`);
}

clearCityColliders();
console.log(`\n${failures === 0 ? 'CITY SCOPE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
