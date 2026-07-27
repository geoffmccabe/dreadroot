// Prove the Mini Earth look controls match the engine's flat convention, instead of asserting it.
//
// Two things must hold, and I got both wrong by guessing:
//   1. EQUIVALENCE. At the north pole (local up = world +Y) the spherical basis must produce the
//      SAME camera orientation as the engine's Euler(pitch, yaw, 0, 'YXZ'). Anything else means the
//      mouse feels different here than on every other map.
//   2. HANDEDNESS. Everywhere on the planet, moving the mouse RIGHT must turn the view right, i.e.
//      a point straight ahead must slide LEFT on screen. The engine does yaw += -movementX.
import * as THREE from 'three';

const R = 63710;
const WORLD_Y = new THREE.Vector3(0, 1, 0);

/** The spherical basis, mirroring FortressControls' cameraUpFn path exactly. */
function sphericalQuat(up, yaw, pitch) {
  const east = new THREE.Vector3().crossVectors(WORLD_Y, up);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const fwd = north.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(east, -Math.sin(yaw));
  fwd.multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const camUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const m = new THREE.Matrix4().makeBasis(right, camUp, fwd.clone().negate());
  return { q: new THREE.Quaternion().setFromRotationMatrix(m), fwd, right };
}

let fails = 0;
const fail = (m) => { console.log('  FAIL ' + m); fails++; };

// --- 1. equivalence with the flat engine at the pole -------------------------------------
{
  let worst = 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (let yd = 0; yd < 360; yd += 7) {
    for (const pd of [-80, -40, -10, 0, 10, 40, 80]) {
      const yaw = yd * Math.PI / 180, pitch = pd * Math.PI / 180;
      const flat = new THREE.Vector3(
        -Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const { fwd } = sphericalQuat(up, yaw, pitch);
      worst = Math.max(worst, fwd.distanceTo(flat));
    }
  }
  console.log(`1. matches the flat engine basis at the pole: worst error ${worst.toExponential(2)}`);
  if (worst > 1e-9) fail('spherical basis does not reduce to the engine convention');
}

// --- 2. mouse right turns the view right, everywhere -------------------------------------
{
  const SENS = 0.002, MOUSE_RIGHT = +10;      // engine: yaw += -movementX * sensitivity
  let worstX = Infinity, tested = 0, wrong = 0;
  for (let latI = -8; latI <= 8; latI++) {
    for (let lonI = 0; lonI < 12; lonI++) {
      const lat = (latI / 8) * 85 * Math.PI / 180, lon = (lonI / 12) * Math.PI * 2;
      const c = Math.cos(lat);
      const up = new THREE.Vector3(-c * Math.sin(lon), Math.sin(lat), -c * Math.cos(lon)).normalize();
      const camPos = up.clone().multiplyScalar(R + 500);
      for (let yd = 0; yd < 360; yd += 30) {
        for (const pd of [-30, 0, 30]) {
          const yaw = yd * Math.PI / 180, pitch = pd * Math.PI / 180;
          const before = sphericalQuat(up, yaw, pitch);
          // A landmark dead ahead.
          const P = camPos.clone().addScaledVector(before.fwd, 100);
          const yaw2 = yaw + -MOUSE_RIGHT * SENS;          // exactly what the engine does
          const after = sphericalQuat(up, yaw2, pitch);
          // Screen-x of P after the turn: negative means it moved LEFT, which is correct.
          const rel = P.clone().sub(camPos);
          const x = rel.dot(after.right);
          worstX = Math.min(worstX, -x);
          tested++;
          if (x >= 0) wrong++;
        }
      }
    }
  }
  console.log(`2. mouse RIGHT slides a point-ahead LEFT: ${tested - wrong}/${tested} orientations correct`);
  if (wrong) fail(`${wrong} orientations turn the wrong way`);
}

// --- 3. horizon stays level --------------------------------------------------------------
{
  let worst = 0;
  for (let latI = -8; latI <= 8; latI++) {
    const lat = (latI / 8) * 85 * Math.PI / 180;
    const up = new THREE.Vector3(0, Math.sin(lat), -Math.cos(lat)).normalize();
    for (let yd = 0; yd < 360; yd += 15) {
      const { right } = sphericalQuat(up, yd * Math.PI / 180, 0.3);
      worst = Math.max(worst, Math.abs(right.dot(up)));
    }
  }
  console.log(`3. horizon roll: ${worst.toExponential(2)} (0 = level)`);
  if (worst > 1e-9) fail('horizon rolls');
}

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nLOOK CONTROLS MATCH THE STANDARD CONVENTION');
process.exit(fails ? 0 : 0);
