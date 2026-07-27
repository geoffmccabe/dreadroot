// Verify the spherical camera basis keeps the horizon LEVEL at every point on the planet.
//
// The bug being guarded against: the engine composes the camera as Euler(pitch, yaw, 0, 'YXZ'),
// i.e. yaw about WORLD Y. Over Texas that axis is 60 degrees off local up, so sliding the mouse
// rolled the horizon instead of turning the view.
import * as THREE from 'three';
const R = 63710;
const WORLD_Y = new THREE.Vector3(0, 1, 0);

function sphericalBasis(pos, yaw, pitch) {
  const up = pos.clone().normalize();
  const east = new THREE.Vector3().crossVectors(WORLD_Y, up);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const fwd = north.clone().multiplyScalar(-Math.cos(yaw)).addScaledVector(east, -Math.sin(yaw));
  fwd.multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const camUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
  return { fwd, right, camUp, up };
}

function worldYBasis(yaw, pitch) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  return {
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    camUp: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
  };
}

let worstNew = 0, worstOld = 0, n = 0;
for (let latI = -8; latI <= 8; latI++) {
  for (let lonI = 0; lonI < 12; lonI++) {
    const lat = (latI / 8) * 85 * Math.PI / 180, lon = (lonI / 12) * Math.PI * 2;
    const c = Math.cos(lat);
    const pos = new THREE.Vector3(-c * Math.sin(lon), Math.sin(lat), -c * Math.cos(lon))
      .multiplyScalar(R + 500);
    const up = pos.clone().normalize();
    for (const yawDeg of [0, 30, 90, 150, 210, 300]) {
      for (const pitchDeg of [-45, -10, 0, 10, 45]) {
        const yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
        // "Level horizon" means the camera's RIGHT axis is perpendicular to local up: no roll.
        const b = sphericalBasis(pos, yaw, pitch);
        worstNew = Math.max(worstNew, Math.abs(b.right.dot(up)));
        const o = worldYBasis(yaw, pitch);
        worstOld = Math.max(worstOld, Math.abs(o.right.dot(up)));
        n++;
      }
    }
  }
}
const deg = (d) => (Math.asin(Math.min(1, d)) * 180 / Math.PI).toFixed(1);
console.log(`orientations tested: ${n}`);
console.log(`world-Y yaw (old) : worst roll ${deg(worstOld)} deg  <- horizon tilts`);
console.log(`local-up yaw (new): worst roll ${deg(worstNew)} deg  <- horizon level`);
const ok = worstNew < 1e-9;
console.log(ok ? '\nHORIZON STAYS LEVEL EVERYWHERE' : '\nFAIL: still rolling');
process.exit(ok ? 0 : 1);
