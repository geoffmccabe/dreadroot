// Pure physics step for a single bullet. Caller owns the bullet
// object — this function only mutates position/velocity/life.
//
// No THREE objects in the signature; the bullet shape here is just
// the fields we touch. Same function runs client-side (per-frame
// integration in useFortressFrameLoop) and on the future L2 DO
// (server-authoritative bullet flight).

export interface BulletPhysicsState {
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  velocityY: number;
  speed: number;
  life: number;
}

export interface BulletPhysicsConstants {
  /** Vertical gravity in m/s². Currently 9.8 (BULLET_GRAVITY). */
  gravity: number;
}

/** Advance one bullet by `dt` seconds. Returns true if the bullet is
 *  still alive (life > 0) after the step. */
export function stepBulletPhysics(
  b: BulletPhysicsState,
  dt: number,
  c: BulletPhysicsConstants,
): boolean {
  b.velocityY -= c.gravity * dt;
  b.position.x += b.direction.x * b.speed * dt;
  b.position.z += b.direction.z * b.speed * dt;
  b.position.y += b.velocityY * dt;
  b.life -= dt;
  return b.life > 0;
}
