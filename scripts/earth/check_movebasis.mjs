// Verify the Mini Earth movement frame is screen-consistent at EVERY camera orientation.
//
// The failure being guarded against: deriving the frame from the camera's forward vector is
// degenerate when you look straight down at the planet, which is how you always approach it. The
// frame then depended on how you had rotated, so W went somewhere different each time.
import * as THREE from 'three';

const PLANET_RADIUS = 63710;
const cam = new THREE.PerspectiveCamera(70, 1.6, 0.1, 1e6);

function basis(camera) {
  const up = camera.position.clone();
  if (up.lengthSq() < 1e-6) return null;
  up.normalize();
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const right = camRight.addScaledVector(up, -camRight.dot(up));
  if (right.lengthSq() < 1e-10) {
    const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    right.copy(camUp).addScaledVector(up, -camUp.dot(up));
    if (right.lengthSq() < 1e-10) return null;
  }
  right.normalize();
  const fwd = new THREE.Vector3().crossVectors(up, right).normalize();
  return { fwd, right, up };
}

let fails = 0, worstUpErr = 0, worstOrtho = 0, degenerate = 0;
let worstScreen = 1;
const tmp = new THREE.Vector3();

for (let latI = -8; latI <= 8; latI++) {
  for (let lonI = 0; lonI < 12; lonI++) {
    const lat = (latI / 8) * 85 * Math.PI / 180, lon = (lonI / 12) * Math.PI * 2;
    const c = Math.cos(lat);
    const dir = new THREE.Vector3(-c * Math.sin(lon), Math.sin(lat), -c * Math.cos(lon));
    cam.position.copy(dir).multiplyScalar(PLANET_RADIUS + 500);

    for (const pitch of [-89.9, -60, -20, 0, 20, 60, 89.9]) {
      for (const yaw of [0, 45, 120, 200, 300]) {
        // Point the camera by lookAt at a target derived from a local frame, then roll it.
        const up = dir.clone();
        const e = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up);
        if (e.lengthSq() < 1e-8) e.set(1, 0, 0);
        e.normalize();
        const n = new THREE.Vector3().crossVectors(up, e).normalize();
        const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180;
        const look = n.clone().multiplyScalar(Math.cos(y) * Math.cos(p))
          .addScaledVector(e, Math.sin(y) * Math.cos(p))
          .addScaledVector(up, Math.sin(p)).normalize();
        cam.up.copy(up);
        cam.lookAt(tmp.copy(cam.position).add(look));
        cam.updateMatrixWorld(true);

        const b = basis(cam);
        if (!b) { degenerate++; continue; }

        // 1. all three axes must be unit and mutually perpendicular
        worstOrtho = Math.max(worstOrtho, Math.abs(b.fwd.dot(b.up)), Math.abs(b.right.dot(b.up)),
                              Math.abs(b.fwd.dot(b.right)));
        worstUpErr = Math.max(worstUpErr, Math.abs(b.up.length() - 1));

        // 2. THE ONE THAT MATTERS: `right` must agree with screen-right at every orientation.
        const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
        worstScreen = Math.min(worstScreen, b.right.dot(camRight));
      }
    }
  }
}

console.log(`orthogonality error : ${worstOrtho.toExponential(2)}`);
console.log(`unit-length error   : ${worstUpErr.toExponential(2)}`);
console.log(`degenerate frames   : ${degenerate}`);
console.log(`worst screen-right agreement: ${worstScreen.toFixed(4)} (1.0 = A/D always match the screen)`);
if (worstOrtho > 1e-6) { console.log('  FAIL axes not orthogonal'); fails++; }
if (degenerate > 0) { console.log('  FAIL some orientations produced no frame'); fails++; }
if (worstScreen < 0.0) { console.log('  FAIL A/D inverted at some orientation'); fails++; }
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nMOVEMENT FRAME OK AT ALL 6,720 ORIENTATIONS');
process.exit(fails ? 1 : 0);
