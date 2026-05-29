// Pure physics step for one grenade. Mirrors the body of
// useGrenadeSystem's tick loop but takes the world + entity colliders
// as plain interfaces so the same function can run client-side
// (using worldCollisionGrid + enemyCombatRegistry) or on the L2 DO
// (using server-side mirrors of those).
//
// Mutates the grenade's position + velocity only. The caller decides
// when the fuse expires and triggers the explosion.

export interface GrenadePhysicsState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  /** Set true once the grenade is grounded AND speed drops below
   *  rollThreshold. Friction only applies while rolling — fast
   *  bounces preserve their momentum. */
  isRolling: boolean;
}

export interface GrenadePhysicsConstants {
  gravity: number;
  bounceDamp: number;
  rollFrictionPerSec: number;
  rollThreshold: number;
  visualRadius: number;
}

/** World voxel collider — just "is there a solid block at this
 *  integer cell?" The client uses worldCollisionGrid.hasVoxel; the
 *  DO will mirror the same shape from its own collision state. */
export interface VoxelCollider {
  hasVoxel(ix: number, iy: number, iz: number): boolean;
}

export interface EnemyCylinder {
  centerX: number;
  centerZ: number;
  bottomY: number;
  topY: number;
  radius: number;
}

/** Provides cylinder hitboxes for live enemies that the grenade can
 *  bounce off. Client passes a wrapper over enemyCombatRegistry. */
export interface EnemyColliderSource {
  forEachHitbox(cb: (hb: EnemyCylinder) => void): void;
}

/** Advance one grenade by `dt`. Same per-axis voxel collision +
 *  cylinder entity bounce + ground-friction rule as the original
 *  inline tick. No return value — mutation only. */
export function stepGrenadePhysics(
  g: GrenadePhysicsState,
  dt: number,
  world: VoxelCollider,
  enemies: EnemyColliderSource,
  c: GrenadePhysicsConstants,
): void {
  // Integrate.
  g.velocity.y -= c.gravity * dt;
  const nextX = g.position.x + g.velocity.x * dt;
  const nextY = g.position.y + g.velocity.y * dt;
  const nextZ = g.position.z + g.velocity.z * dt;

  let px = nextX;
  let py = nextY;
  let pz = nextZ;
  const r = c.visualRadius;

  // Y first (produces the floor bounce).
  const yCellNext = Math.floor(nextY - r);
  if (g.velocity.y < 0 && world.hasVoxel(Math.floor(g.position.x), yCellNext, Math.floor(g.position.z))) {
    py = yCellNext + 1 + r + 0.001;
    g.velocity.y = -g.velocity.y * c.bounceDamp;
    g.velocity.x *= 0.8;
    g.velocity.z *= 0.8;
  } else if (g.velocity.y > 0 && world.hasVoxel(Math.floor(g.position.x), Math.floor(nextY + r), Math.floor(g.position.z))) {
    py = Math.floor(nextY + r) - r - 0.001;
    g.velocity.y = -g.velocity.y * c.bounceDamp;
  } else if (nextY - r < 0) {
    py = r + 0.001;
    g.velocity.y = -g.velocity.y * c.bounceDamp;
    g.velocity.x *= 0.8;
    g.velocity.z *= 0.8;
  }

  // X-axis wall.
  if (g.velocity.x !== 0) {
    const xCell = Math.floor(g.velocity.x > 0 ? nextX + r : nextX - r);
    if (world.hasVoxel(xCell, Math.floor(py), Math.floor(g.position.z))) {
      px = g.position.x;
      g.velocity.x = -g.velocity.x * c.bounceDamp;
    }
  }
  // Z-axis wall.
  if (g.velocity.z !== 0) {
    const zCell = Math.floor(g.velocity.z > 0 ? nextZ + r : nextZ - r);
    if (world.hasVoxel(Math.floor(px), Math.floor(py), zCell)) {
      pz = g.position.z;
      g.velocity.z = -g.velocity.z * c.bounceDamp;
    }
  }

  // Entity (cylinder) bounce — sphere-vs-cylinder horizontal test.
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
    const vDotN = g.velocity.x * nx + g.velocity.z * nz;
    if (vDotN < 0) {
      g.velocity.x -= 2 * vDotN * nx;
      g.velocity.z -= 2 * vDotN * nz;
      g.velocity.x *= c.bounceDamp;
      g.velocity.z *= c.bounceDamp;
    }
  });

  g.position.x = px;
  g.position.y = py;
  g.position.z = pz;

  // Friction only applies while rolling (= grounded + slow). Fast
  // bounces preserve their kinetic energy; once the grenade has
  // calmed down enough, friction takes over and brings it to a stop.
  const grounded = Math.abs(g.velocity.y) < 1.5
    && (py - r <= 0.05
        || world.hasVoxel(Math.floor(px), Math.floor(py - r - 0.05), Math.floor(pz)));
  if (grounded) {
    const speed = Math.hypot(g.velocity.x, g.velocity.z);
    g.isRolling = speed < c.rollThreshold;
    if (g.isRolling) {
      const decay = Math.pow(c.rollFrictionPerSec, dt);
      g.velocity.x *= decay;
      g.velocity.z *= decay;
      if (g.velocity.y < 0) g.velocity.y = 0;
    }
  } else {
    g.isRolling = false;
  }
}
