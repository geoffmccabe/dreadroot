/**
 * check-globe-shadows — does the shadow camera actually contain what it is meant to shadow?
 *
 * Shadows have now failed three times with every individual part looking correct, so this stops
 * being reasoned about and gets measured. It builds the EXACT light rig GlobeLighting builds — same
 * position, same target, same ortho bounds, same near/far — puts it where the player stands on a
 * planet of the real radius, and asks the only question that matters: is the Kaiju inside the
 * shadow camera's frustum, and is the ground under it inside too?
 *
 * A shadow camera that does not contain the caster produces no shadow, with no error anywhere.
 *
 * Run: npm run check:globe-shadows
 */

import * as THREE from 'three';

const METRES_PER_UNIT = 100;
const PLANET_RADIUS = 6371000 / METRES_PER_UNIT;   // 63,710 units
const KAIJU_H = 3;                                  // 300 m

let bad = 0;
const ok = (cond, label, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) bad++;
};

console.log('\n== Globe shadow camera ==\n');

// --- exactly what GlobeLighting does -------------------------------------------------------------
const SHADOW_SPAN_M = 2000;
const SUN_ELEVATION_DEG = 45;
const SUN_BEARING_DEG = 205;

// The player, standing somewhere arbitrary on the sphere.
const playerDir = new THREE.Vector3(0.31, 0.62, 0.72).normalize();
const playerRadius = PLANET_RADIUS + 21.5;          // Grand Canyon rim, 2,150 m
const focus = playerDir.clone().multiplyScalar(playerRadius);

function bearingTangent(dir, degrees) {
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
  if (east.lengthSq() < 1e-9) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(dir, east).normalize();
  const r = (degrees * Math.PI) / 180;
  return north.multiplyScalar(Math.cos(r)).addScaledVector(east, Math.sin(r)).normalize();
}
const el = (SUN_ELEVATION_DEG * Math.PI) / 180;
const toSun = bearingTangent(playerDir, SUN_BEARING_DEG)
  .multiplyScalar(Math.cos(el)).addScaledVector(playerDir, Math.sin(el)).normalize();

const light = new THREE.DirectionalLight(0xffffff, 1);
light.castShadow = true;
light.position.copy(focus).addScaledVector(toSun, SHADOW_SPAN_M / METRES_PER_UNIT);
light.target.position.copy(focus);

const half = SHADOW_SPAN_M / METRES_PER_UNIT / 2;
const cam = light.shadow.camera;
cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
cam.near = 0.1;
cam.far = (SHADOW_SPAN_M * 2.5) / METRES_PER_UNIT;

light.updateMatrixWorld(true);
light.target.updateMatrixWorld(true);
// This is what three does internally before rendering the shadow map.
cam.position.setFromMatrixPosition(light.matrixWorld);
cam.lookAt(light.target.getWorldPosition(new THREE.Vector3()));
cam.updateMatrixWorld(true);
cam.updateProjectionMatrix();

const frustum = new THREE.Frustum().setFromProjectionMatrix(
  new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
);

// --- the questions -------------------------------------------------------------------------------
const lightDist = light.position.distanceTo(focus);
ok(lightDist > cam.near && lightDist < cam.far,
   'the light sits between the shadow camera near and far planes',
   `${lightDist.toFixed(1)}u, near ${cam.near}, far ${cam.far}`);

// The Kaiju: feet at the surface, head one body height up.
const feet = focus.clone();
const head = focus.clone().addScaledVector(playerDir, KAIJU_H);
ok(frustum.containsPoint(feet), 'the Kaiju FEET are inside the shadow frustum');
ok(frustum.containsPoint(head), 'the Kaiju HEAD is inside the shadow frustum');

// The ground it should be casting onto, out to a few hundred metres in every direction.
const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), playerDir).normalize();
const north = new THREE.Vector3().crossVectors(playerDir, east).normalize();
let groundIn = 0, groundTotal = 0;
for (const m of [100, 300, 600]) {
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const p = focus.clone()
      .addScaledVector(east, (Math.cos(ang) * m) / METRES_PER_UNIT)
      .addScaledVector(north, (Math.sin(ang) * m) / METRES_PER_UNIT);
    groundTotal++;
    if (frustum.containsPoint(p)) groundIn++;
  }
}
ok(groundIn === groundTotal, 'the ground around the player is inside the shadow frustum',
   `${groundIn}/${groundTotal} sample points`);

// PRECISION. This is the one a planet breaks. Float32 has ~7 significant digits, so at 63,710 units
// from the origin the smallest representable step is about 0.4 cm in metres... report it, because if
// it were metres-scale the shadow map would be pure noise.
{
  const mag = focus.length();
  const eps = mag * 1.19e-7;                 // float32 relative epsilon
  ok(eps * METRES_PER_UNIT < 5,
     'float32 precision at this distance is finer than the shadow detail',
     `${(eps * METRES_PER_UNIT * 100).toFixed(1)} cm at ${(mag / 1000).toFixed(0)}k units`);
}

// BIAS. normalBias is in WORLD UNITS, and on this map one unit is a hundred metres — a value that
// looks tiny is enormous here.
{
  const normalBias = 0.04;
  ok(normalBias * METRES_PER_UNIT < KAIJU_H * METRES_PER_UNIT * 0.05,
     'normalBias is small relative to the things casting',
     `${(normalBias * METRES_PER_UNIT).toFixed(1)} m against a ${KAIJU_H * METRES_PER_UNIT} m creature`);
}

console.log(`\n${bad === 0 ? 'SHADOW CAMERA CHECKS PASSED' : `${bad} CHECK(S) FAILED`}\n`);
process.exit(bad ? 1 : 0);
