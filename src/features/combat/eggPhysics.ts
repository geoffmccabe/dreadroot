// Pure physics step for a shpider egg. Same shape as grenade
// physics — voxel + entity collision, gravity, bounce — but with
// (a) different tuning constants, (b) no roll-threshold gating
// (always apply friction when grounded), and (c) rest-detection
// for the "hatch when stationary" trigger.

import type {
  VoxelCollider,
  EnemyColliderSource,
} from './grenadePhysics';

export interface EggPhysicsState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  /** Accumulated seconds the egg has been below restSpeed while
   *  grounded. The caller's hatch trigger compares it against
   *  restHatchSec. */
  restAccumSec: number;
}

export interface EggPhysicsConstants {
  gravity: number;
  bounceDamp: number;
  rollFrictionPerSec: number;
  visualRadius: number;
  /** Speed below which a grounded egg accumulates rest time. */
  restSpeed: number;
}

export interface EggPhysicsResult {
  /** True if the egg is currently grounded — caller can use this
   *  alongside restAccumSec to decide when to hatch. */
  grounded: boolean;
}

export function stepEggPhysics(
  e: EggPhysicsState,
  dt: number,
  world: VoxelCollider,
  enemies: EnemyColliderSource,
  c: EggPhysicsConstants,
): EggPhysicsResult {
  e.velocity.y -= c.gravity * dt;
  const nextX = e.position.x + e.velocity.x * dt;
  const nextY = e.position.y + e.velocity.y * dt;
  const nextZ = e.position.z + e.velocity.z * dt;

  let px = nextX;
  let py = nextY;
  let pz = nextZ;
  const r = c.visualRadius;

  // Y collision.
  const yCellNext = Math.floor(nextY - r);
  if (e.velocity.y < 0 && world.hasVoxel(Math.floor(e.position.x), yCellNext, Math.floor(e.position.z))) {
    py = yCellNext + 1 + r + 0.001;
    e.velocity.y = -e.velocity.y * c.bounceDamp;
    e.velocity.x *= 0.8;
    e.velocity.z *= 0.8;
  } else if (e.velocity.y > 0 && world.hasVoxel(Math.floor(e.position.x), Math.floor(nextY + r), Math.floor(e.position.z))) {
    py = Math.floor(nextY + r) - r - 0.001;
    e.velocity.y = -e.velocity.y * c.bounceDamp;
  } else if (nextY - r < 0) {
    py = r + 0.001;
    e.velocity.y = -e.velocity.y * c.bounceDamp;
    e.velocity.x *= 0.8;
    e.velocity.z *= 0.8;
  }

  // X / Z walls.
  if (e.velocity.x !== 0) {
    const xCell = Math.floor(e.velocity.x > 0 ? nextX + r : nextX - r);
    if (world.hasVoxel(xCell, Math.floor(py), Math.floor(e.position.z))) {
      px = e.position.x;
      e.velocity.x = -e.velocity.x * c.bounceDamp;
    }
  }
  if (e.velocity.z !== 0) {
    const zCell = Math.floor(e.velocity.z > 0 ? nextZ + r : nextZ - r);
    if (world.hasVoxel(Math.floor(px), Math.floor(py), zCell)) {
      pz = e.position.z;
      e.velocity.z = -e.velocity.z * c.bounceDamp;
    }
  }

  // Entity bounce (identical to grenade — sphere-vs-cylinder).
  enemies.forEachHitbox((hb) => {
    if (py + r < hb.bottomY || py - r > hb.topY) return;
    const dx = px - hb.centerX;
    const dz = pz - hb.centerZ;
    const distSq = dx * dx + dz * dz;
    const reach = hb.radius + r;
    if (distSq > reach * reach) return;
    const dist = Math.sqrt(distSq) || 0.001;
    const nx = dx / dist;
    const nz = dz / dist;
    px = hb.centerX + nx * (reach + 0.001);
    pz = hb.centerZ + nz * (reach + 0.001);
    const vDotN = e.velocity.x * nx + e.velocity.z * nz;
    if (vDotN < 0) {
      e.velocity.x -= 2 * vDotN * nx;
      e.velocity.z -= 2 * vDotN * nz;
      e.velocity.x *= c.bounceDamp;
      e.velocity.z *= c.bounceDamp;
    }
  });

  e.position.x = px;
  e.position.y = py;
  e.position.z = pz;

  // Friction always applies when grounded (unlike grenade's threshold-gated rolling).
  const grounded = Math.abs(e.velocity.y) < 1.5
    && (py - r <= 0.05
        || world.hasVoxel(Math.floor(px), Math.floor(py - r - 0.05), Math.floor(pz)));
  if (grounded) {
    const decay = Math.pow(c.rollFrictionPerSec, dt);
    e.velocity.x *= decay;
    e.velocity.z *= decay;
    if (e.velocity.y < 0) e.velocity.y = 0;
  }

  // Rest accumulation — caller checks against restHatchSec to fire hatch.
  const speed = Math.hypot(e.velocity.x, e.velocity.y, e.velocity.z);
  if (speed < c.restSpeed && grounded) {
    e.restAccumSec += dt;
  } else {
    e.restAccumSec = 0;
  }

  return { grounded };
}
